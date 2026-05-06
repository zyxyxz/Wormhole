const { BASE_URL } = require('../../utils/config.js');

const CUSTOM_STICKER_LIMIT = 120;

exports.methods = {
  normalizeCustomSticker(raw) {
    if (!raw) return null;
    const mediaUrl = String(raw.media_url || raw.mediaUrl || '').trim();
    if (!mediaUrl) return null;
    const id = Number(raw.id || 0);
    return {
      id: Number.isFinite(id) && id > 0 ? id : 0,
      mediaUrl,
      createdAt: raw.created_at || raw.createdAt || ''
    };
  },

  setCustomStickers(stickers) {
    const seen = new Set();
    const list = [];
    (Array.isArray(stickers) ? stickers : []).forEach((item) => {
      const normalized = this.normalizeCustomSticker(item);
      if (!normalized) return;
      const idKey = normalized.id > 0 ? `id:${normalized.id}` : '';
      const urlKey = `url:${normalized.mediaUrl}`;
      if ((idKey && seen.has(idKey)) || seen.has(urlKey)) return;
      if (idKey) seen.add(idKey);
      seen.add(urlKey);
      list.push(normalized);
    });
    this.setData({ customStickers: list.slice(0, CUSTOM_STICKER_LIMIT) });
  },

  fetchCustomStickers({ silent = true } = {}) {
    const userId = this._currentUserId || wx.getStorageSync('openid') || '';
    if (!userId) {
      this.ensureIdentity().then((uid) => {
        if (!uid) return;
        this.fetchCustomStickers({ silent });
      });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/chat/stickers`,
      data: { user_id: userId, limit: CUSTOM_STICKER_LIMIT },
      success: (res) => {
        if (res.statusCode !== 200) {
          if (!silent) {
            wx.showToast({ title: res.data?.detail || '加载表情失败', icon: 'none' });
          }
          return;
        }
        const stickers = Array.isArray(res.data?.stickers) ? res.data.stickers : [];
        this.setCustomStickers(stickers);
      },
      fail: () => {
        if (!silent) {
          wx.showToast({ title: '加载表情失败', icon: 'none' });
        }
      }
    });
  },

  addStickerToPack(mediaUrl, { silent = false } = {}) {
    const url = String(mediaUrl || '').trim();
    if (!url) {
      if (!silent) {
        wx.showToast({ title: '表情地址无效', icon: 'none' });
      }
      return;
    }
    const userId = this._currentUserId || wx.getStorageSync('openid') || '';
    if (!userId) {
      this.ensureIdentity().then((uid) => {
        if (!uid) {
          if (!silent) wx.showToast({ title: '未登录', icon: 'none' });
          return;
        }
        this.addStickerToPack(url, { silent });
      });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/chat/stickers/add`,
      method: 'POST',
      data: {
        user_id: userId,
        media_url: url
      },
      success: (res) => {
        if (res.statusCode !== 200 || res.data?.success === false) {
          if (!silent) {
            wx.showToast({ title: res.data?.detail || '添加失败', icon: 'none' });
          }
          return;
        }
        const sticker = this.normalizeCustomSticker(res.data?.sticker);
        if (sticker) {
          const current = Array.isArray(this.data.customStickers) ? this.data.customStickers : [];
          const merged = [sticker].concat(
            current.filter(item => item.mediaUrl !== sticker.mediaUrl && (!sticker.id || item.id !== sticker.id))
          );
          this.setCustomStickers(merged);
        } else {
          this.fetchCustomStickers({ silent: true });
        }
        if (!silent) {
          wx.showToast({ title: res.data?.existed ? '已在表情包' : '已添加表情', icon: 'none' });
        }
      },
      fail: () => {
        if (!silent) {
          wx.showToast({ title: '添加失败', icon: 'none' });
        }
      }
    });
  },

  chooseCustomSticker() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.enterForegroundHold === 'function') {
      app.enterForegroundHold(60000);
    }
    wx.chooseImage({
      count: 1,
      sourceType: ['album'],
      sizeType: ['compressed'],
      success: (res) => {
        const path = (res.tempFilePaths || [])[0];
        if (!path) return;
        wx.showLoading({ title: '上传中', mask: true });
        this.uploadMediaFile(path, 'sticker').then((url) => {
          if (!url) {
            wx.showToast({ title: '上传失败', icon: 'none' });
            return;
          }
          this.addStickerToPack(url, { silent: false });
        }).finally(() => {
          wx.hideLoading();
        });
      },
      complete: () => {
        if (app && typeof app.leaveForegroundHold === 'function') {
          app.leaveForegroundHold();
        }
      }
    });
  },

  sendCustomSticker(e) {
    const mediaUrl = String(e.currentTarget.dataset.url || '').trim();
    if (!mediaUrl) return;
    this.sendPayload({
      message_type: 'sticker',
      media_url: mediaUrl
    });
  },

  toggleEmojiPanel() {
    const next = !this.data.emojiPanelVisible;
    const nextData = next
      ? { emojiPanelVisible: true, plusPanelVisible: false, emojiScrollTop: 1 }
      : { emojiPanelVisible: false };
    this.setData(nextData, () => {
      this.updateBottomPadding({ forceMeasure: true });
      if (next) {
        this.fetchCustomStickers({ silent: true });
        setTimeout(() => {
          this.setData({ emojiScrollTop: 0 });
        }, 0);
        this.scrollToBottomIfNeeded();
      }
    });
  },

  addEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji;
    if (!emoji) return;
    const nextValue = `${this.data.inputMessage || ''}${emoji}`;
    this.setData({ inputMessage: nextValue });
    this.sendTyping(true);
  },
};
