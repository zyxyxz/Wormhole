// utils/space-events.js — global event_manager listener.
// Connects to /ws/space/{space_id} so unread_inc events bump the chat
// tab badge live, retiring the prior 10 s polling. The chat page has
// its own /ws/chat/{space_id} socket (chat_manager) — when the route
// is pages/chat/chat, bumpChatBadge / refreshChatBadge already
// short-circuit and clear the badge instead, so the extra connection
// is functionally idempotent.
//
// Extracted from app.js by Task 20. All methods expect `this` bound
// to the App instance.
const { WS_URL } = require('./config.js');

exports.methods = {
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
  }
};
