// utils/badge.js — chat / notes tab badges, extracted from app.js by Task 20.
// All methods expect `this` bound to the App instance.
const { BASE_URL } = require('./config.js');

exports.methods = {
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
  }
};
