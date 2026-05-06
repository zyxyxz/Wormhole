// utils/app-logger.js — operation log + page view tracking +
// review-mode flag bootstrap. Extracted from app.js by Task 20.
// All `methods` expect `this` bound to the App instance.
//
// Task 23: logOperation now batches client log events. Entries queue in
// memory and flush to /api/logs/track-batch either when the queue reaches
// FLUSH_AT_SIZE or after FLUSH_INTERVAL_MS, whichever comes first. Call
// `flushNow()` from app.onHide to push pending entries before background.
const { BASE_URL } = require('./config.js');
const { SPACE_ROUTES } = require('./routes.js');

const FLUSH_INTERVAL_MS = 5000;
const FLUSH_AT_SIZE = 20;

// Module-private queue state. Shared across all logOperation callers.
const _queue = [];
let _flushTimer = null;

function _flush() {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  if (_queue.length === 0) return;
  const batch = _queue.splice(0);
  try {
    wx.request({
      url: `${BASE_URL}/api/logs/track-batch`,
      method: 'POST',
      data: { events: batch },
      // patchNetworkSecurity already injects auth headers via wx.request override.
      // On failure we drop the batch — preserving across app restarts is out of scope.
      fail() {}
    });
  } catch (e) {}
}

function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(_flush, FLUSH_INTERVAL_MS);
}

exports.flushNow = function () {
  _flush();
};

exports.methods = {
  logOperation(payload = {}) {
    const userId = payload.user_id || wx.getStorageSync('openid') || '';
    if (!userId || !payload.action) return;
    _queue.push({
      user_id: userId,
      action: payload.action,
      page: payload.page || '',
      detail: payload.detail || '',
      space_id: payload.space_id || null,
      ts: Date.now()
    });
    if (_queue.length >= FLUSH_AT_SIZE) {
      _flush();
    } else {
      _scheduleFlush();
    }
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

  loadSystemFlags() {
    wx.request({
      url: `${BASE_URL}/api/settings/system`,
      success: (res) => {
        const review = !!res.data?.review_mode;
        this.applyReviewMode(review);
        // Task 33: cache subscribe-message template IDs so first-send
        // hooks can call wx.requestSubscribeMessage without an extra
        // round trip.
        const tmpl = (res.data && res.data.subscribe_templates) || {};
        this.globalData.subscribeTemplates = {
          chat_message: tmpl.chat_message || '',
          feed_post: tmpl.feed_post || '',
        };
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
};
