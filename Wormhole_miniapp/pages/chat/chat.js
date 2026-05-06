const { BASE_URL } = require('../../utils/config.js');
const { ensureDiaryMode } = require('../../utils/review.js');
const { EMOJI_DISPLAY_LIST } = require('../../utils/wechat-emoji.js');
const wsModule = require('./chat-ws.js');
const voiceModule = require('./chat-voice.js');
const stickerModule = require('./chat-sticker.js');
const replyModule = require('./chat-reply.js');
const listModule = require('./chat-list.js');

const CHAT_CACHE_LIMIT = 50;
const MISS_YOU_SUFFIX = '在想你';
const PLUS_ACTIONS = [
  { id: 'album', label: '照片/视频', icon: '🖼️' },
  { id: 'camera', label: '拍照', icon: '📷' },
  { id: 'missyou', label: '想你', icon: '💌' },
  { id: 'live', label: '实况照片', icon: '📸' },
  { id: 'location', label: '位置', icon: '📍' },
  { id: 'file', label: '文件', icon: '📄' },
  { id: 'contact', label: '名片', icon: '👤' },
  { id: 'more', label: '更多', icon: '✨' },
];

Page(Object.assign({
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
    emojiList: EMOJI_DISPLAY_LIST,
    emojiScrollTop: 0,
    customStickers: [],
    plusPanelVisible: false,
    plusActions: PLUS_ACTIONS,
    isAtBottom: true,
    keyboardHeight: 0,
    bottomPadding: 120,
    _baseBottomPadding: 120,
    _inputAreaHeight: 0,
    recording: false,
    audioPlayingId: '',
    inputMode: 'text',
    historyLoading: false,
    historyHasMore: true,
    historyLimit: CHAT_CACHE_LIMIT,
    scrollTop: 0,
    scrollWithAnimation: true,
    ownerUserId: '',
    isOwner: false,
    activeLiveMessageId: null,
    heartBurstVisible: false,
    heartBurstHearts: [],
  },
  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  ensureIdentity() {
    const exists = this._currentUserId || wx.getStorageSync('openid') || '';
    if (exists) {
      this._currentUserId = exists;
      return Promise.resolve(exists);
    }
    const app = typeof getApp === 'function' ? getApp() : null;
    if (!app || typeof app.ensureOpenId !== 'function') {
      return Promise.resolve('');
    }
    return app.ensureOpenId().then((uid) => {
      const userId = uid || wx.getStorageSync('openid') || '';
      if (userId) {
        this._currentUserId = userId;
      }
      return userId;
    });
  },

  onLoad() {
    if (ensureDiaryMode('pages/chat/chat')) return;
    // 获取空间ID
    const spaceId = wx.getStorageSync('currentSpaceId');
    const openid = wx.getStorageSync('openid');
    this._currentUserId = openid;
    this.setData({ spaceId });
    this.setData({ lastReadId: this.loadLastReadId() });
    this.fetchSpaceInfo();
    
    // 键盘高度变化监听
    if (wx.onKeyboardHeightChange) {
      if (this._keyboardHeightHandler && wx.offKeyboardHeightChange) {
        wx.offKeyboardHeightChange(this._keyboardHeightHandler);
      }
      this._keyboardHeightHandler = (res) => {
        const kh = res.height || 0;
        this.setData({ keyboardHeight: kh }, () => {
          this.updateBottomPadding();
          this.scrollToBottom();
        });
      };
      wx.onKeyboardHeightChange(this._keyboardHeightHandler);
    }
    this.updateBottomPadding({ forceMeasure: true });

    // 初始化WebSocket连接
    this._pageActive = true;
    this._wsKeepAlive = true;
    this._wsRetryCount = 0;
    // Task 10: WS-only sends. If the socket isn't ready when the user hits send,
    // payloads queue here in-memory and flush on the next onOpen. Task 26 will
    // promote this into a persistent outbox.
    this._pendingSends = [];
    this.initWebSocket();
    // 网络状态监听：离线 → 在线 时立刻重连
    this._netListener = (res) => {
      if (res && res.isConnected && !this._wsReady && this._wsKeepAlive) {
        this._wsRetryCount = 0;
        this.initWebSocket({ force: true });
      }
    };
    if (wx.onNetworkStatusChange) {
      wx.onNetworkStatusChange(this._netListener);
    }
    this.fetchMembers();
    this.fetchReadState();
    this.fetchCustomStickers();
    
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
      this.audioCtx.onEnded(() => this.resetAudioPlaybackState());
      this.audioCtx.onStop(() => {
        if (this._ignoreNextAudioStop) {
          this._ignoreNextAudioStop = false;
          return;
        }
        this.resetAudioPlaybackState();
      });
      this.audioCtx.onError(() => this.resetAudioPlaybackState());
    }
  },
  onReady() {
    this.updateBottomPadding({ forceMeasure: true });
  },
  onInputFocus() {
    if (this.data.emojiPanelVisible || this.data.plusPanelVisible) {
      this.setData({ emojiPanelVisible: false, plusPanelVisible: false }, () => {
        this.updateBottomPadding({ forceMeasure: true });
      });
    }
    this.scrollToBottom();
  },
  onInputBlur() {
    // 留给 onKeyboardHeightChange 处理高度归零
    this.sendTyping(false);
  },
  onShow() {
    this._pageActive = true;
    const app = typeof getApp === 'function' ? getApp() : null;
    if (this._previewHoldActive && app && typeof app.leaveForegroundHold === 'function') {
      this._previewHoldActive = false;
      setTimeout(() => app.leaveForegroundHold(), 200);
    }
    if (app && typeof app.clearChatBadge === 'function') {
      app.clearChatBadge();
    }
    // 若昵称更新，刷新历史以展示新昵称
    const updated = wx.getStorageSync('aliasUpdatedAt');
    if (updated) {
      this.getHistoryMessages({ reset: true });
    } else {
      this.syncLatestMessages({ force: true });
    }
    this.fetchMembers();
    this.fetchReadState();
    this.fetchCustomStickers();
    // 冷启/前后台切换后立即尝试重连
    if (!this._wsReady && this._wsKeepAlive) {
      this.initWebSocket({ force: true });
    }
  },
  onHide() {
    this.sendTyping(false);
    // 保持房间内WS连接，便于接收新消息红点
  },
  onBack() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  noop() {},

  measureInputAreaHeight(callback) {
    const query = wx.createSelectorQuery().in(this);
    query.select('.input-area').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      const height = rect && rect.height ? Math.ceil(rect.height) : 0;
      if (typeof callback === 'function') {
        callback(height);
      }
    });
  },

  updateBottomPadding({ forceMeasure = false } = {}) {
    const kh = Number(this.data.keyboardHeight || 0);
    const cachedHeight = Number(this.data._inputAreaHeight || 0);
    const fallbackHeight = Number(this.data._baseBottomPadding || 120);
    const expandedInputArea = this.data.emojiPanelVisible || this.data.plusPanelVisible || !!this.data.replyingTo;
    const shouldMeasure = forceMeasure || !cachedHeight || expandedInputArea;
    const apply = (measuredHeight = 0) => {
      const baseHeight = measuredHeight > 0
        ? measuredHeight
        : (expandedInputArea ? (cachedHeight > 0 ? cachedHeight : fallbackHeight) : fallbackHeight);
      const nextPadding = Math.max(baseHeight + kh, kh);
      const nextData = {};
      if (measuredHeight > 0 && measuredHeight !== cachedHeight) {
        nextData._inputAreaHeight = measuredHeight;
      }
      if (measuredHeight > 0 && !expandedInputArea && measuredHeight !== fallbackHeight) {
        // 只在收起态更新基础高度，避免把展开面板高度缓存成常驻底部占位
        nextData._baseBottomPadding = measuredHeight;
      }
      if (nextPadding !== this.data.bottomPadding) {
        nextData.bottomPadding = nextPadding;
      }
      if (Object.keys(nextData).length) {
        this.setData(nextData);
      }
    };
    if (!shouldMeasure) {
      apply(0);
      return;
    }
    const runner = () => this.measureInputAreaHeight((height) => apply(height));
    if (wx.nextTick) {
      wx.nextTick(runner);
    } else {
      setTimeout(runner, 0);
    }
  },

  closeOverlayPanels() {
    if (!this.data.emojiPanelVisible && !this.data.plusPanelVisible) return;
    this.setData({ emojiPanelVisible: false, plusPanelVisible: false }, () => {
      this.updateBottomPadding({ forceMeasure: true });
    });
  },

  togglePlusPanel() {
    const next = !this.data.plusPanelVisible;
    this.setData({ plusPanelVisible: next, emojiPanelVisible: false }, () => {
      this.updateBottomPadding({ forceMeasure: true });
      if (next) {
        this.scrollToBottomIfNeeded();
      }
    });
    if (next) {
      try { wx.hideKeyboard(); } catch (e) {}
    }
  },

  closePlusPanel() {
    if (!this.data.plusPanelVisible) return;
    this.setData({ plusPanelVisible: false });
    this.updateBottomPadding();
  },

  handlePlusAction(e) {
    const action = e.currentTarget.dataset.action;
    if (!action) return;
    if (action === 'missyou') {
      this.sendMissYou();
      this.closePlusPanel();
      return;
    }
    if (action === 'album') {
      this.chooseMedia(['album']);
      return;
    }
    if (action === 'live') {
      this.chooseLiveMedia();
      return;
    }
    if (action === 'camera') {
      this.chooseMedia(['camera']);
      return;
    }
    if (action === 'location') {
      wx.showToast({ title: '位置功能开发中', icon: 'none' });
      this.closePlusPanel();
      return;
    }
    if (action === 'file') {
      wx.showToast({ title: '文件功能开发中', icon: 'none' });
      this.closePlusPanel();
      return;
    }
    if (action === 'contact') {
      wx.showToast({ title: '名片功能开发中', icon: 'none' });
      this.closePlusPanel();
      return;
    }
    wx.showToast({ title: '更多功能开发中', icon: 'none' });
    this.closePlusPanel();
  },

  sendMissYou() {
    const userId = this._currentUserId || wx.getStorageSync('openid') || '';
    const profile = this.getMyProfile();
    const displayName = (profile.alias || userId || '有人').trim().slice(0, 20);
    this._lastMissYouByMeAt = Date.now();
    this.sendPayload({
      content: `${displayName}${MISS_YOU_SUFFIX}`,
      message_type: 'system'
    });
  },

  chooseMedia(sourceType) {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.enterForegroundHold === 'function') {
      app.enterForegroundHold(60000);
    }
    wx.chooseMedia({
      count: 9,
      mediaType: ['image', 'video'],
      sourceType,
      maxDuration: 60,
      camera: 'back',
      success: (res) => {
        const files = res.tempFiles || [];
        files.forEach(file => {
          const fileType = file.fileType || file.type;
          if (fileType === 'video') {
            this.uploadMedia(file.tempFilePath, 'video', Math.round((file.duration || 0) * 1000));
          } else {
            this.uploadMedia(file.tempFilePath, 'image');
          }
        });
      },
      complete: () => {
        if (app && typeof app.leaveForegroundHold === 'function') {
          app.leaveForegroundHold();
        }
        this.closePlusPanel();
      }
    });
  },

  chooseLiveMedia() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.enterForegroundHold === 'function') {
      app.enterForegroundHold(60000);
    }
    wx.chooseMedia({
      count: 2,
      mediaType: ['image', 'video'],
      sourceType: ['album'],
      maxDuration: 10,
      success: (res) => {
        const files = Array.isArray(res.tempFiles) ? res.tempFiles : [];
        const imageFile = files.find(item => (item.fileType || item.type) === 'image');
        const videoFile = files.find(item => (item.fileType || item.type) === 'video');
        if (!videoFile) {
          wx.showToast({ title: '请选择包含实况视频的媒体', icon: 'none' });
          return;
        }
        const coverPath = (imageFile && imageFile.tempFilePath) || videoFile.thumbTempFilePath || '';
        const videoPath = videoFile.tempFilePath || '';
        if (!coverPath || !videoPath) {
          wx.showToast({ title: '实况文件不完整', icon: 'none' });
          return;
        }
        wx.showLoading({ title: '发送中', mask: true });
        Promise.all([
          this.uploadMediaFile(coverPath, 'image'),
          this.uploadMediaFile(videoPath, 'video')
        ]).then(([coverUrl, videoUrl]) => {
          if (!coverUrl || !videoUrl) {
            wx.showToast({ title: '上传失败', icon: 'none' });
            return;
          }
          this.sendPayload({
            message_type: 'live',
            live_cover_url: coverUrl,
            live_video_url: videoUrl,
            media_duration: Math.round((videoFile.duration || 0) * 1000)
          });
        }).finally(() => {
          wx.hideLoading();
        });
      },
      complete: () => {
        if (app && typeof app.leaveForegroundHold === 'function') {
          app.leaveForegroundHold();
        }
        this.closePlusPanel();
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
    wx.showLoading({ title: '发送中', mask: true });
    this.uploadMediaFile(filePath, messageType).then((url) => {
      if (!url) {
        wx.showToast({ title: '上传失败', icon: 'none' });
        return;
      }
      this.sendPayload({
        message_type: messageType,
        media_url: url,
        media_duration: extra || null,
        content: messageType === 'text' ? this.data.inputMessage : ''
      });
    }).finally(() => {
      wx.hideLoading();
    });
  },

  uploadMediaFile(filePath, messageType) {
    if (!filePath) return Promise.resolve('');
    const userId = this._currentUserId || wx.getStorageSync('openid') || '';
    if (!userId) {
      return this.ensureIdentity().then((uid) => {
        if (!uid) return '';
        return this.uploadMediaFile(filePath, messageType);
      });
    }
    const formData = {
      category: 'messages',
      message_type: messageType,
      user_id: userId
    };
    if (this.data.spaceId) {
      formData.space_id = this.data.spaceId;
    }
    return new Promise((resolve) => {
      wx.uploadFile({
        url: `${BASE_URL}/api/upload`,
        filePath,
        name: 'file',
        formData,
        success: (resp) => {
          if (resp.statusCode !== 200) {
            try {
              const err = JSON.parse(resp.data || '{}');
              wx.showToast({ title: err.detail || '上传失败', icon: 'none' });
            } catch (e) {
              wx.showToast({ title: '上传失败', icon: 'none' });
            }
            resolve('');
            return;
          }
          try {
            const data = JSON.parse(resp.data || '{}');
            let url = data.url || '';
            if (url && url.startsWith('/')) {
              url = `${BASE_URL}${url}`;
            }
            resolve(url || '');
          } catch (e) {
            resolve('');
          }
        },
        fail: () => resolve('')
      });
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

  onInputConfirm() {
    if (this.data.inputMode !== 'text') return;
    this.sendMessage();
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
    const currentUserId = this._currentUserId || wx.getStorageSync('openid') || '';
    if (!currentUserId) {
      this.ensureIdentity().then((uid) => {
        if (!uid) {
          wx.showToast({ title: '未登录', icon: 'none' });
          return;
        }
        this.sendPayload(payload);
      });
      return;
    }
    const reply = this.data.replyingTo;
    const message = {
      space_id: this.data.spaceId,
      user_id: currentUserId,
      content: payload.content || '',
      message_type: payload.message_type || 'text',
      media_url: payload.media_url || null,
      live_cover_url: payload.live_cover_url || null,
      live_video_url: payload.live_video_url || null,
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
    if ((message.message_type === 'text' || message.message_type === 'system') && !message.content.trim()) {
      return;
    }
    const clientId = this.createClientId();
    message.client_id = clientId;
    this.addPendingMessage(message);
    const wsPayload = { ...message };
    delete wsPayload.space_id;
    // Task 10: WS-only sends. If the socket isn't ready, queue and flush on
    // next onOpen. Optimistic UI cleanup happens immediately either way so
    // the input doesn't feel stuck while we wait for the socket.
    this.afterSendUiCleanup(message);
    if (this.ws && this._wsReady) {
      this.ws.send({
        data: JSON.stringify(wsPayload),
        fail: () => {
          this.queuePendingSend(wsPayload);
        }
      });
    } else {
      this.queuePendingSend(wsPayload);
    }
  },

  afterSendUiCleanup(message) {
    if (message.message_type === 'text') {
      this.setData({ inputMessage: '' });
    }
    if (this.data.replyingTo) {
      this.setData({ replyingTo: null }, () => {
        this.updateBottomPadding({ forceMeasure: true });
      });
    }
    this.sendTyping(false);
    if (this.data.emojiPanelVisible) {
      this.setData({ emojiPanelVisible: false });
      this.updateBottomPadding();
    }
    if (this.data.plusPanelVisible) {
      this.setData({ plusPanelVisible: false });
      this.updateBottomPadding();
    }
  },

  createClientId() {
    return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  },

  getMyProfile() {
    const sid = this.data.spaceId;
    const alias = wx.getStorageSync(`myAlias_${sid}`) || '';
    const avatar = wx.getStorageSync(`myAvatar_${sid}`) || '';
    return { alias, avatar };
  },

  toggleInputMode() {
    const nextMode = this.data.inputMode === 'text' ? 'audio' : 'text';
    this.setData({ inputMode: nextMode, recording: false });
    if (nextMode !== 'text') {
      this.sendTyping(false);
      if (this.data.emojiPanelVisible || this.data.plusPanelVisible) {
        this.setData({ emojiPanelVisible: false, plusPanelVisible: false });
        this.updateBottomPadding();
      }
    }
  },

  onUnload() {
    this.sendTyping(false);
    this._wsKeepAlive = false;
    this._pendingSends = [];
    this.cleanupWebSocket({ allowReconnect: false });
    if (this._netListener) {
      if (wx.offNetworkStatusChange) {
        try { wx.offNetworkStatusChange(this._netListener); } catch (e) {}
      }
      this._netListener = null;
    }
    if (this._heartBurstTimer) {
      clearTimeout(this._heartBurstTimer);
      this._heartBurstTimer = null;
    }
    if (this.audioCtx) {
      this.stopAudioPlayback();
      this.audioCtx.destroy();
      this.audioCtx = null;
    }
    if (wx.offKeyboardHeightChange && this._keyboardHeightHandler) {
      wx.offKeyboardHeightChange(this._keyboardHeightHandler);
      this._keyboardHeightHandler = null;
    }
  },

}, wsModule.methods, voiceModule.methods, stickerModule.methods, replyModule.methods, listModule.methods)); 
