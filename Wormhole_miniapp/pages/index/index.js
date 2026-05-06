// index.js
const { BASE_URL } = require('../../utils/config.js');

const emptySpaceCode = () => ['', '', '', '', '', ''];

Page({
  data: {
    spaceCode: emptySpaceCode(),
    reviewMode: false,
  },

  onShow() {
    this.resetSpaceCode();
    this.syncReviewMode();
    const app = getApp && getApp();
    if (app && typeof app.applyThemeForRoute === 'function') {
      app.applyThemeForRoute(this.route, this);
    } else if (app && typeof app.applyThemeToPage === 'function') {
      app.applyThemeToPage(this);
    }
  },

  syncReviewMode() {
    const review = !!wx.getStorageSync('reviewMode');
    this.setData({ reviewMode: review });
    try {
      review ? wx.hideTabBar({ animation: false }) : wx.showTabBar({ animation: false });
    } catch (e) {}
  },

  resetSpaceCode(force = false) {
    const hasDigits = (this.data.spaceCode || []).some(d => d !== '');
    if (!force && !hasDigits) return;
    this.setData({ spaceCode: emptySpaceCode() });
    if (this._enterDebounce) {
      clearTimeout(this._enterDebounce);
      this._enterDebounce = null;
    }
    this._lastEnteredCode = '';
  },

  onUnload() {
    if (this._enterDebounce) {
      clearTimeout(this._enterDebounce);
      this._enterDebounce = null;
    }
  },

  onKeyTap(e) {
    const key = e.currentTarget.dataset.key;
    let spaceCode = [...this.data.spaceCode];
    const emptyIndex = spaceCode.findIndex(digit => digit === '');

    if (key === '删除') {
      const lastFilledIndex = spaceCode.map(digit => digit !== '').lastIndexOf(true);
      if (lastFilledIndex !== -1) {
        spaceCode[lastFilledIndex] = '';
      }
    } else if (key !== '' && emptyIndex !== -1) {
      spaceCode[emptyIndex] = key;
    }

    this.setData({ spaceCode }, () => {
      // Cancel any pending enter; if length drops below 6 we want to abort.
      if (this._enterDebounce) {
        clearTimeout(this._enterDebounce);
        this._enterDebounce = null;
      }
      if (this.data.spaceCode.every(d => d !== '')) {
        const code = this.data.spaceCode.join('');
        // 200ms debounce in case the user is mid-paste / mistapping the last digit;
        // after that, enter directly (no confirm dialog).
        this._enterDebounce = setTimeout(() => {
          this._enterDebounce = null;
          this._enterRoom(code);
        }, 200);
      }
    });
  },

  _enterRoom(code) {
    if (!code || code.length !== 6) return;
    // Make sure the digits in data still match (user may have backspaced after timeout fired).
    if (this.data.spaceCode.join('') !== code) return;
    if (this._entering) return;
    if (this._lastEnteredCode === code) return;
    this._entering = true;
    this._lastEnteredCode = code;
    try {
      this.onConfirm();
    } finally {
      // Reset the in-flight flag so a failed network call doesn't lock the user out.
      setTimeout(() => { this._entering = false; }, 1000);
    }
  },

  onConfirm() {
    const code = this.data.spaceCode.join('');
    if (code.length !== 6) return;
    const app = getApp && getApp();
    const ensure = app && typeof app.ensureOpenId === 'function'
      ? app.ensureOpenId()
      : Promise.resolve(wx.getStorageSync('openid') || '');
    ensure.then((openid) => {
      if (!openid) {
        wx.showToast({ title: '登录中，请稍后再试', icon: 'none' });
        return;
      }
      wx.request({
        url: `${BASE_URL}/api/space/enter`,
        method: 'POST',
        data: { space_code: code, user_id: openid, create_if_missing: true },
        success: (res) => {
          const data = res.data || {};
          if (data.admin_entry) {
            this.resetSpaceCode(true);
            wx.navigateTo({ url: `/pages/admin/admin?room_code=${code}` });
            return;
          }
          if (data.success) {
            wx.setStorageSync('currentSpaceId', data.space_id);
            wx.setStorageSync('currentSpaceCode', code);
            if (app && typeof app.primeRoomRuntimeConfig === 'function') {
              app.primeRoomRuntimeConfig({ spaceId: data.space_id, themePreference: data.theme_preference || '' });
            }
            const review = !!wx.getStorageSync('reviewMode');
            if (review) {
              wx.reLaunch({ url: '/pages/notes/notes' });
              try { wx.hideTabBar({ animation: false }); } catch (e) {}
            } else {
              wx.switchTab({ url: '/pages/chat/chat' });
            }
          } else {
            wx.showToast({ title: data?.message || '进入失败', icon: 'none' });
          }
        },
        fail: () => {
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      });
    });
  },

  goJoinByShare() {
    wx.navigateTo({ url: '/pages/join/join' });
  }
});
