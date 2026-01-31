// app.js
const { BASE_URL } = require('./utils/config.js');

const SPACE_ROUTES = new Set([
  'pages/chat/chat',
  'pages/notes/notes',
  'pages/space/space',
  'pages/wallet/wallet',
  'pages/post-create/post-create',
  'pages/note-edit/note-edit',
  'pages/recharge/recharge'
]);

const originalPage = Page;
Page = function (pageConfig) {
  const lifecycleHooks = new Set([
    'onLoad', 'onShow', 'onReady', 'onHide', 'onUnload',
    'onPullDownRefresh', 'onReachBottom', 'onPageScroll',
    'onShareAppMessage', 'onAddToFavorites', 'onPageResize', 'onTabItemTap'
  ]);
  Object.keys(pageConfig).forEach((key) => {
    const fn = pageConfig[key];
    if (typeof fn !== 'function' || lifecycleHooks.has(key)) return;
    pageConfig[key] = function () {
      try {
        const app = getApp();
        if (app && typeof app.recordUserActivity === 'function') {
          app.recordUserActivity();
        }
      } catch (e) {}
      return fn.apply(this, arguments);
    };
  });

  const originalOnShow = pageConfig.onShow;
  pageConfig.onShow = function () {
    try {
      const app = getApp();
      if (app && typeof app.recordUserActivity === 'function') {
        app.recordUserActivity();
      }
      if (app && typeof app.startInactivityTimer === 'function') {
        app.startInactivityTimer();
      }
      if (app && typeof app.logPageView === 'function') {
        app.logPageView(this.route, this.options || {});
      }
      if (app && typeof app.refreshNotesBadge === 'function') {
        app.refreshNotesBadge(this.route);
      }
    } catch (e) {}
    if (typeof originalOnShow === 'function') {
      return originalOnShow.apply(this, arguments);
    }
  };

  const originalOnHide = pageConfig.onHide;
  pageConfig.onHide = function () {
    try {
      const app = getApp();
      if (app && typeof app.stopInactivityTimer === 'function') {
        app.stopInactivityTimer();
      }
    } catch (e) {}
    if (typeof originalOnHide === 'function') {
      return originalOnHide.apply(this, arguments);
    }
  };

  return originalPage(pageConfig);
};

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
    inactivityTimer: null,
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

  getAutoLockSeconds() {
    const stored = wx.getStorageSync('autoLockSeconds');
    if (stored === undefined || stored === null || stored === '') {
      return this.globalData.autoLockSeconds || 0;
    }
    return Number(stored) || 0;
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
  },

  recordUserActivity() {
    this.startInactivityTimer();
  },

  logOperation(payload = {}) {
    const userId = payload.user_id || wx.getStorageSync('openid') || '';
    if (!userId || !payload.action) return;
    wx.request({
      url: `${BASE_URL}/api/logs/track`,
      method: 'POST',
      data: {
        user_id: userId,
        action: payload.action,
        page: payload.page || '',
        detail: payload.detail || '',
        space_id: payload.space_id || null
      }
    });
  },

  logPageView(route, options = {}) {
    const spaceId = SPACE_ROUTES.has(route) ? (wx.getStorageSync('currentSpaceId') || null) : null;
    let detail = '';
    try {
      if (options && Object.keys(options).length) {
        detail = JSON.stringify(options);
      }
    } catch (e) {}
    this.logOperation({
      action: 'page_view',
      page: route,
      detail,
      space_id: spaceId
    });
  },

  getNotesLastSeenKey(spaceId) {
    return spaceId ? `notes_last_seen_${spaceId}` : 'notes_last_seen';
  },

  markNotesRead(spaceId) {
    const sid = spaceId || wx.getStorageSync('currentSpaceId');
    if (!sid) return;
    try {
      wx.setStorageSync(this.getNotesLastSeenKey(sid), Date.now());
    } catch (e) {}
    this.clearNotesBadge();
  },

  clearNotesBadge() {
    try {
      wx.removeTabBarBadge({ index: 1 });
    } catch (e) {}
  },

  refreshNotesBadge(currentRoute = '') {
    if (this.globalData.reviewMode) return;
    const sid = wx.getStorageSync('currentSpaceId');
    if (!sid) {
      this.clearNotesBadge();
      return;
    }
    if (currentRoute === 'pages/notes/notes') {
      this.clearNotesBadge();
      return;
    }
    if (this._notesBadgeLoading) return;
    let since = null;
    try {
      since = wx.getStorageSync(this.getNotesLastSeenKey(sid));
    } catch (e) {}
    if (!since) {
      this.clearNotesBadge();
      return;
    }
    this._notesBadgeLoading = true;
    const uid = wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/feed/unread-count`,
      data: { space_id: sid, since_ts: since, user_id: uid },
      success: (res) => {
        const count = Math.max(0, res.data?.count || 0);
        if (count > 0) {
          const text = count > 99 ? '99+' : String(count);
          try { wx.setTabBarBadge({ index: 1, text }); } catch (e) {}
        } else {
          this.clearNotesBadge();
        }
      },
      complete: () => {
        this._notesBadgeLoading = false;
      }
    });
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
    if (this.globalData.shouldReturnToIndex) {
      this.globalData.shouldReturnToIndex = false;
      const pages = getCurrentPages();
      const currentPage = pages[pages.length - 1];
      if (!currentPage || currentPage.route !== 'pages/index/index') {
        wx.reLaunch({ url: '/pages/index/index' });
      } else if (typeof currentPage.resetSpaceCode === 'function') {
        currentPage.resetSpaceCode(true);
      }
      return;
    }
    this.startInactivityTimer();
  },

  onHide() {
    const now = Date.now();
    if (this.globalData.skipNextHideRedirect || now < (this.globalData.holdUntil || 0)) {
      this.globalData.skipNextHideRedirect = false;
      this.globalData.lastHideTimestamp = now;
      return;
    }
    this.stopInactivityTimer();
    this.clearHideTimer();
    this.globalData.shouldReturnToIndex = true;
    this.globalData.lastHideTimestamp = now;
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
