// app.js
const { BASE_URL } = require('./utils/config.js');

const SPACE_ROUTES = new Set([
  'pages/chat/chat',
  'pages/notes/notes',
  'pages/space/space',
  'pages/wallet/wallet',
  'pages/post-create/post-create',
  'pages/note-edit/note-edit',
  'pages/recharge/recharge',
  'pages/settings/settings'
]);

const CUSTOM_NAV_ROUTES = new Set([
  'pages/index/index',
  'pages/chat/chat',
  'pages/notes/notes',
  'pages/wallet/wallet',
  'pages/settings/settings',
  'pages/join/join',
  'pages/admin/admin',
  'pages/admin-space/admin-space',
  'pages/admin-logs/admin-logs'
]);

const TAB_ROUTES = new Set([
  'pages/chat/chat',
  'pages/notes/notes',
  'pages/wallet/wallet',
  'pages/settings/settings'
]);

const THEME_PRESETS = {
  light: {
    navBg: '#FFFFFF',
    navText: '#0F172A',
    navFront: '#000000',
    tabBg: '#FFFFFF',
    tabText: '#64748B',
    tabSelected: '#14B8A6',
    tabBorderStyle: 'white'
  },
  dark: {
    navBg: '#0B1220',
    navText: '#E5E7EB',
    navFront: '#FFFFFF',
    tabBg: '#0B1220',
    tabText: '#9CA3AF',
    tabSelected: '#5EEAD4',
    tabBorderStyle: 'black'
  }
};

const TAB_ICON_SETS = {
  light: [
    { icon: '/assets/icons/chat.png', selected: '/assets/icons/chat-active.png' },
    { icon: '/assets/icons/notes.png', selected: '/assets/icons/notes-active.png' },
    { icon: '/assets/icons/wallet.png', selected: '/assets/icons/wallet-active.png' },
    { icon: '/assets/icons/settings.png', selected: '/assets/icons/settings-active.png' }
  ],
  dark: [
    { icon: '/assets/icons/chat-dark.png', selected: '/assets/icons/chat-active.png' },
    { icon: '/assets/icons/notes-dark.png', selected: '/assets/icons/notes-active.png' },
    { icon: '/assets/icons/wallet-dark.png', selected: '/assets/icons/wallet-active.png' },
    { icon: '/assets/icons/settings-dark.png', selected: '/assets/icons/settings-active.png' }
  ]
};

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

  getSystemThemeLegacy() {
    try {
      const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
      return info.theme || 'light';
    } catch (e) {
      return 'light';
    }
  },

  normalizeThemePreference(pref) {
    if (!pref) return 'system';
    const val = String(pref).toLowerCase();
    if (val === 'dark' || val === 'light' || val === 'system') return val;
    return val;
  },

  computeThemeMode(pref) {
    const normalized = this.normalizeThemePreference(pref);
    if (normalized === 'system') {
      return this.globalData.systemTheme || 'light';
    }
    return normalized;
  },

  getThemePreset(mode) {
    return THEME_PRESETS[mode] || THEME_PRESETS.light;
  },

  getSpaceThemeKey(spaceId) {
    return spaceId ? `space_theme_${spaceId}` : 'space_theme_default';
  },

  getStoredThemePreference(spaceId) {
    try {
      return wx.getStorageSync(this.getSpaceThemeKey(spaceId)) || '';
    } catch (e) {
      return '';
    }
  },

  setStoredThemePreference(spaceId, pref) {
    if (!spaceId) return;
    try {
      wx.setStorageSync(this.getSpaceThemeKey(spaceId), pref);
    } catch (e) {}
  },

  applyThemePreference(pref, { spaceId = null, persist = false } = {}) {
    const normalized = this.normalizeThemePreference(pref);
    const mode = this.computeThemeMode(normalized);
    const preset = this.getThemePreset(mode);
    this.globalData.themePreference = normalized;
    this.globalData.themeMode = mode;
    this.globalData.themeClass = `theme-${mode}`;
    this.globalData.themeNavBg = preset.navBg;
    this.globalData.themeNavText = preset.navText;
    this.globalData.themeNavFront = preset.navFront;
    this.globalData.themeTabBg = preset.tabBg;
    this.globalData.themeTabText = preset.tabText;
    this.globalData.themeTabSelected = preset.tabSelected;
    this.globalData.themeTabBorderStyle = preset.tabBorderStyle;
    if (persist && spaceId) {
      this.setStoredThemePreference(spaceId, normalized);
    }
    this.applyTabBarStyle();
  },

  applyTabBarStyle() {
    if (!wx.setTabBarStyle) return;
    try {
      wx.setTabBarStyle({
        backgroundColor: this.globalData.themeTabBg,
        color: this.globalData.themeTabText,
        selectedColor: this.globalData.themeTabSelected,
        borderStyle: this.globalData.themeTabBorderStyle
      });
    } catch (e) {}
    this.applyTabBarIcons();
  },

  applyTabBarIcons() {
    if (!wx.setTabBarItem) return;
    const mode = this.globalData.themeMode || 'light';
    const set = TAB_ICON_SETS[mode] || TAB_ICON_SETS.light;
    set.forEach((item, index) => {
      try {
        wx.setTabBarItem({
          index,
          iconPath: item.icon,
          selectedIconPath: item.selected
        });
      } catch (e) {}
    });
  },

  applyThemeToPage(page) {
    if (!page || typeof page.setData !== 'function') return;
    const route = page.route || page.__route__ || '';
    page.setData({
      themePreference: this.globalData.themePreference,
      themeMode: this.globalData.themeMode,
      themeClass: this.globalData.themeClass,
      themeNavBg: this.globalData.themeNavBg,
      themeNavText: this.globalData.themeNavText,
      themeNavFront: this.globalData.themeNavFront
    });
    if (route && TAB_ROUTES.has(route)) {
      this.applyTabBarStyle();
    }
    if (!route || !CUSTOM_NAV_ROUTES.has(route)) {
      try {
        wx.setNavigationBarColor({
          frontColor: this.globalData.themeNavFront,
          backgroundColor: this.globalData.themeNavBg
        });
      } catch (e) {}
    }
  },

  async fetchThemePreference(spaceId) {
    if (!spaceId) return '';
    if (this._themeFetchInFlight?.[spaceId]) return '';
    const openid = wx.getStorageSync('openid');
    if (!openid) return '';
    this._themeFetchInFlight = this._themeFetchInFlight || {};
    this._themeFetchInFlight[spaceId] = true;
    return new Promise((resolve) => {
      wx.request({
        url: `${BASE_URL}/api/user/alias`,
        data: { space_id: spaceId, user_id: openid },
        success: (res) => {
          const pref = res.data?.theme_preference || '';
          resolve(pref);
        },
        fail: () => resolve(''),
        complete: () => {
          this._themeFetchInFlight[spaceId] = false;
        }
      });
    });
  },

  applyThemeForRoute(route, page) {
    const inSpace = SPACE_ROUTES.has(route);
    if (!inSpace) {
      this.applyThemePreference('system', { persist: false });
      this.applyThemeToPage(page);
      return;
    }
    const spaceId = wx.getStorageSync('currentSpaceId');
    const stored = this.getStoredThemePreference(spaceId);
    if (stored) {
      this.applyThemePreference(stored, { spaceId, persist: false });
      this.applyThemeToPage(page);
    } else {
      this.applyThemePreference('system', { spaceId, persist: false });
      this.applyThemeToPage(page);
    }
    this.fetchThemePreference(spaceId).then((remotePref) => {
      if (!remotePref) return;
      if (remotePref === stored) return;
      this.applyThemePreference(remotePref, { spaceId, persist: true });
      this.refreshThemeOnActivePages();
    });
  },

  refreshThemeOnActivePages() {
    const pages = getCurrentPages();
    pages.forEach((p) => this.applyThemeToPage(p));
    this.applyTabBarStyle();
  },

  initThemeManager() {
    this.globalData.systemTheme = 'light';
    this.applyThemePreference('system', { persist: false });
    this.fetchSystemTheme();
    if (wx.onThemeChange) {
      wx.onThemeChange((res) => {
        this.setSystemTheme(res && res.theme);
      });
    }
  },

  fetchSystemTheme() {
    let resolved = false;
    const markResolved = (theme) => {
      resolved = true;
      this.setSystemTheme(theme);
    };
    if (wx.getSystemSetting) {
      try {
        wx.getSystemSetting({
          success: (res) => {
            if (res && res.theme) {
              markResolved(res.theme);
            }
          }
        });
      } catch (e) {}
    }
    if (wx.getSystemInfo) {
      try {
        wx.getSystemInfo({
          success: (res) => {
            if (res && res.theme) {
              markResolved(res.theme);
            }
          },
          complete: () => {
            if (!resolved) {
              markResolved(this.getSystemThemeLegacy());
            }
          }
        });
        return;
      } catch (e) {}
    }
    if (!resolved) {
      markResolved(this.getSystemThemeLegacy());
    }
  },

  setSystemTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    if (this.globalData.systemTheme === next) {
      if (this.globalData.themePreference === 'system') {
        this.applyThemePreference('system', { persist: false });
        this.refreshThemeOnActivePages();
      }
      return;
    }
    this.globalData.systemTheme = next;
    if (this.globalData.themePreference === 'system') {
      this.applyThemePreference('system', { persist: false });
    }
    this.refreshThemeOnActivePages();
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
          this.stopChatBadgeTimer();
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

  onLaunch() {
    this.initThemeManager();
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
    this.startChatBadgeTimer();
  },

  onHide() {
    const now = Date.now();
    if (this.globalData.skipNextHideRedirect || now < (this.globalData.holdUntil || 0)) {
      this.globalData.skipNextHideRedirect = false;
      this.globalData.lastHideTimestamp = now;
      return;
    }
    this.stopInactivityTimer();
    this.stopChatBadgeTimer();
    this.clearHideTimer();
    this.globalData.shouldReturnToIndex = this.getAutoLockOnHide();
    this.globalData.lastHideTimestamp = now;
  }
  ,
  getAutoLockOnHide() {
    const stored = wx.getStorageSync('autoLockOnHide');
    if (stored === undefined || stored === null || stored === '') {
      return true;
    }
    return !!stored;
  },

  startChatBadgeTimer() {
    if (this._chatBadgeTimer) return;
    this._chatBadgeTimer = setInterval(() => {
      const pages = getCurrentPages();
      const currentRoute = pages[pages.length - 1]?.route || '';
      this.refreshChatBadge(currentRoute);
    }, 10000);
  },

  stopChatBadgeTimer() {
    if (this._chatBadgeTimer) {
      clearInterval(this._chatBadgeTimer);
      this._chatBadgeTimer = null;
    }
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
})
