// app.js
const { BASE_URL } = require('./utils/config.js');

App({
  globalData: {
    shouldReturnToIndex: false,
    skipNextHideRedirect: false,
    foregroundHoldCount: 0,
    holdUntil: 0,
    hideTimer: null,
    lastHideTimestamp: 0,
    autoLockSeconds: 3600,
    reviewMode: false,
  },

  enterForegroundHold(ms = 60000) {
    const now = Date.now();
    const target = now + ms;
    this.globalData.holdUntil = Math.max(this.globalData.holdUntil || 0, target);
    this.globalData.skipNextHideRedirect = true;
    this.globalData.shouldReturnToIndex = false;
    this.clearHideTimer();
    this.globalData.lastHideTimestamp = now;
  },

  leaveForegroundHold() {
    this.globalData.holdUntil = 0;
    this.globalData.skipNextHideRedirect = false;
    this.globalData.shouldReturnToIndex = false;
    this.clearHideTimer();
  },

  // 向下兼容旧方法
  markTemporaryForegroundAllowed() {
    this.enterForegroundHold(60000);
  },

  clearTemporaryForegroundFlag() {
    this.leaveForegroundHold();
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
    this.loadSystemFlags();
  },

  onShow() {
    this.clearHideTimer();
    const now = Date.now();
    if (now < (this.globalData.holdUntil || 0)) {
      return;
    }
    const autoLockMs = (wx.getStorageSync('autoLockSeconds') || this.globalData.autoLockSeconds || 0) * 1000;
    if (autoLockMs > 0 && now - this.globalData.lastHideTimestamp >= autoLockMs) {
      this.globalData.shouldReturnToIndex = true;
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
    if (this.globalData.skipNextHideRedirect || Date.now() < (this.globalData.holdUntil || 0)) {
      this.globalData.skipNextHideRedirect = false;
      this.globalData.lastHideTimestamp = Date.now();
      return;
    }
    this.clearHideTimer();
    this.globalData.hideTimer = setTimeout(() => {
      if (Date.now() < (this.globalData.holdUntil || 0)) {
        this.clearHideTimer();
        return;
      }
      this.globalData.shouldReturnToIndex = true;
      this.globalData.hideTimer = null;
      this.globalData.lastHideTimestamp = Date.now();
    }, 500);
  }
  ,

  loadSystemFlags() {
    wx.request({
      url: `${BASE_URL}/api/settings/system`,
      success: (res) => {
        const review = !!res.data?.review_mode;
        this.applyReviewMode(review);
      },
      fail: () => {
        const cached = !!wx.getStorageSync('reviewMode');
        this.applyReviewMode(cached);
      }
    });
  },

  applyReviewMode(flag) {
    this.globalData.reviewMode = !!flag;
    try { wx.setStorageSync('reviewMode', !!flag); } catch (e) {}
    try {
      if (flag) {
        wx.hideTabBar({ animation: false });
      } else {
        wx.showTabBar({ animation: false });
      }
    } catch (e) {}
  }
})
