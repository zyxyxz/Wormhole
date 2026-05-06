// utils/activity.js — page wrapper hijack and recordUserActivity.
// Extracted from app.js by Task 20.
//
// installPageWrapper() must be called once at module load BEFORE App({...})
// so that all subsequent Page({...}) registrations get the wrapper.
// recordUserActivity is exposed via methods so getApp().recordUserActivity()
// keeps working from page lifecycle hooks.

exports.methods = {
  recordUserActivity() {
    this.startInactivityTimer();
  }
};

exports.installPageWrapper = function installPageWrapper() {
  if (typeof Page !== 'function') return;
  if (Page.__wormholeWrapped) return;
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
  Page.__wormholeWrapped = true;
};
