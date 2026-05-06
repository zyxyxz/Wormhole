// utils/lock.js — auto-lock + foreground hold + inactivity timer.
// Extracted from app.js by Task 20. All methods expect `this` bound to
// the App instance.
//
// SECURITY: 1 hour auto-lock default; getAutoLockOnHide defaults to true.
// Lowering either default requires a security review — privacy is core
// to this app.

exports.methods = {
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

  // SECURITY: defaults to 1 hour (3600s). Reducing this default requires security review.
  getAutoLockSeconds() {
    const stored = wx.getStorageSync('autoLockSeconds');
    if (stored === undefined || stored === null || stored === '') {
      return this.globalData.autoLockSeconds || 0;
    }
    return Number(stored) || 0;
  },

  // SECURITY: defaults to true. Privacy is core to this app — do not change without security review.
  getAutoLockOnHide() {
    const stored = wx.getStorageSync('autoLockOnHide');
    if (stored === undefined || stored === null || stored === '') {
      return true;
    }
    return !!stored;
  },

  startInactivityTimer() {
    this.stopInactivityTimer();
    const seconds = this.getAutoLockSeconds();
    if (!seconds || seconds <= 0) return;
    this.globalData.inactivityTimer = setTimeout(() => {
      this.globalData.inactivityTimer = null;
      const pages = getCurrentPages();
      const currentPage = pages[pages.length - 1];
      if (!currentPage || currentPage.route !== 'pages/index/index') {
        wx.reLaunch({ url: '/pages/index/index' });
      } else if (typeof currentPage.resetSpaceCode === 'function') {
        currentPage.resetSpaceCode(true);
      }
    }, seconds * 1000);
  },

  stopInactivityTimer() {
    if (this.globalData.inactivityTimer) {
      clearTimeout(this.globalData.inactivityTimer);
      this.globalData.inactivityTimer = null;
    }
  }
};
