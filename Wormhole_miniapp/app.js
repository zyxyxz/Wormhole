// app.js
const { BASE_URL, WS_URL } = require('./utils/config.js');
const { SPACE_ROUTES } = require('./utils/routes.js');
const auth = require('./utils/auth.js');
const theme = require('./utils/theme.js');
const { THEME_PRESETS } = theme;

const originalPage = Page;
Page = function (pageConfig) {
  const appInstance = typeof getApp === 'function' ? getApp() : null;
  const originalData = (pageConfig.data && typeof pageConfig.data === 'object') ? pageConfig.data : {};
  const themeDefaults = appInstance && appInstance.globalData ? {
    themePreference: appInstance.globalData.themePreference,
    themeMode: appInstance.globalData.themeMode,
    themeClass: appInstance.globalData.themeClass,
    themeNavBg: appInstance.globalData.themeNavBg,
    themeNavText: appInstance.globalData.themeNavText,
    themeNavFront: appInstance.globalData.themeNavFront
  } : {};
  pageConfig.data = Object.assign({}, themeDefaults, originalData);
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

  const originalOnLoad = pageConfig.onLoad;
  pageConfig.onLoad = function () {
    try {
      const app = getApp();
      if (app && typeof app.applyThemeForRoute === 'function') {
        app.applyThemeForRoute(this.route, this);
      }
    } catch (e) {}
    if (typeof originalOnLoad === 'function') {
      return originalOnLoad.apply(this, arguments);
    }
  };

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
      if (app && typeof app.applyThemeForRoute === 'function') {
        app.applyThemeForRoute(this.route, this);
      }
      if (app && typeof app.refreshNotesBadge === 'function') {
        app.refreshNotesBadge(this.route);
      }
      if (app && typeof app.refreshChatBadge === 'function') {
        app.refreshChatBadge(this.route);
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

App(Object.assign({
  globalData: {
    shouldReturnToIndex: false,
    skipNextHideRedirect: false,
    foregroundHoldCount: 0,
    holdUntil: 0,
    hideTimer: null,
    lastHideTimestamp: 0,
    // SECURITY: 1 hour auto-lock — privacy guard, do not lower without review.
    autoLockSeconds: 3600,
    reviewMode: false,
    inactivityTimer: null,
    systemTheme: 'light',
    themePreference: 'system',
    themeMode: 'light',
    themeClass: 'theme-light',
    themeNavBg: THEME_PRESETS.light.navBg,
    themeNavText: THEME_PRESETS.light.navText,
    themeNavFront: THEME_PRESETS.light.navFront,
    themeTabBg: THEME_PRESETS.light.tabBg,
    themeTabText: THEME_PRESETS.light.tabText,
    themeTabSelected: THEME_PRESETS.light.tabSelected,
    themeTabBorderStyle: THEME_PRESETS.light.tabBorderStyle
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

  // SECURITY: defaults to 1 hour (3600s). Reducing this default requires security review.
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

  getChatBadgeKey(spaceId) {
    return spaceId ? `chat_badge_${spaceId}` : 'chat_badge';
  },

  clearChatBadge(spaceId) {
    try {
      wx.removeTabBarBadge({ index: 0 });
    } catch (e) {}
    const sid = spaceId || wx.getStorageSync('currentSpaceId');
    if (sid) {
      try { wx.removeStorageSync(this.getChatBadgeKey(sid)); } catch (e) {}
    }
  },

  setChatBadgeCount(spaceId, count) {
    const sid = spaceId || wx.getStorageSync('currentSpaceId');
    if (!sid) return;
    const safe = Math.max(0, Number(count) || 0);
    try { wx.setStorageSync(this.getChatBadgeKey(sid), safe); } catch (e) {}
    if (safe > 0) {
      const text = safe > 99 ? '99+' : String(safe);
      try { wx.setTabBarBadge({ index: 0, text }); } catch (e) {}
    } else {
      this.clearChatBadge(sid);
    }
  },

  bumpChatBadge(spaceId, delta = 1) {
    const sid = spaceId || wx.getStorageSync('currentSpaceId');
    if (!sid) return;
    let current = 0;
    try { current = Number(wx.getStorageSync(this.getChatBadgeKey(sid)) || 0); } catch (e) {}
    this.setChatBadgeCount(sid, current + (Number(delta) || 0));
  },

  // Cold-start one-shot HTTP fallback. Live updates flow through the
  // spaceEventSocket below (`unread_inc` events) — Task 11 retired the
  // 10 s polling that used to call this on a setInterval.
  refreshChatBadge(currentRoute = '') {
    if (this.globalData.reviewMode) return;
    if (this._chatBadgeDisabled) return;
    const sid = wx.getStorageSync('currentSpaceId');
    if (!sid) {
      this.clearChatBadge();
      return;
    }
    if (currentRoute === 'pages/chat/chat') {
      this.clearChatBadge();
      return;
    }
    if (this._chatBadgeLoading) return;
    const uid = wx.getStorageSync('openid') || '';
    if (!uid) return;
    this._chatBadgeLoading = true;
    wx.request({
      url: `${BASE_URL}/api/chat/unread-count`,
      data: { space_id: sid, user_id: uid },
      success: (res) => {
        if (res.statusCode === 404) {
          this._chatBadgeDisabled = true;
          this.clearChatBadge();
          return;
        }
        const count = Math.max(0, res.data?.count || 0);
        this.setChatBadgeCount(sid, count);
      },
      complete: () => {
        this._chatBadgeLoading = false;
      }
    });
  },

  // Global event_manager listener. Connects to /ws/space/{space_id} so
  // unread_inc events bump the chat tab badge live, retiring the prior
  // 10 s polling. The chat page has its own /ws/chat/{space_id} socket
  // (chat_manager) — when the route is pages/chat/chat, bumpChatBadge /
  // refreshChatBadge already short-circuit and clear the badge instead,
  // so the extra connection is functionally idempotent.
  connectSpaceEvents() {
    if (this.globalData.reviewMode) return;
    if (this._spaceEventSocket || this._spaceEventConnecting) return;
    const sid = wx.getStorageSync('currentSpaceId');
    const uid = wx.getStorageSync('openid') || '';
    if (!sid || !uid) return;
    this._spaceEventDesired = true;
    this._spaceEventConnecting = true;
    const url = `${WS_URL}/ws/space/${sid}?user_id=${encodeURIComponent(uid)}`;
    let sock;
    try {
      sock = wx.connectSocket({ url });
    } catch (e) {
      this._spaceEventConnecting = false;
      this._scheduleSpaceEventsReconnect();
      return;
    }
    this._spaceEventSocket = sock;
    this._spaceEventSpaceId = sid;
    this._spaceEventUserId = uid;
    sock.onOpen(() => {
      this._spaceEventConnecting = false;
      this._spaceEventBackoff = 0;
    });
    sock.onMessage((res) => {
      let msg = null;
      try { msg = JSON.parse(res.data); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.event !== 'unread_inc') return;
      const currentSid = wx.getStorageSync('currentSpaceId');
      if (!currentSid || String(currentSid) !== String(this._spaceEventSpaceId)) return;
      if (msg.from_user_id && msg.from_user_id === this._spaceEventUserId) return;
      const pages = getCurrentPages();
      const route = pages[pages.length - 1]?.route || '';
      if (route === 'pages/chat/chat') {
        this.clearChatBadge(currentSid);
        return;
      }
      this.bumpChatBadge(currentSid, 1);
    });
    sock.onClose(() => {
      this._spaceEventConnecting = false;
      this._spaceEventSocket = null;
      this._scheduleSpaceEventsReconnect();
    });
    sock.onError(() => {
      this._spaceEventConnecting = false;
      this._spaceEventSocket = null;
      this._scheduleSpaceEventsReconnect();
    });
  },

  _scheduleSpaceEventsReconnect() {
    if (!this._spaceEventDesired) return;
    if (this._spaceEventReconnectTimer) return;
    if (!wx.getStorageSync('currentSpaceId')) return;
    if (!wx.getStorageSync('openid')) return;
    const attempts = (this._spaceEventBackoff || 0) + 1;
    this._spaceEventBackoff = attempts;
    const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempts, 5)));
    this._spaceEventReconnectTimer = setTimeout(() => {
      this._spaceEventReconnectTimer = null;
      this.connectSpaceEvents();
    }, delay);
  },

  disconnectSpaceEvents() {
    this._spaceEventDesired = false;
    if (this._spaceEventReconnectTimer) {
      clearTimeout(this._spaceEventReconnectTimer);
      this._spaceEventReconnectTimer = null;
    }
    this._spaceEventBackoff = 0;
    const sock = this._spaceEventSocket;
    this._spaceEventSocket = null;
    this._spaceEventSpaceId = null;
    this._spaceEventUserId = null;
    this._spaceEventConnecting = false;
    if (sock) {
      try { sock.close({}); } catch (e) {}
    }
  },

  onLaunch() {
    this.patchNetworkSecurity();
    this.initThemeManager();
    this.ensureOpenId();
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
    this.connectSpaceEvents();
  },

  onHide() {
    const now = Date.now();
    if (this.globalData.skipNextHideRedirect || now < (this.globalData.holdUntil || 0)) {
      this.globalData.skipNextHideRedirect = false;
      this.globalData.lastHideTimestamp = now;
      return;
    }
    this.stopInactivityTimer();
    this.disconnectSpaceEvents();
    this.clearHideTimer();
    this.globalData.shouldReturnToIndex = this.getAutoLockOnHide();
    this.globalData.lastHideTimestamp = now;
  }
  ,
  // SECURITY: defaults to true. Privacy is core to this app — do not change without security review.
  getAutoLockOnHide() {
    const stored = wx.getStorageSync('autoLockOnHide');
    if (stored === undefined || stored === null || stored === '') {
      return true;
    }
    return !!stored;
  },

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
}, auth.methods, theme.methods))
