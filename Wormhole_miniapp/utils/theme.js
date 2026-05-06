// utils/theme.js — theme management extracted from app.js by Task 20.
// All methods expect `this` bound to the App instance.
const { BASE_URL } = require('./config.js');
const { SPACE_ROUTES, CUSTOM_NAV_ROUTES, TAB_ROUTES } = require('./routes.js');

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
    { icon: '/assets/icons/feed.png', selected: '/assets/icons/feed-active.png' },
    { icon: '/assets/icons/notebook.png', selected: '/assets/icons/notebook-active.png' },
    { icon: '/assets/icons/settings.png', selected: '/assets/icons/settings-active.png' }
  ],
  dark: [
    { icon: '/assets/icons/chat-dark.png', selected: '/assets/icons/chat-active.png' },
    { icon: '/assets/icons/feed-dark.png', selected: '/assets/icons/feed-active.png' },
    { icon: '/assets/icons/notebook-dark.png', selected: '/assets/icons/notebook-active.png' },
    { icon: '/assets/icons/settings-dark.png', selected: '/assets/icons/settings-active.png' }
  ]
};

exports.THEME_PRESETS = THEME_PRESETS;
exports.TAB_ICON_SETS = TAB_ICON_SETS;

exports.methods = {
  getSystemThemeLegacy() {
    const readTheme = (getter) => {
      if (typeof getter !== 'function') return '';
      try {
        const info = getter();
        const theme = info && info.theme ? String(info.theme).toLowerCase() : '';
        if (theme === 'dark' || theme === 'light') return theme;
      } catch (e) {}
      return '';
    };
    const fromSetting = readTheme(wx.getSystemSetting);
    if (fromSetting) return fromSetting;
    const fromAppBase = readTheme(wx.getAppBaseInfo);
    if (fromAppBase) return fromAppBase;
    const fromWindow = readTheme(wx.getWindowInfo);
    if (fromWindow) return fromWindow;
    const fromDevice = readTheme(wx.getDeviceInfo);
    if (fromDevice) return fromDevice;
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

  getSpaceSettingsCacheKey(spaceId) {
    return spaceId ? `settings_cache_${spaceId}` : '';
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

  getCachedThemePreference(spaceId) {
    if (!spaceId) return '';
    try {
      const cache = wx.getStorageSync(this.getSpaceSettingsCacheKey(spaceId));
      return cache?.themePreference || '';
    } catch (e) {
      return '';
    }
  },

  primeRoomRuntimeConfig({ spaceId = null, themePreference = '' } = {}) {
    const sid = spaceId || wx.getStorageSync('currentSpaceId');
    if (!sid) return;
    const sourcePref = themePreference || this.getStoredThemePreference(sid) || this.getCachedThemePreference(sid) || '';
    if (!sourcePref) return;
    const normalized = this.normalizeThemePreference(sourcePref);
    this.applyThemePreference(normalized, { spaceId: sid, persist: true });
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
    const cached = this.getCachedThemePreference(spaceId);
    const bootPref = stored || cached;
    if (bootPref) {
      this.applyThemePreference(bootPref, { spaceId, persist: !stored && !!cached });
    }
    this.applyThemeToPage(page);
    this.fetchThemePreference(spaceId).then((remotePref) => {
      if (!remotePref) return;
      if (remotePref === (stored || cached)) return;
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
    const theme = this.getSystemThemeLegacy();
    this.setSystemTheme(theme);
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
  }
};
