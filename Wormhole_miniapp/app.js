// app.js
const { BASE_URL } = require('./utils/config.js');

App({
  globalData: {
    shouldReturnToIndex: false,
    skipNextHideRedirect: false,
    foregroundHoldCount: 0,
    hideTimer: null,
    lastHideTimestamp: 0,
  },

  markTemporaryForegroundAllowed() {
    const current = this.globalData.foregroundHoldCount || 0;
    this.globalData.foregroundHoldCount = current + 1;
    this.globalData.skipNextHideRedirect = true;
    this.globalData.shouldReturnToIndex = false;
    this.clearHideTimer();
    this.globalData.lastHideTimestamp = Date.now();
  },

  clearTemporaryForegroundFlag() {
    if (this.globalData.foregroundHoldCount && this.globalData.foregroundHoldCount > 0) {
      this.globalData.foregroundHoldCount -= 1;
    }
    if (this.globalData.foregroundHoldCount <= 0) {
      this.globalData.foregroundHoldCount = 0;
      this.globalData.skipNextHideRedirect = false;
      this.globalData.shouldReturnToIndex = false;
    }
  },

  clearHideTimer() {
    if (this.globalData.hideTimer) {
      clearTimeout(this.globalData.hideTimer);
      this.globalData.hideTimer = null;
    }
  },

  onLaunch() {
    // 登录获取openid
    wx.login({
      success: (res) => {
        if (res.code) {
          wx.request({
            url: `${BASE_URL}/api/auth/login`,
            method: 'POST',
            data: { code: res.code },
            success: (resp) => {
              const openid = resp.data.openid || resp.data.data?.openid;
              if (openid) {
                wx.setStorageSync('openid', openid);
              }
            }
          });
        }
      }
    });
  },

  onShow() {
    this.clearHideTimer();
    const now = Date.now();
    if (this.globalData.foregroundHoldCount > 0 || now - this.globalData.lastHideTimestamp < 800) {
      return;
    }
    if (!this.globalData.shouldReturnToIndex) return;
    this.globalData.shouldReturnToIndex = false;
    const pages = getCurrentPages();
    const currentPage = pages[pages.length - 1];
    if (!currentPage || currentPage.route !== 'pages/index/index') {
      wx.reLaunch({ url: '/pages/index/index' });
    } else if (typeof currentPage.resetSpaceCode === 'function') {
      currentPage.resetSpaceCode(true);
    }
  },

  onHide() {
    if (this.globalData.skipNextHideRedirect || (this.globalData.foregroundHoldCount || 0) > 0) {
      this.globalData.skipNextHideRedirect = false;
      this.globalData.lastHideTimestamp = Date.now();
      return;
    }
    this.clearHideTimer();
    this.globalData.hideTimer = setTimeout(() => {
      if (this.globalData.foregroundHoldCount > 0) {
        this.clearHideTimer();
        return;
      }
      this.globalData.shouldReturnToIndex = true;
      this.globalData.hideTimer = null;
      this.globalData.lastHideTimestamp = Date.now();
    }, 500);
  }
})
