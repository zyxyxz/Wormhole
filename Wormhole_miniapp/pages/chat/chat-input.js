const { BASE_URL } = require('../../utils/config.js');

const MISS_YOU_SUFFIX = '在想你';

exports.methods = {
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

  noop() {},
};
