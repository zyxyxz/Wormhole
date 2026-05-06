// utils/auth.js — extracted from app.js by Task 20.
// Each function below expects to be invoked with `this` bound to the
// App instance (achieved via Object.assign into the App({...}) config).
//
// Task 22: module-private memory cache for openid/accessToken so hot paths
// (every wx.request via patchNetworkSecurity, every chat send) don't pay
// the synchronous IO cost of wx.getStorageSync on every call.
const { BASE_URL } = require('./config.js');

let _openid = '';
let _accessToken = '';

function _readOpenIdFromStorage() {
  try {
    return wx.getStorageSync('openid') || '';
  } catch (e) {
    return '';
  }
}

function _readAccessTokenFromStorage() {
  try {
    return wx.getStorageSync('accessToken') || '';
  } catch (e) {
    return '';
  }
}

function getOpenIdCached() {
  if (_openid) return _openid;
  _openid = _readOpenIdFromStorage();
  return _openid;
}

function getAccessTokenCached() {
  if (_accessToken) return _accessToken;
  _accessToken = _readAccessTokenFromStorage();
  return _accessToken;
}

function setAuthCache(openid, accessToken) {
  if (openid !== undefined) {
    _openid = openid || '';
    try { wx.setStorageSync('openid', _openid); } catch (e) {}
  }
  if (accessToken !== undefined) {
    _accessToken = accessToken || '';
    try { wx.setStorageSync('accessToken', _accessToken); } catch (e) {}
  }
}

function clearAuthCache() {
  _openid = '';
  _accessToken = '';
  try { wx.removeStorageSync('openid'); } catch (e) {}
  try { wx.removeStorageSync('accessToken'); } catch (e) {}
}

exports.methods = {
  // DEPRECATED: will be removed when Task 22 lands in-memory openid cache
  parseUserIdFromUrl(url = '') {
    const text = String(url || '');
    if (!text) return '';
    const match = text.match(/[?&](user_id|operator_user_id)=([^&]+)/);
    if (!match || !match[2]) return '';
    try {
      return decodeURIComponent(match[2]);
    } catch (e) {
      return match[2];
    }
  },

  // DEPRECATED: will be removed when Task 22 lands in-memory openid cache
  pickUserIdFromPayload(payload) {
    if (!payload) return '';
    if (typeof payload === 'string') {
      try {
        return this.pickUserIdFromPayload(JSON.parse(payload));
      } catch (e) {
        return '';
      }
    }
    if (typeof payload !== 'object') return '';
    return (
      payload.user_id
      || payload.userId
      || payload.operator_user_id
      || payload.operatorUserId
      || ''
    );
  },

  getCachedAccessToken() {
    return getAccessTokenCached();
  },

  appendAuthTokenToUrl(url = '', token = '') {
    const source = String(url || '');
    if (!source || !token) return source;
    if (/[?&](token|access_token)=/.test(source)) return source;
    const hashIndex = source.indexOf('#');
    const base = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
    const hash = hashIndex >= 0 ? source.slice(hashIndex) : '';
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}access_token=${encodeURIComponent(token)}${hash}`;
  },

  // WS-only: WeChat MiniProgram WebSocket cannot reliably attach custom headers
  // (CDN strips them). HTTP requests must NOT use this — auth goes via headers.
  appendUserIdToUrl(url = '', userId = '') {
    const source = String(url || '');
    const uid = String(userId || '').trim();
    if (!source || !uid) return source;
    if (/[?&](user_id|operator_user_id|auth_user)=/.test(source)) return source;
    const hashIndex = source.indexOf('#');
    const base = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
    const hash = hashIndex >= 0 ? source.slice(hashIndex) : '';
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}user_id=${encodeURIComponent(uid)}${hash}`;
  },

  getRequestUserId(requestOptions = null) {
    const openid = getOpenIdCached();
    if (openid) return openid;
    if (!requestOptions) return '';
    return this.pickUserIdFromPayload(requestOptions.data)
      || this.pickUserIdFromPayload(requestOptions.formData)
      || '';
  },

  getAuthHeaders(extra = {}, requestOptions = null) {
    const headers = Object.assign({}, extra || {});
    let openid = getOpenIdCached();
    const accessToken = getAccessTokenCached();
    if (!openid && requestOptions) {
      openid = this.pickUserIdFromPayload(requestOptions.data)
        || this.pickUserIdFromPayload(requestOptions.formData)
        || '';
    }
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
      headers['X-Auth-Token'] = accessToken;
    }
    if (openid) {
      headers['X-User-Id'] = openid;
      headers['X-Openid'] = openid;
    }
    return headers;
  },

  patchNetworkSecurity() {
    if (this._networkPatched) return;
    this._networkPatched = true;
    const app = this;

    // HTTP: identity flows through Authorization / X-Auth-Token / X-User-Id /
    // X-Openid headers only. We deliberately do NOT inject user_id into the
    // URL — query params leak into proxy/CDN/server logs and are easy to forge,
    // and the backend has stopped honouring them on HTTP routes.
    const originalRequest = wx.request;
    wx.request = function (options = {}) {
      const nextOptions = Object.assign({}, options, {
        header: app.getAuthHeaders(options.header || {}, options)
      });
      return originalRequest.call(wx, nextOptions);
    };

    const originalUploadFile = wx.uploadFile;
    wx.uploadFile = function (options = {}) {
      const nextOptions = Object.assign({}, options, {
        header: app.getAuthHeaders(options.header || {}, options)
      });
      return originalUploadFile.call(wx, nextOptions);
    };

    // WebSocket: WeChat MiniProgram's wx.connectSocket cannot reliably attach
    // custom headers (some platforms / CDNs strip them), so we keep the
    // user_id query fallback for the WS handshake. The backend's WS auth
    // path (`get_ws_user_id`) still accepts it.
    const originalConnectSocket = wx.connectSocket;
    wx.connectSocket = function (options = {}) {
      let nextUrl = options.url || '';
      const userId = app.getRequestUserId({ ...options, url: nextUrl });
      nextUrl = app.appendUserIdToUrl(nextUrl, userId);
      const nextOptions = Object.assign({}, options, {
        url: nextUrl,
        header: app.getAuthHeaders(options.header || {}, { ...options, url: nextUrl })
      });
      return originalConnectSocket.call(wx, nextOptions);
    };
  },

  ensureOpenId(forceRefresh = false) {
    const existing = getOpenIdCached();
    const existingToken = getAccessTokenCached();
    if (existing && existingToken && !forceRefresh) {
      return Promise.resolve(existing);
    }
    if (this._openidPromise && !forceRefresh) {
      return this._openidPromise;
    }
    this._openidPromise = new Promise((resolve) => {
      wx.login({
        success: (res) => {
          const code = res && res.code;
          if (!code) {
            resolve('');
            return;
          }
          wx.request({
            url: `${BASE_URL}/api/auth/login`,
            method: 'POST',
            data: { code },
            success: (resp) => {
              const openid = resp.data?.openid || resp.data?.data?.openid || '';
              const accessToken = resp.data?.access_token || resp.data?.data?.access_token || '';
              setAuthCache(
                openid ? openid : undefined,
                accessToken ? accessToken : undefined
              );
              resolve(openid || '');
            },
            fail: () => resolve('')
          });
        },
        fail: () => resolve('')
      });
    }).finally(() => {
      this._openidPromise = null;
    });
    return this._openidPromise;
  }
};

exports.getOpenIdCached = getOpenIdCached;
exports.getAccessTokenCached = getAccessTokenCached;
exports.setAuthCache = setAuthCache;
exports.clearAuthCache = clearAuthCache;
