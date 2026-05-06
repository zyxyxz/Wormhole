// app.js
const auth = require('./utils/auth.js');
const theme = require('./utils/theme.js');
const badge = require('./utils/badge.js');
const lock = require('./utils/lock.js');
const activity = require('./utils/activity.js');
const appLogger = require('./utils/app-logger.js');
const spaceEvents = require('./utils/space-events.js');
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
    // Task 23: flush any queued operation logs before backgrounding so
    // entries aren't lost when the app sits idle or the user kills it.
    try { appLogger.flushNow(); } catch (e) {}
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
}, auth.methods, theme.methods, badge.methods, lock.methods, activity.methods, appLogger.methods, spaceEvents.methods));
