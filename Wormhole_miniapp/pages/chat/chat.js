const { BASE_URL, WS_URL } = require('../../utils/config.js');

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
    spaceId: '',
    keyboardHeight: 0,
    bottomPadding: 120,
    _baseBottomPadding: 120,
    recording: false,
    audioPlayingId: null,
    inputMode: 'text',
  },
  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onLoad() {
    // 获取空间ID
    const spaceId = wx.getStorageSync('currentSpaceId');
    const openid = wx.getStorageSync('openid');
    this.setData({ spaceId });
    
    // 初始化基础 padding（约 104rpx 高度）
    try {
      const sys = wx.getSystemInfoSync();
      const rpx = sys.windowWidth / 750;
      const base = Math.ceil(150 * rpx + 24); // 输入区 + 安全距离
      this.setData({ _baseBottomPadding: base, bottomPadding: base });
    } catch(e) {}

    // 键盘高度变化监听
    if (wx.onKeyboardHeightChange) {
      wx.onKeyboardHeightChange(res => {
        const kh = res.height || 0;
        this.setData({ 
          keyboardHeight: kh,
          bottomPadding: (this.data._baseBottomPadding || 120) + kh
        });
        this.scrollToBottom();
      });
    }

    // 初始化WebSocket连接
    this.initWebSocket();
    
    // 获取历史消息
    this.getHistoryMessages();

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
  },
  onShow() {
    // 若昵称更新，刷新历史以展示新昵称
    const updated = wx.getStorageSync('aliasUpdatedAt');
    if (updated) {
      this.getHistoryMessages();
    }
  },
  onBack() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  initWebSocket() {
    const url = `${WS_URL}/ws/chat/${this.data.spaceId}`;
    const ws = wx.connectSocket({ url });

    ws.onOpen(() => {
      console.log('WebSocket 已连接:', url);
    });

    ws.onMessage((res) => {
      let message = {};
      try {
        message = JSON.parse(res.data);
      } catch (e) {
        message = res.data;
      }
      const displayed = this.decorateMessage(message, wx.getStorageSync('openid'));
      this.addMessage(displayed);
    });

    ws.onClose(() => {
      console.log('WebSocket 已关闭，3秒后重连...');
      setTimeout(() => this.initWebSocket(), 3000);
    });

    ws.onError(() => {
      console.log('WebSocket 连接错误');
    });

    this.ws = ws;
  },

  getHistoryMessages() {
    wx.request({
      url: `${BASE_URL}/api/chat/history`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        const myid = wx.getStorageSync('openid');
        const msgs = (res.data.messages || []).map(m => this.decorateMessage(m, myid));
        this.setData({ 
          messages: msgs,
          lastMessageId: msgs.length ? `msg-${msgs[msgs.length - 1].id}` : ''
        });
      },
      fail: () => {
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
    wx.showLoading({ title: '发送中', mask: true });
    wx.uploadFile({
      url: `${BASE_URL}/api/upload`,
      filePath,
      name: 'file',
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
    this.setData({ inputMessage: e.detail.value });
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
    const message = {
      space_id: this.data.spaceId,
      user_id: wx.getStorageSync('openid') || '',
      content: payload.content || '',
      message_type: payload.message_type || 'text',
      media_url: payload.media_url || null,
      media_duration: payload.media_duration || null,
    };
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
        this.getHistoryMessages();
      }
    });
  },

  addMessage(message) {
    const messages = [...this.data.messages, message];
    this.setData({ 
      messages,
      lastMessageId: `msg-${message.id}`
    });
  },

  toggleInputMode() {
    const nextMode = this.data.inputMode === 'text' ? 'audio' : 'text';
    this.setData({ inputMode: nextMode, recording: false });
  },

  decorateMessage(message, myId) {
    const nickname = message.alias || message.user_id || '匿名';
    const avatar = message.avatar_url || '';
    const initialSource = nickname || message.user_id || '匿';
    const duration = message.media_duration ? Math.round(message.media_duration / 1000) : 0;
    return {
      id: message.id,
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
    };
  },

  scrollToBottom() {
    const arr = this.data.messages || [];
    if (arr.length) {
      const id = arr[arr.length - 1].id;
      this.setData({ lastMessageId: `msg-${id}` });
    }
  },

  onUnload() {
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
