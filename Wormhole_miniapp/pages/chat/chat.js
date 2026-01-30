const { BASE_URL, WS_URL } = require('../../utils/config.js');
const { ensureDiaryMode } = require('../../utils/review.js');

const CHAT_CACHE_LIMIT = 50;
const EMOJI_LIST = ['😀','😄','😁','😆','😊','😍','😘','😜','🤔','😎','😭','😡','👍','👎','🙏','🎉','🔥','🌟','💬','❤️','🫶','👏','🤝','😴','🤗','😅','😇','🤩','🥳','🤯','😶‍🌫️','🤤','🤓','🫠','🥹','😮','😱','😏'];

function normalizeDateString(str) {
  if (!str) return '';
  let normalized = str.replace(' ', 'T');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized += 'Z';
  }
  return normalized;
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(normalizeDateString(iso));
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startOfToday - startOfTarget) / (24 * 60 * 60 * 1000));
    const timeText = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    if (diffDays === 0) return timeText;
    if (diffDays === 1) return `昨天 ${timeText}`;
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${timeText}`;
  } catch (e) {
    return '';
  }
}

Page({
  data: {
    messages: [],
    inputMessage: '',
    lastMessageId: '',
    scrollTargetId: '',
    spaceId: '',
    members: [],
    memberCount: 0,
    onlineUserIds: [],
    onlineCount: 0,
    onlineMembers: [],
    typingUsers: [],
    typingDisplay: [],
    showMemberModal: false,
    showOnlineModal: false,
    showReadModal: false,
    readModalUsers: [],
    readUsersMap: {},
    lastReadId: 0,
    unreadDividerId: null,
    replyingTo: null,
    emojiPanelVisible: false,
    emojiList: EMOJI_LIST,
    isAtBottom: true,
    keyboardHeight: 0,
    bottomPadding: 120,
    _baseBottomPadding: 120,
    recording: false,
    audioPlayingId: null,
    inputMode: 'text',
    historyLoading: false,
    historyHasMore: true,
    historyLimit: CHAT_CACHE_LIMIT,
  },
  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onLoad() {
    if (ensureDiaryMode('pages/chat/chat')) return;
    // 获取空间ID
    const spaceId = wx.getStorageSync('currentSpaceId');
    const openid = wx.getStorageSync('openid');
    this._currentUserId = openid;
    this.setData({ spaceId });
    this.setData({ lastReadId: this.loadLastReadId() });
    
    // 初始化基础 padding（约 104rpx 高度）
    try {
      const sys = wx.getSystemInfoSync();
      const rpx = sys.windowWidth / 750;
      const base = Math.ceil(150 * rpx + 24); // 输入区 + 安全距离
      this._emojiPanelPx = Math.ceil(260 * rpx);
      this.setData({ _baseBottomPadding: base, bottomPadding: base });
    } catch(e) {}

    // 键盘高度变化监听
    if (wx.onKeyboardHeightChange) {
      wx.onKeyboardHeightChange(res => {
        const kh = res.height || 0;
        this.setData({ keyboardHeight: kh });
        this.updateBottomPadding();
        this.scrollToBottom();
      });
    }

    // 初始化WebSocket连接
    this.initWebSocket();
    this.fetchMembers();
    this.fetchReadState();
    
    const hasCache = this.loadCachedMessages();
    if (hasCache) {
      this.checkLatestMessage();
      this.markReadLatest();
    } else {
      this.getHistoryMessages({ reset: true });
    }

    if (wx.getRecorderManager) {
      this.recorder = wx.getRecorderManager();
      this.recorder.onStop((res) => {
        if (!res || this._recordCancelled) {
          this._recordCancelled = false;
          return;
        }
        if (!res.tempFilePath || res.duration < 500) {
          wx.showToast({ title: '录音太短', icon: 'none' });
          return;
        }
        this.uploadMedia(res.tempFilePath, 'audio', Math.round(res.duration || 0));
      });
    }
    if (wx.createInnerAudioContext) {
      this.audioCtx = wx.createInnerAudioContext();
      this.audioCtx.onEnded(() => this.setData({ audioPlayingId: null }));
      this.audioCtx.onStop(() => this.setData({ audioPlayingId: null }));
    }
  },
  onInputFocus() {
    this.scrollToBottom();
  },
  onInputBlur() {
    // 留给 onKeyboardHeightChange 处理高度归零
    this.sendTyping(false);
  },
  onShow() {
    // 若昵称更新，刷新历史以展示新昵称
    const updated = wx.getStorageSync('aliasUpdatedAt');
    if (updated) {
      this.getHistoryMessages({ reset: true });
    }
    this.fetchMembers();
    this.fetchReadState();
  },
  onBack() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  initWebSocket() {
    const url = `${WS_URL}/ws/chat/${this.data.spaceId}`;
    const ws = wx.connectSocket({ url });

    ws.onOpen(() => {
      console.log('WebSocket 已连接:', url);
      this._wsReady = true;
      this.sendPresence();
    });

    ws.onMessage((res) => {
      let message = {};
      try {
        message = JSON.parse(res.data);
      } catch (e) {
        message = res.data;
      }
      if (message && message.event) {
        this.handleWsEvent(message);
        return;
      }
      this.mergeRawMessage(message);
      const displayed = this.decorateMessage(message, wx.getStorageSync('openid'));
      this.addMessage(displayed);
    });

    ws.onClose(() => {
      console.log('WebSocket 已关闭，3秒后重连...');
      this._wsReady = false;
      setTimeout(() => this.initWebSocket(), 3000);
    });

    ws.onError(() => {
      console.log('WebSocket 连接错误');
      this._wsReady = false;
    });

    this.ws = ws;
  },

  handleWsEvent(message) {
    const event = message.event;
    if (event === 'presence') {
      const list = Array.isArray(message.online_user_ids) ? message.online_user_ids : [];
      this.updateOnlineUsers(list);
      return;
    }
    if (event === 'typing') {
      this.updateTypingUsers(message.user_id, !!message.typing);
      return;
    }
    if (event === 'read_update') {
      if (message.user_id && message.last_read_message_id) {
        this.updateReadUser(message.user_id, message.last_read_message_id);
      }
      return;
    }
  },

  sendWsEvent(payload, fallback) {
    if (this.ws && this._wsReady) {
      this.ws.send({
        data: JSON.stringify(payload),
        fail: () => {
          if (typeof fallback === 'function') fallback();
        }
      });
    } else if (typeof fallback === 'function') {
      fallback();
    }
  },

  sendPresence() {
    const userId = this._currentUserId || wx.getStorageSync('openid');
    if (!userId) return;
    this.sendWsEvent({ event: 'presence', user_id: userId });
  },

  sendTyping(typing) {
    const userId = this._currentUserId || wx.getStorageSync('openid');
    if (!userId) return;
    if (this._typingState === typing) return;
    this._typingState = typing;
    this.sendWsEvent({ event: 'typing', user_id: userId, typing });
  },

  sendReadState(lastReadId) {
    const userId = this._currentUserId || wx.getStorageSync('openid');
    if (!userId || !lastReadId) return;
    const payload = { event: 'read', user_id: userId, last_read_message_id: lastReadId };
    this.sendWsEvent(payload, () => {
      wx.request({
        url: `${BASE_URL}/api/chat/read`,
        method: 'POST',
        data: { space_id: this.data.spaceId, user_id: userId, last_read_message_id: lastReadId }
      });
    });
  },

  fetchMembers() {
    if (!this.data.spaceId) return;
    wx.request({
      url: `${BASE_URL}/api/space/members`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        if (res.statusCode !== 200) return;
        const members = Array.isArray(res.data?.members) ? res.data.members : [];
        const formatted = members.map(m => ({
          user_id: m.user_id,
          alias: m.alias || '',
          avatar_url: m.avatar_url || '',
          displayName: m.alias || m.user_id || '匿名',
          initial: (m.alias || m.user_id || '匿').charAt(0)
        }));
        this._memberMap = {};
        formatted.forEach(m => { this._memberMap[m.user_id] = m; });
        this.setData({ members: formatted, memberCount: formatted.length });
        this.refreshMessageDecorations();
        this.refreshTypingDisplay();
        this.refreshOnlineDisplay();
      }
    });
  },

  fetchReadState() {
    if (!this.data.spaceId) return;
    wx.request({
      url: `${BASE_URL}/api/chat/readers`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        if (res.statusCode !== 200) return;
        const readers = Array.isArray(res.data?.readers) ? res.data.readers : [];
        const map = {};
        readers.forEach(r => {
          if (r && r.user_id) {
            map[r.user_id] = r.last_read_message_id || 0;
          }
        });
        const myId = this._currentUserId || wx.getStorageSync('openid');
        const selfReader = readers.find(r => r.user_id === myId);
        const serverLastRead = selfReader?.last_read_message_id || 0;
        if (serverLastRead && serverLastRead > (this.data.lastReadId || 0)) {
          this.setData({ lastReadId: serverLastRead });
          this.saveLastReadId(serverLastRead);
        }
        this.setData({ readUsersMap: map });
        this.refreshMessageDecorations();
      }
    });
  },

  updateOnlineUsers(list) {
    const ids = Array.isArray(list) ? list : [];
    this.setData({ onlineUserIds: ids, onlineCount: ids.length });
    this.refreshOnlineDisplay();
  },

  refreshOnlineDisplay() {
    const ids = this.data.onlineUserIds || [];
    const members = this.data.members || [];
    const map = this._memberMap || {};
    const onlineMembers = ids.map(id => map[id]).filter(Boolean);
    const fallback = members.filter(m => ids.includes(m.user_id));
    this.setData({ onlineMembers: onlineMembers.length ? onlineMembers : fallback });
  },

  updateTypingUsers(userId, typing) {
    if (!userId) return;
    const myId = this._currentUserId || wx.getStorageSync('openid');
    const current = new Set(this.data.typingUsers || []);
    if (typing) current.add(userId);
    else current.delete(userId);
    if (myId) current.delete(myId);
    const list = Array.from(current);
    this.setData({ typingUsers: list });
    this.refreshTypingDisplay();
  },

  refreshTypingDisplay() {
    const list = this.data.typingUsers || [];
    const map = this._memberMap || {};
    const display = list.map(id => {
      const name = map[id]?.alias || id || '匿名';
      return {
      user_id: id,
      avatar_url: map[id]?.avatar_url || '',
      displayName: name,
      initial: name ? name.charAt(0) : '匿'
      };
    });
    this.setData({ typingDisplay: display });
  },

  updateReadUser(userId, lastReadId) {
    if (!userId) return;
    const map = { ...(this.data.readUsersMap || {}) };
    const prev = map[userId] || 0;
    if (lastReadId > prev) {
      map[userId] = lastReadId;
      this.setData({ readUsersMap: map });
      this.refreshMessageDecorations();
    }
  },

  getReadCacheKey() {
    return `chat_last_read_${this.data.spaceId}`;
  },

  loadLastReadId() {
    const key = this.getReadCacheKey();
    try {
      return Number(wx.getStorageSync(key) || 0);
    } catch (e) {
      return 0;
    }
  },

  saveLastReadId(id) {
    const key = this.getReadCacheKey();
    try {
      wx.setStorageSync(key, id || 0);
    } catch (e) {}
  },

  computeUnreadDividerId(messages) {
    const lastRead = this.data.lastReadId || 0;
    if (!messages.length) return null;
    const firstUnread = messages.find(m => m.id > lastRead);
    return firstUnread ? firstUnread.id : null;
  },

  computeReadCount(messageId, map, myId) {
    let count = 0;
    Object.keys(map || {}).forEach(uid => {
      if (uid === myId) return;
      if ((map[uid] || 0) >= messageId) count += 1;
    });
    return count;
  },

  refreshMessageDecorations(messagesInput) {
    const messages = messagesInput || this.data.messages || [];
    if (!messages.length) return;
    const myId = this._currentUserId || wx.getStorageSync('openid');
    const unreadDividerId = this.computeUnreadDividerId(messages);
    const readMap = this.data.readUsersMap || {};
    const updated = messages.map(m => {
      const readCount = m.isSelf ? this.computeReadCount(m.id, readMap, myId) : 0;
      return {
        ...m,
        readCount,
        showUnreadDivider: unreadDividerId && m.id === unreadDividerId
      };
    });
    this.setData({ messages: updated, unreadDividerId });
  },

  applyDecorations(messages) {
    if (!messages.length) return messages;
    const myId = this._currentUserId || wx.getStorageSync('openid');
    const unreadDividerId = this.computeUnreadDividerId(messages);
    const readMap = this.data.readUsersMap || {};
    this._lastUnreadDividerId = unreadDividerId;
    return messages.map(m => {
      const readCount = m.isSelf ? this.computeReadCount(m.id, readMap, myId) : 0;
      return {
        ...m,
        readCount,
        showUnreadDivider: unreadDividerId && m.id === unreadDividerId
      };
    });
  },

  markReadLatest() {
    const messages = this.data.messages || [];
    if (!messages.length) return;
    const latestId = messages[messages.length - 1].id;
    if (!latestId) return;
    if (latestId > (this.data.lastReadId || 0)) {
      this.setData({ lastReadId: latestId });
      this.saveLastReadId(latestId);
      this.sendReadState(latestId);
      this.refreshMessageDecorations();
    }
  },

  onScroll(e) {
    const detail = e.detail || {};
    const scrollTop = detail.scrollTop || 0;
    const scrollHeight = detail.scrollHeight || 0;
    const clientHeight = detail.clientHeight || 0;
    const nearBottom = scrollTop + clientHeight >= scrollHeight - 30;
    if (nearBottom && !this.data.isAtBottom) {
      this.setData({ isAtBottom: true });
      this.markReadLatest();
    } else if (!nearBottom && this.data.isAtBottom) {
      this.setData({ isAtBottom: false });
    }
  },

  onScrollToLower() {
    this.setData({ isAtBottom: true });
    this.markReadLatest();
  },

  openMembers() {
    this.setData({ showMemberModal: true });
  },

  closeMembers() {
    this.setData({ showMemberModal: false });
  },

  openOnline() {
    this.setData({ showOnlineModal: true });
  },

  closeOnline() {
    this.setData({ showOnlineModal: false });
  },

  openReadList(e) {
    const messageId = Number(e.currentTarget.dataset.id || 0);
    if (!messageId) return;
    const map = this.data.readUsersMap || {};
    const members = this.data.members || [];
    const myId = this._currentUserId || wx.getStorageSync('openid');
    const list = members.filter(m => m.user_id !== myId && (map[m.user_id] || 0) >= messageId);
    this.setData({ readModalUsers: list, showReadModal: true });
  },

  closeReadModal() {
    this.setData({ showReadModal: false });
  },

  noop() {},

  startReply(e) {
    const dataset = e.currentTarget.dataset || {};
    const reply = {
      id: Number(dataset.id),
      userId: dataset.userId,
      nickname: dataset.nickname || dataset.userId || '匿名',
      type: dataset.messageType || 'text',
      content: this.buildReplyPreview(dataset)
    };
    if (!reply.id) return;
    this.setData({ replyingTo: reply });
  },

  buildReplyPreview(dataset) {
    const type = dataset.messageType || 'text';
    const content = dataset.content || '';
    if (type === 'image') return '[图片]';
    if (type === 'audio') return '[语音]';
    const trimmed = (content || '').trim();
    return trimmed ? trimmed.slice(0, 80) : '[消息]';
  },

  cancelReply() {
    this.setData({ replyingTo: null });
  },

  updateBottomPadding() {
    const base = this.data._baseBottomPadding || 120;
    const kh = this.data.keyboardHeight || 0;
    const emoji = this.data.emojiPanelVisible ? (this._emojiPanelPx || 0) : 0;
    this.setData({ bottomPadding: base + kh + emoji });
  },

  toggleEmojiPanel() {
    const next = !this.data.emojiPanelVisible;
    this.setData({ emojiPanelVisible: next });
    this.updateBottomPadding();
  },

  addEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji;
    if (!emoji) return;
    const nextValue = `${this.data.inputMessage || ''}${emoji}`;
    this.setData({ inputMessage: nextValue });
    this.sendTyping(true);
  },

  getHistoryMessages(opts = {}) {
    const { reset, beforeId, prepend } = opts;
    if (this.data.historyLoading) return;
    if (!this.data.spaceId) {
      wx.showToast({ title: '空间信息缺失', icon: 'none' });
      return;
    }
    this.setData({ historyLoading: true });
    const limit = this.data.historyLimit || 50;
    const params = { space_id: this.data.spaceId, limit };
    if (beforeId) params.before_id = beforeId;
    wx.request({
      url: `${BASE_URL}/api/chat/history`,
      data: params,
      success: (res) => {
        if (res.statusCode !== 200) {
          this.setData({ historyLoading: false });
          wx.showToast({ title: res.data?.detail || '加载失败', icon: 'none' });
          return;
        }
        const myid = wx.getStorageSync('openid');
        const rawMsgs = res.data.messages || [];
        const msgs = rawMsgs.map(m => this.decorateMessage(m, myid));
        const hasMore = res.data.has_more !== undefined ? !!res.data.has_more : (msgs.length >= limit);
        if (prepend) {
          const existing = this.data.messages || [];
          const anchorId = existing.length ? existing[0].id : null;
          const merged = this.applyDecorations(msgs.concat(existing));
          const rawExisting = this._rawMessages || [];
          this._rawMessages = rawMsgs.concat(rawExisting);
          this.saveCachedMessages();
          this.setData({
            messages: merged,
            unreadDividerId: this._lastUnreadDividerId || null,
            historyHasMore: hasMore,
            scrollTargetId: anchorId ? `msg-${anchorId}` : '',
            historyLoading: false
          });
        } else {
          this._rawMessages = rawMsgs;
          this.saveCachedMessages();
          const decorated = this.applyDecorations(msgs);
          this.setData({
            messages: decorated,
            unreadDividerId: this._lastUnreadDividerId || null,
            lastMessageId: msgs.length ? `msg-${msgs[msgs.length - 1].id}` : '',
            scrollTargetId: msgs.length ? `msg-${msgs[msgs.length - 1].id}` : '',
            historyHasMore: hasMore,
            historyLoading: false,
            isAtBottom: true
          });
          if (this.data.isAtBottom) {
            this.markReadLatest();
          }
        }
      },
      fail: () => {
        this.setData({ historyLoading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        try { wx.removeStorageSync('aliasUpdatedAt'); } catch (e) {}
      }
    });
  },

  chooseImage() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.enterForegroundHold === 'function') {
      app.enterForegroundHold(60000);
    }
    wx.chooseImage({
      count: 9,
      success: (res) => {
        const files = res.tempFilePaths || [];
        files.forEach(path => this.uploadMedia(path, 'image'));
      },
      complete: () => {
        if (app && typeof app.leaveForegroundHold === 'function') {
          app.leaveForegroundHold();
        }
      }
    });
  },

  openAttachmentMenu() {
    const actions = ['图片'];
    wx.showActionSheet({
      itemList: actions,
      success: (res) => {
        if (res.tapIndex === 0) {
          this.chooseImage();
        }
      }
    });
  },

  uploadMedia(filePath, messageType, extra) {
    if (!filePath) return;
    const formData = {
      category: 'messages',
      message_type: messageType
    };
    if (this.data.spaceId) {
      formData.space_id = this.data.spaceId;
    }
    wx.showLoading({ title: '发送中', mask: true });
    wx.uploadFile({
      url: `${BASE_URL}/api/upload`,
      filePath,
      name: 'file',
      formData,
      success: (resp) => {
        try {
          const data = JSON.parse(resp.data || '{}');
          let url = data.url || '';
          if (url && url.startsWith('/')) {
            url = `${BASE_URL}${url}`;
          }
          if (url) {
            this.sendPayload({
              message_type: messageType,
              media_url: url,
              media_duration: extra || null,
              content: messageType === 'text' ? this.data.inputMessage : ''
            });
          }
        } catch (e) {
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '上传失败', icon: 'none' });
      },
      complete: () => {
        wx.hideLoading();
      }
    });
  },

  onInputChange(e) {
    const value = e.detail.value || '';
    this.setData({ inputMessage: value });
    if (this.data.inputMode !== 'text') return;
    const hasText = value.trim().length > 0;
    if (hasText) {
      this.sendTyping(true);
      if (this._typingTimer) clearTimeout(this._typingTimer);
      this._typingTimer = setTimeout(() => this.sendTyping(false), 1500);
    } else {
      this.sendTyping(false);
    }
  },

  sendMessage() {
    const text = this.data.inputMessage.trim();
    if (!text) return;
    this.sendPayload({
      content: text,
      message_type: 'text'
    });
  },

  sendPayload(payload) {
    const reply = this.data.replyingTo;
    const message = {
      space_id: this.data.spaceId,
      user_id: wx.getStorageSync('openid') || '',
      content: payload.content || '',
      message_type: payload.message_type || 'text',
      media_url: payload.media_url || null,
      media_duration: payload.media_duration || null,
    };
    if (reply && reply.id) {
      message.reply_to_id = reply.id;
      message.reply_to_user_id = reply.userId;
      message.reply_to_content = reply.content;
      message.reply_to_type = reply.type || 'text';
    }
    if (!message.user_id) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    if (message.message_type === 'text' && !message.content.trim()) {
      return;
    }
    const wsPayload = { ...message };
    delete wsPayload.space_id;
    if (this.ws) {
      this.ws.send({
        data: JSON.stringify(wsPayload),
        success: () => {
          if (message.message_type === 'text') {
            this.setData({ inputMessage: '' });
          }
          if (this.data.replyingTo) {
            this.setData({ replyingTo: null });
          }
          this.sendTyping(false);
          if (this.data.emojiPanelVisible) {
            this.setData({ emojiPanelVisible: false });
            this.updateBottomPadding();
          }
        },
        fail: () => {
          this.sendViaHttp(message);
        }
      });
    } else {
      this.sendViaHttp(message);
    }
  },

  sendViaHttp(message) {
    wx.request({
      url: `${BASE_URL}/api/chat/send`,
      method: 'POST',
      data: message,
      success: () => {
        if (message.message_type === 'text') {
          this.setData({ inputMessage: '' });
        }
        if (this.data.replyingTo) {
          this.setData({ replyingTo: null });
        }
        this.sendTyping(false);
        if (this.data.emojiPanelVisible) {
          this.setData({ emojiPanelVisible: false });
          this.updateBottomPadding();
        }
        this.getHistoryMessages();
      }
    });
  },

  addMessage(message) {
    const messages = [...this.data.messages, message];
    const decorated = this.applyDecorations(messages);
    this.setData({ 
      messages: decorated,
      unreadDividerId: this._lastUnreadDividerId || null,
      lastMessageId: `msg-${message.id}`,
      scrollTargetId: `msg-${message.id}`
    });
    if (this.data.isAtBottom) {
      this.markReadLatest();
    }
  },

  toggleInputMode() {
    const nextMode = this.data.inputMode === 'text' ? 'audio' : 'text';
    this.setData({ inputMode: nextMode, recording: false });
    if (nextMode !== 'text') {
      this.sendTyping(false);
    }
  },

  decorateMessage(message, myId) {
    const nickname = message.alias || message.user_id || '匿名';
    const avatar = message.avatar_url || '';
    const initialSource = nickname || message.user_id || '匿';
    const duration = message.media_duration ? Math.round(message.media_duration / 1000) : 0;
    let reply = null;
    if (message.reply_to_id) {
      const replyNickname = message.reply_to_alias || message.reply_to_user_id || '匿名';
      const replyContent = message.reply_to_content || (message.reply_to_type === 'image' ? '[图片]' : message.reply_to_type === 'audio' ? '[语音]' : '[消息]');
      reply = {
        id: message.reply_to_id,
        userId: message.reply_to_user_id,
        nickname: replyNickname,
        avatar: message.reply_to_avatar_url || '',
        content: replyContent,
        type: message.reply_to_type || 'text'
      };
    }
    return {
      id: message.id,
      userId: message.user_id,
      content: message.content,
      displayTime: formatTime(message.created_at),
      isSelf: message.user_id === myId,
      avatar,
      initial: initialSource.charAt(0),
      nickname,
      messageType: message.message_type || 'text',
      mediaUrl: message.media_url || '',
      mediaDuration: message.media_duration || 0,
      audioDuration: duration,
      reply,
      readCount: 0,
      showUnreadDivider: false
    };
  },

  scrollToBottom() {
    const arr = this.data.messages || [];
    if (arr.length) {
      const id = arr[arr.length - 1].id;
      this.setData({ lastMessageId: `msg-${id}`, scrollTargetId: `msg-${id}` });
    }
  },

  loadOlderMessages() {
    if (this.data.historyLoading || !this.data.historyHasMore) return;
    this.setData({ isAtBottom: false });
    const first = (this.data.messages || [])[0];
    if (!first) return;
    this.getHistoryMessages({ prepend: true, beforeId: first.id });
  },

  getCacheKey() {
    return `chat_cache_${this.data.spaceId}`;
  },

  loadCachedMessages() {
    if (!this.data.spaceId) return false;
    const key = this.getCacheKey();
    let cache = null;
    try {
      cache = wx.getStorageSync(key);
    } catch (e) {}
    const rawMsgs = Array.isArray(cache?.messages) ? cache.messages : [];
    if (!rawMsgs.length) return false;
    this._rawMessages = rawMsgs;
    const myid = wx.getStorageSync('openid');
    const msgs = rawMsgs.map(m => this.decorateMessage(m, myid));
    const decorated = this.applyDecorations(msgs);
    const lastId = msgs.length ? msgs[msgs.length - 1].id : '';
    const limit = this.data.historyLimit || CHAT_CACHE_LIMIT;
    this.setData({
      messages: decorated,
      unreadDividerId: this._lastUnreadDividerId || null,
      lastMessageId: lastId ? `msg-${lastId}` : '',
      scrollTargetId: lastId ? `msg-${lastId}` : '',
      historyHasMore: rawMsgs.length >= limit,
      isAtBottom: true
    });
    return true;
  },

  saveCachedMessages() {
    if (!this.data.spaceId) return;
    const key = this.getCacheKey();
    const limit = this.data.historyLimit || CHAT_CACHE_LIMIT;
    const raw = Array.isArray(this._rawMessages) ? this._rawMessages : [];
    if (!raw.length) {
      try { wx.removeStorageSync(key); } catch (e) {}
      return;
    }
    const trimmed = raw.slice(-limit);
    const lastId = trimmed[trimmed.length - 1]?.id || null;
    try {
      wx.setStorageSync(key, { messages: trimmed, last_id: lastId, cached_at: Date.now() });
    } catch (e) {}
  },

  mergeRawMessage(message) {
    if (!message || !message.id) return;
    const raw = Array.isArray(this._rawMessages) ? this._rawMessages : [];
    if (raw.length && raw[raw.length - 1].id === message.id) return;
    if (raw.some(m => m.id === message.id)) return;
    raw.push(message);
    this._rawMessages = raw;
    this.saveCachedMessages();
  },

  checkLatestMessage() {
    if (!this.data.spaceId) return;
    const raw = Array.isArray(this._rawMessages) ? this._rawMessages : [];
    const cachedLastId = raw.length ? raw[raw.length - 1].id : null;
    if (!cachedLastId) {
      this.getHistoryMessages({ reset: true });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/chat/history`,
      data: { space_id: this.data.spaceId, limit: 1 },
      success: (res) => {
        if (res.statusCode !== 200) return;
        const latest = (res.data?.messages || [])[0];
        if (!latest) return;
        if (latest.id !== cachedLastId) {
          this.getHistoryMessages({ reset: true });
        }
      }
    });
  },

  onUnload() {
    this.sendTyping(false);
    if (this.ws) {
      this.ws.close();
    }
    if (this.audioCtx) {
      this.audioCtx.destroy();
      this.audioCtx = null;
    }
  },

  handleRecordStart() {
    if (!this.recorder) {
      wx.showToast({ title: '录音不可用', icon: 'none' });
      return;
    }
    this._recordCancelled = false;
    this.setData({ recording: true });
    try {
      this.recorder.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3'
      });
    } catch (e) {
      this.setData({ recording: false });
      wx.showToast({ title: '开启录音失败', icon: 'none' });
    }
  },

  handleRecordEnd() {
    if (!this.recorder) return;
    this.setData({ recording: false });
    this.recorder.stop();
  },

  handleRecordCancel() {
    if (!this.recorder) return;
    this._recordCancelled = true;
    this.setData({ recording: false });
    try { this.recorder.stop(); } catch (e) {}
  },

  previewChatImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.enterForegroundHold === 'function') app.enterForegroundHold(60000);
    wx.previewImage({
      current: url,
      urls: [url],
      complete: () => {
        if (app && typeof app.leaveForegroundHold === 'function') app.leaveForegroundHold();
      }
    });
  },

  playAudio(e) {
    const url = e.currentTarget.dataset.url;
    const id = e.currentTarget.dataset.id;
    if (!url || !this.audioCtx) return;
    if (this.data.audioPlayingId === id) {
      this.audioCtx.stop();
      this.setData({ audioPlayingId: null });
      return;
    }
    this.audioCtx.stop();
    this.audioCtx.src = url;
    this.audioCtx.play();
    this.setData({ audioPlayingId: id });
  }
}); 
