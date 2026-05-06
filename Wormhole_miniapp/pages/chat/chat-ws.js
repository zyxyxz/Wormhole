const { BASE_URL, WS_URL } = require('../../utils/config.js');
const { getOpenIdCached, getOrCreateDeviceId } = require('../../utils/auth.js');
const outbox = require('../../utils/chat-outbox.js');

exports.methods = {
  cleanupWebSocket({ allowReconnect = false } = {}) {
    this._wsShouldReconnect = allowReconnect;
    if (this._wsReconnectTimer) {
      clearTimeout(this._wsReconnectTimer);
      this._wsReconnectTimer = null;
    }
    if (!allowReconnect) {
      this._wsRetryCount = 0;
    }
    this.stopWsHeartbeat();
    if (this.ws) {
      try {
        this._wsClosing = true;
        this.ws.close({
          fail: () => {},
          complete: () => { this._wsClosing = false; }
        });
      } catch (e) {}
      this.ws = null;
    }
    this._wsReady = false;
    this._wsConnecting = false;
  },

  initWebSocket({ force = false } = {}) {
    if (!this.data.spaceId) return;
    if (!force && (this._wsConnecting || (this.ws && this._wsReady && this._wsSpaceId === this.data.spaceId))) {
      return;
    }
    this.cleanupWebSocket({ allowReconnect: false });
    this._wsShouldReconnect = true;
    this._wsSpaceId = this.data.spaceId;
    this._wsConnecting = true;
    const userId = this._currentUserId || getOpenIdCached() || '';
    const url = userId
      ? `${WS_URL}/ws/chat/${this.data.spaceId}?user_id=${encodeURIComponent(userId)}`
      : `${WS_URL}/ws/chat/${this.data.spaceId}`;
    const ws = wx.connectSocket({ url });

    ws.onOpen(() => {
      console.log('WebSocket 已连接:', url);
      if (this._wsSpaceId !== this.data.spaceId) {
        try { ws.close({ fail: () => {} }); } catch (e) {}
        if (this.ws === ws) this.ws = null;
        return;
      }
      this._wsConnecting = false;
      this._wsReady = true;
      this._wsRetryCount = 0;
      this.setData({ wsConnected: true });
      if (userId) {
        this.updateOnlineUsers([userId], 1);
      }
      this.startWsHeartbeat();
      this.sendPresence();
      // Catch-up sync: only fire if WS was disconnected for ≥ 5s (a real
      // gap during which broadcast events were missed). Skip on the very
      // first connect (onLoad already loaded history) and on rapid bounces
      // from transient drops, which would otherwise look like polling.
      const now = Date.now();
      const lastDisconnectedAt = this._wsLastDisconnectedAt || 0;
      const disconnectedFor = lastDisconnectedAt ? now - lastDisconnectedAt : 0;
      if (disconnectedFor >= 5000) {
        this.syncLatestMessages();
      }
      this._wsLastConnectedAt = now;
      this.flushPendingSends();
    });

    ws.onMessage((res) => {
      let message = {};
      try {
        message = JSON.parse(res.data);
      } catch (e) {
        message = res.data;
      }
      if (message && message.event) {
        this.handleWsEvent(message);
        return;
      }
      try {
        const pages = getCurrentPages();
        const currentRoute = pages[pages.length - 1]?.route || '';
        const myId = this._currentUserId || getOpenIdCached();
        if (currentRoute !== 'pages/chat/chat' && message?.user_id && message.user_id !== myId) {
          const app = typeof getApp === 'function' ? getApp() : null;
          if (app && typeof app.bumpChatBadge === 'function') {
            app.bumpChatBadge(this.data.spaceId, 1);
          }
        }
      } catch (e) {}
      const resolved = this.resolvePendingMessage(message);
      if (!resolved) {
        this.mergeRawMessage(message);
        const displayed = this.decorateMessage(message, getOpenIdCached());
        this.addMessage(displayed);
      }
    });

    ws.onClose((res = {}) => {
      const code = res.code !== undefined ? res.code : '';
      const reason = res.reason || '';
      // If this onClose is firing for a socket that is no longer the active
      // one (cleanupWebSocket replaced it before the close handshake landed),
      // we MUST NOT schedule a reconnect — the new socket is already alive,
      // and queueing one here would tear it back down. This was the root of
      // the "every 900ms reconnect" loop the user was seeing: cleanup sets
      // _wsShouldReconnect=false then initWebSocket sets it true again
      // synchronously, and by the time the stale onClose fires the flag has
      // been overwritten.
      const isActiveSocket = (this.ws === ws);
      if (!isActiveSocket) {
        console.log('忽略陈旧 onClose（连接已被 cleanup 替换）');
        return;
      }
      this._wsConnecting = false;
      this._wsReady = false;
      this._wsLastDisconnectedAt = Date.now();
      this.setData({ wsConnected: false });
      this.stopWsHeartbeat();
      this.ws = null;
      if (!this._wsKeepAlive || this._wsClosing) {
        console.log('退出房间，WebSocket 已关闭');
        return;
      }
      if (this._wsShouldReconnect && this.data.spaceId === this._wsSpaceId) {
        const retry = this._wsRetryCount || 0;
        const delay = Math.min(30000, 1000 * Math.pow(2, retry));
        const detail = [code !== '' ? `code=${code}` : '', reason ? `reason=${reason}` : ''].filter(Boolean).join(' ');
        console.log(`WebSocket 断开${detail ? `（${detail}）` : ''}，${Math.round(delay / 1000)}s 后重连(retry=${retry})...`);
        this._wsReconnectTimer = setTimeout(() => {
          this._wsRetryCount = retry + 1;
          this.initWebSocket({ force: true });
        }, delay);
      }
    });

    ws.onError((res = {}) => {
      // Same stale-socket guard as onClose — only react if this is still the
      // active connection.
      if (this.ws !== ws) return;
      if (!this._wsKeepAlive || this._wsClosing) return;
      console.log('WebSocket 连接错误', res && res.errMsg ? res.errMsg : '');
      this._wsConnecting = false;
      this._wsReady = false;
      this.stopWsHeartbeat();
      this.ws = null;
    });

    this.ws = ws;
  },

  handleWsEvent(message) {
    const event = message.event;
    if (event === 'pong') {
      return;
    }
    if (event === 'server_ping') {
      // 服务端心跳探测，仅用于保持链路活跃，无需回应
      return;
    }
    if (event === 'presence') {
      const list = Array.isArray(message.online_user_ids) ? message.online_user_ids : [];
      const reportedCount = Number(message.online_count);
      this.updateOnlineUsers(
        list,
        Number.isFinite(reportedCount) && reportedCount >= 0 ? reportedCount : null
      );
      return;
    }
    if (event === 'typing') {
      this.updateTypingUsers(message.user_id, !!message.typing);
      return;
    }
    if (event === 'read_update') {
      if (message.user_id && message.last_read_message_id) {
        this.updateReadUser(message.user_id, message.last_read_message_id);
      }
      return;
    }
    if (event === 'message_deleted') {
      if (message.message_id) {
        this.removeMessageById(message.message_id);
      }
      return;
    }
    if (event === 'message_edited') {
      // Task 27: in-place rewrite the matching bubble. The server is
      // authoritative — even our own optimistic edit is reconciled here
      // so transcript stays consistent across tabs/devices.
      if (message.message_id) {
        this.applyMessageEdit(message.message_id, message.content, message.edited_at);
      }
      return;
    }
    if (event === 'reaction_add' || event === 'reaction_remove') {
      // Task 28: server-authoritative reaction toggle. applyReactionUpdate
      // patches both the on-screen messages array and the raw cache.
      if (typeof this.applyReactionUpdate === 'function') {
        this.applyReactionUpdate(message);
      }
      return;
    }
  },

  sendWsEvent(payload, fallback) {
    if (this.ws && this._wsReady) {
      this.ws.send({
        data: JSON.stringify(payload),
        fail: () => {
          if (typeof fallback === 'function') fallback();
        }
      });
    } else if (typeof fallback === 'function') {
      fallback();
    }
  },

  sendPresence() {
    const userId = this._currentUserId || getOpenIdCached();
    if (!userId) return;
    this.sendWsEvent({ event: 'presence', user_id: userId });
  },

  startWsHeartbeat() {
    this.stopWsHeartbeat();
    // Server pings every 60s and idle-kicks at 180s (Task 7). One client
    // ping per 60s is enough to keep the channel marked active without
    // looking like polling. Previously fired every 15s — too noisy.
    this._wsHeartbeatTimer = setInterval(() => {
      this.sendWsHeartbeat();
    }, 60000);
  },

  stopWsHeartbeat() {
    if (!this._wsHeartbeatTimer) return;
    clearInterval(this._wsHeartbeatTimer);
    this._wsHeartbeatTimer = null;
  },

  sendWsHeartbeat() {
    const userId = this._currentUserId || getOpenIdCached();
    if (!userId || !this._wsReady) return;
    this.sendWsEvent({ event: 'ping', user_id: userId });
  },

  sendTyping(typing) {
    const userId = this._currentUserId || getOpenIdCached();
    if (!userId) return;
    if (this._typingState === typing) return;
    this._typingState = typing;
    this.sendWsEvent({ event: 'typing', user_id: userId, typing });
  },

  sendReadState(lastReadId) {
    const userId = this._currentUserId || getOpenIdCached();
    if (!userId || !lastReadId) return;
    // Task 32: tag the read with this device's id so the server can keep a
    // per-device read pointer. Unread count = MIN across devices, so a
    // desktop read no longer prematurely clears a phone's badge.
    const deviceId = getOrCreateDeviceId();
    const payload = { event: 'read', user_id: userId, last_read_message_id: lastReadId, device_id: deviceId };
    this.sendWsEvent(payload, () => {
      wx.request({
        url: `${BASE_URL}/api/chat/read`,
        method: 'POST',
        data: { space_id: this.data.spaceId, user_id: userId, last_read_message_id: lastReadId, device_id: deviceId }
      });
    });
  },

  // Task 26: outbox-backed. queuePendingSend ensures the payload is recorded
  // in the persistent outbox so it survives page reloads. flushPendingSends
  // walks the outbox on WS open and re-attempts sends.
  queuePendingSend(wsPayload) {
    if (!wsPayload || !wsPayload.client_id) return;
    const sid = this.data.spaceId;
    if (!sid) return;
    outbox.enqueue(sid, wsPayload);
  },

  flushPendingSends() {
    const sid = this.data.spaceId;
    if (!sid || !this.ws || !this._wsReady) return;
    const pending = outbox.listPending(sid);
    if (!pending.length) return;
    pending.forEach((entry) => {
      // Failed entries require user-initiated retry.
      if (entry.status === 'failed') return;
      try {
        this.ws.send({
          data: JSON.stringify(entry.payload),
          fail: () => {
            const status = outbox.markAttempt(sid, entry.client_id);
            if (status === 'failed' && typeof this.updateMessageStatus === 'function') {
              this.updateMessageStatus(entry.client_id, 'failed');
            }
          },
        });
      } catch (e) {
        const status = outbox.markAttempt(sid, entry.client_id);
        if (status === 'failed' && typeof this.updateMessageStatus === 'function') {
          this.updateMessageStatus(entry.client_id, 'failed');
        }
      }
    });
  },
};
