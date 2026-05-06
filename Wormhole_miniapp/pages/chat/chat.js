const { ensureDiaryMode } = require('../../utils/review.js');
const { EMOJI_DISPLAY_LIST } = require('../../utils/wechat-emoji.js');
const wsModule = require('./chat-ws.js');
const voiceModule = require('./chat-voice.js');
const stickerModule = require('./chat-sticker.js');
const replyModule = require('./chat-reply.js');
const listModule = require('./chat-list.js');
const inputModule = require('./chat-input.js');

const CHAT_CACHE_LIMIT = 50;
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
    // Task 26: outgoing messages are persisted via utils/chat-outbox.js
    // (storage key chat_outbox_<spaceId>) and survive page reloads. The
    // legacy in-memory _pendingSends array is gone.
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

    // Task 26: re-hydrate any unsent messages persisted in the outbox so
    // the user sees them as still-sending bubbles after a reload.
    this.hydratePendingFromOutbox();

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

  onUnload() {
    this.sendTyping(false);
    this._wsKeepAlive = false;
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

}, wsModule.methods, voiceModule.methods, stickerModule.methods, replyModule.methods, listModule.methods, inputModule.methods)); 
