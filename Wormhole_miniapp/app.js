// app.js
const { BASE_URL, WS_URL } = require('./utils/config.js');
const { SPACE_ROUTES } = require('./utils/routes.js');
const auth = require('./utils/auth.js');
const theme = require('./utils/theme.js');
const badge = require('./utils/badge.js');
const lock = require('./utils/lock.js');
const activity = require('./utils/activity.js');
const { THEME_PRESETS } = theme;

activity.installPageWrapper();

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
}, auth.methods, theme.methods, badge.methods, lock.methods, activity.methods))
