// app.js
const { BASE_URL } = require('./utils/config.js');

App({
  globalData: {
    shouldReturnToIndex: false,
    skipNextHideRedirect: false,
    foregroundHoldCount: 0,
  },

  markTemporaryForegroundAllowed() {
    const current = this.globalData.foregroundHoldCount || 0;
    this.globalData.foregroundHoldCount = current + 1;
    this.globalData.skipNextHideRedirect = true;
  },

  clearTemporaryForegroundFlag() {
    if (this.globalData.foregroundHoldCount && this.globalData.foregroundHoldCount > 0) {
      this.globalData.foregroundHoldCount -= 1;
    }
    if (this.globalData.foregroundHoldCount <= 0) {
      this.globalData.foregroundHoldCount = 0;
      this.globalData.skipNextHideRedirect = false;
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
      return;
    }
    this.globalData.shouldReturnToIndex = true;
  }
})
