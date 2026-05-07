// utils/badge.js — chat / notes tab badges, extracted from app.js by Task 20.
// All methods expect `this` bound to the App instance.
//
// 2026-05-07 unread redesign: notes badge now mirrors chat — counted on
// the server via SpaceMember.last_read_post_id, pushed live via WS
// `feed_unread_inc`, persisted locally so a cold start can restore the
// number before the HTTP refresh comes back.
const { BASE_URL } = require('./config.js');

exports.methods = {
  getNotesBadgeKey(spaceId) {
    return spaceId ? `notes_badge_${spaceId}` : 'notes_badge';
  },

  clearNotesBadge(spaceId) {
    try {
      wx.removeTabBarBadge({ index: 1 });
    } catch (e) {}
    const sid = spaceId || wx.getStorageSync('currentSpaceId');
    if (sid) {
      try { wx.removeStorageSync(this.getNotesBadgeKey(sid)); } catch (e) {}
    }
  },

  setNotesBadgeCount(spaceId, count) {
    const sid = spaceId || wx.getStorageSync('currentSpaceId');
    if (!sid) return;
    const safe = Math.max(0, Number(count) || 0);
    try { wx.setStorageSync(this.getNotesBadgeKey(sid), safe); } catch (e) {}
    if (safe > 0) {
      const text = safe > 99 ? '99+' : String(safe);
      try { wx.setTabBarBadge({ index: 1, text }); } catch (e) {}
    } else {
      this.clearNotesBadge(sid);
    }
  },

  bumpNotesBadge(spaceId, delta = 1) {
    const sid = spaceId || wx.getStorageSync('currentSpaceId');
    if (!sid) return;
    let current = 0;
    try { current = Number(wx.getStorageSync(this.getNotesBadgeKey(sid)) || 0); } catch (e) {}
    this.setNotesBadgeCount(sid, current + (Number(delta) || 0));
  },

  markNotesRead(spaceId, latestPostId) {
    const sid = spaceId || wx.getStorageSync('currentSpaceId');
    if (!sid) return;
    this.clearNotesBadge(sid);
    const uid = wx.getStorageSync('openid') || '';
    if (!uid || !latestPostId) return;
    wx.request({
      url: `${BASE_URL}/api/feed/mark-read`,
      method: 'POST',
      data: {
        space_id: sid,
        user_id: uid,
        last_read_post_id: Number(latestPostId) || 0,
      },
      // fail silently — if the request drops, the next /unread-count call
      // will reset the badge. The local clearNotesBadge above already gave
      // the user immediate feedback.
      fail: () => {},
    });
  },

  // Cold-start one-shot HTTP fallback. Live updates come via the
  // spaceEventSocket `feed_unread_inc` event.
  refreshNotesBadge(currentRoute = '') {
    if (this.globalData.reviewMode) return;
    const sid = wx.getStorageSync('currentSpaceId');
    if (!sid) {
      this.clearNotesBadge();
      return;
    }
    if (currentRoute === 'pages/notes/notes') {
      this.clearNotesBadge(sid);
      return;
    }
    if (this._notesBadgeLoading) return;
    const uid = wx.getStorageSync('openid') || '';
    if (!uid) return;
    this._notesBadgeLoading = true;
    wx.request({
      url: `${BASE_URL}/api/feed/unread-count`,
      data: { space_id: sid, user_id: uid },
      success: (res) => {
        const count = Math.max(0, res.data?.count || 0);
        this.setNotesBadgeCount(sid, count);
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
