const { BASE_URL } = require('../../utils/config.js');
const outbox = require('../../utils/chat-outbox.js');

const CHAT_CACHE_LIMIT = 50;
const MISS_YOU_SUFFIX = '在想你';
const MUTUAL_MISSYOU_WINDOW_MS = 90000;
const HEART_BURST_COOLDOWN_MS = 6000;
const HEART_BURST_COUNT = 42;

function normalizeDateString(str) {
  if (!str) return '';
  let normalized = str.replace(' ', 'T');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized += 'Z';
  }
  return normalized;
}

function formatTime(iso, ts) {
  if (!iso && !ts) return '';
  try {
    let d = null;
    if (ts) {
      const ms = ts < 1e12 ? ts * 1000 : ts;
      d = new Date(ms);
    } else {
      d = new Date(normalizeDateString(iso));
    }
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startOfToday - startOfTarget) / (24 * 60 * 60 * 1000));
    const timeText = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    if (diffDays === 0) return timeText;
    if (diffDays === 1) return `昨天 ${timeText}`;
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${timeText}`;
  } catch (e) {
    return '';
  }
}

exports.methods = {
  fetchSpaceInfo() {
    if (!this.data.spaceId) return;
    const myId = this._currentUserId || wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/space/info`,
      data: { space_id: this.data.spaceId, user_id: myId },
      success: (res) => {
        const info = res.data || {};
        const ownerId = info.owner_user_id || '';
        this.setData({ ownerUserId: ownerId, isOwner: !!ownerId && ownerId === myId });
      }
    });
  },

  fetchMembers() {
    if (!this.data.spaceId) return;
    const myId = this._currentUserId || wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/space/members`,
      data: { space_id: this.data.spaceId, user_id: myId },
      success: (res) => {
        if (res.statusCode !== 200) return;
        const members = Array.isArray(res.data?.members) ? res.data.members : [];
        const formatted = members.map(m => ({
          user_id: m.user_id,
          alias: m.alias || '',
          avatar_url: m.avatar_url || '',
          displayName: m.alias || m.user_id || '匿名',
          initial: (m.alias || m.user_id || '匿').charAt(0)
        }));
        this._memberMap = {};
        formatted.forEach(m => { this._memberMap[m.user_id] = m; });
        this.setData({ members: formatted, memberCount: formatted.length });
        this.refreshMessageDecorations();
        this.refreshTypingDisplay();
        this.refreshOnlineDisplay();
      }
    });
  },

  fetchReadState() {
    if (!this.data.spaceId) return;
    const myId = this._currentUserId || wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/chat/readers`,
      data: { space_id: this.data.spaceId, user_id: myId },
      success: (res) => {
        if (res.statusCode !== 200) return;
        const readers = Array.isArray(res.data?.readers) ? res.data.readers : [];
        const map = {};
        readers.forEach(r => {
          if (r && r.user_id) {
            map[r.user_id] = r.last_read_message_id || 0;
          }
        });
        const selfReader = readers.find(r => r.user_id === myId);
        const serverLastRead = selfReader?.last_read_message_id || 0;
        if (serverLastRead && serverLastRead > (this.data.lastReadId || 0)) {
          this.setData({ lastReadId: serverLastRead });
          this.saveLastReadId(serverLastRead);
        }
        this.setData({ readUsersMap: map });
        this.refreshMessageDecorations();
      }
    });
  },

  updateOnlineUsers(list, reportedCount = null) {
    const normalized = Array.isArray(list)
      ? list.map(id => (id === undefined || id === null ? '' : String(id))).filter(Boolean)
      : [];
    const uniqIds = Array.from(new Set(normalized));
    const myId = this._currentUserId || wx.getStorageSync('openid') || '';
    if (myId && this._wsReady && !uniqIds.includes(myId)) {
      uniqIds.unshift(myId);
    }
    const countByList = uniqIds.length;
    const count = Number.isFinite(reportedCount) && reportedCount >= 0
      ? Math.max(reportedCount, countByList)
      : countByList;
    this.setData({ onlineUserIds: uniqIds, onlineCount: count });
    this.refreshOnlineDisplay();
  },

  refreshOnlineDisplay() {
    const ids = this.data.onlineUserIds || [];
    const members = this.data.members || [];
    const map = this._memberMap || {};
    const onlineMembers = ids.map(id => map[id]).filter(Boolean);
    const fallback = members.filter(m => ids.includes(m.user_id));
    this.setData({ onlineMembers: onlineMembers.length ? onlineMembers : fallback });
  },

  updateTypingUsers(userId, typing) {
    if (!userId) return;
    const myId = this._currentUserId || wx.getStorageSync('openid');
    const current = new Set(this.data.typingUsers || []);
    if (typing) current.add(userId);
    else current.delete(userId);
    if (myId) current.delete(myId);
    const list = Array.from(current);
    this.setData({ typingUsers: list });
    this.refreshTypingDisplay();
  },

  refreshTypingDisplay() {
    const list = this.data.typingUsers || [];
    const map = this._memberMap || {};
    const display = list.map(id => {
      const name = map[id]?.alias || id || '匿名';
      return {
      user_id: id,
      avatar_url: map[id]?.avatar_url || '',
      displayName: name,
      initial: name ? name.charAt(0) : '匿'
      };
    });
    const wasEmpty = !(this.data.typingDisplay && this.data.typingDisplay.length);
    const nowVisible = display.length > 0;
    this.setData({ typingDisplay: display }, () => {
      // The typing-row sits below the last message inside the scroll-view.
      // When it transitions from hidden -> visible, scrollTargetId is still
      // 'msg-<lastId>' which scrolls to the top of the last message and
      // leaves the typing-row clipped below the viewport. Force a scroll to
      // the bottom-anchor sentinel placed AFTER the typing-row so the user
      // sees it immediately. Skip when the user has scrolled up to read
      // history — we don't want to yank them back down.
      if (wasEmpty && nowVisible && this.data.isAtBottom) {
        // Empty-then-set forces scroll-into-view to retrigger even when
        // bottom-anchor was already the last target (would otherwise be a
        // no-op since the id didn't change).
        this.setData({ scrollTargetId: '' }, () => {
          this.setData({ scrollTargetId: 'bottom-anchor' });
        });
      }
    });
  },

  updateReadUser(userId, lastReadId) {
    if (!userId) return;
    const map = { ...(this.data.readUsersMap || {}) };
    const prev = map[userId] || 0;
    if (lastReadId > prev) {
      map[userId] = lastReadId;
      this.setData({ readUsersMap: map });
      this.refreshMessageDecorations();
    }
  },

  getReadCacheKey() {
    return `chat_last_read_${this.data.spaceId}`;
  },

  loadLastReadId() {
    const key = this.getReadCacheKey();
    try {
      return Number(wx.getStorageSync(key) || 0);
    } catch (e) {
      return 0;
    }
  },

  saveLastReadId(id) {
    const key = this.getReadCacheKey();
    try {
      wx.setStorageSync(key, id || 0);
    } catch (e) {}
  },

  computeUnreadDividerId(messages) {
    const lastRead = this.data.lastReadId || 0;
    if (!messages.length) return null;
    const firstUnread = messages.find(m => m.id > lastRead);
    return firstUnread ? firstUnread.id : null;
  },

  computeReadCount(messageId, map, myId) {
    let count = 0;
    Object.keys(map || {}).forEach(uid => {
      if (uid === myId) return;
      if ((map[uid] || 0) >= messageId) count += 1;
    });
    return count;
  },

  computeMaxReadId(map, myId) {
    let maxId = 0;
    Object.keys(map || {}).forEach(uid => {
      if (uid === myId) return;
      const val = Number(map[uid] || 0);
      if (val > maxId) maxId = val;
    });
    return maxId;
  },

  refreshMessageDecorations(messagesInput) {
    const messages = messagesInput || this.data.messages || [];
    if (!messages.length) return;
    const myId = this._currentUserId || wx.getStorageSync('openid');
    const unreadDividerId = this.computeUnreadDividerId(messages);
    const readMap = this.data.readUsersMap || {};
    const maxReadId = this.computeMaxReadId(readMap, myId);
    const updated = messages.map(m => {
      let readStatus = '';
      if (m.isSelf) {
        if (maxReadId && m.id === maxReadId) {
          readStatus = '已读';
        } else if (m.id > maxReadId) {
          readStatus = '未读';
        }
      }
      return {
        ...m,
        readStatus,
        showUnreadDivider: unreadDividerId && m.id === unreadDividerId
      };
    });
    this.setData({ messages: updated, unreadDividerId });
  },

  applyDecorations(messages) {
    if (!messages.length) return messages;
    const myId = this._currentUserId || wx.getStorageSync('openid');
    const unreadDividerId = this.computeUnreadDividerId(messages);
    const readMap = this.data.readUsersMap || {};
    const maxReadId = this.computeMaxReadId(readMap, myId);
    this._lastUnreadDividerId = unreadDividerId;
    return messages.map(m => {
      let readStatus = '';
      if (m.isSelf) {
        if (maxReadId && m.id === maxReadId) {
          readStatus = '已读';
        } else if (m.id > maxReadId) {
          readStatus = '未读';
        }
      }
      return {
        ...m,
        readStatus,
        showUnreadDivider: unreadDividerId && m.id === unreadDividerId
      };
    });
  },

  markReadLatest() {
    // Only advance the server-side read pointer when the chat page is
    // actually visible. The chat WS stays connected while the page is
    // hidden (it's a tab page), so addMessage() can fire here from a
    // background-arriving broadcast — without this guard, isAtBottom
    // (sticky from the user's last visit) would let markReadLatest run
    // and silently push SpaceMember.last_read_message_id to the latest,
    // which then makes the next refreshChatBadge return 0 and clears the
    // unread red dot the user expects to see when on another tab.
    if (!this._pageActive) return;
    const messages = this.data.messages || [];
    if (!messages.length) return;
    const latestId = messages[messages.length - 1].id;
    if (!latestId) return;
    if (latestId > (this.data.lastReadId || 0)) {
      this.setData({ lastReadId: latestId });
      this.saveLastReadId(latestId);
      this.sendReadState(latestId);
      this.refreshMessageDecorations();
      const app = typeof getApp === 'function' ? getApp() : null;
      if (app && typeof app.clearChatBadge === 'function') {
        app.clearChatBadge();
      }
    }
  },

  onScroll(e) {
    const detail = e.detail || {};
    const scrollTop = detail.scrollTop || 0;
    const scrollHeight = detail.scrollHeight || 0;
    const clientHeight = detail.clientHeight || 0;
    this._scrollTop = scrollTop;
    this._scrollHeight = scrollHeight;
    this._scrollClientHeight = clientHeight;
    const nearBottom = scrollTop + clientHeight >= scrollHeight - 30;
    if (nearBottom && !this.data.isAtBottom) {
      this.setData({ isAtBottom: true });
      this.markReadLatest();
    } else if (!nearBottom && this.data.isAtBottom) {
      this.setData({ isAtBottom: false });
    }
  },

  captureAnchorOffset(anchorId, callback) {
    if (!anchorId) {
      callback(null);
      return;
    }
    const query = wx.createSelectorQuery().in(this);
    query.select('.message-list').boundingClientRect();
    query.select(`#msg-${anchorId}`).boundingClientRect();
    query.exec((res) => {
      const listRect = res && res[0];
      const itemRect = res && res[1];
      if (!listRect || !itemRect) {
        callback(null);
        return;
      }
      callback(itemRect.top - listRect.top);
    });
  },

  onScrollToLower() {
    this.setData({ isAtBottom: true });
    this.markReadLatest();
  },

  openMembers() {
    this.setData({ showMemberModal: true });
  },

  closeMembers() {
    this.setData({ showMemberModal: false });
  },

  openOnline() {
    this.setData({ showOnlineModal: true });
  },

  closeOnline() {
    this.setData({ showOnlineModal: false });
  },

  openReadList(e) {
    const messageId = Number(e.currentTarget.dataset.id || 0);
    if (!messageId) return;
    const map = this.data.readUsersMap || {};
    const members = this.data.members || [];
    const myId = this._currentUserId || wx.getStorageSync('openid');
    const list = members.filter(m => m.user_id !== myId && (map[m.user_id] || 0) >= messageId);
    if (!list.length) {
      wx.showToast({ title: '暂无已读', icon: 'none' });
      return;
    }
    this.setData({ readModalUsers: list, showReadModal: true });
  },

  closeReadModal() {
    this.setData({ showReadModal: false });
  },

  shouldStickToBottom() {
    if (this.data.isAtBottom) return true;
    const scrollTop = this._scrollTop || 0;
    const clientHeight = this._scrollClientHeight || 0;
    const scrollHeight = this._scrollHeight || 0;
    if (!clientHeight || !scrollHeight) return false;
    return scrollTop + clientHeight >= scrollHeight - 80;
  },

  scrollToBottomIfNeeded() {
    if (!this.shouldStickToBottom()) return;
    const runner = () => this.scrollToBottom();
    if (wx.nextTick) {
      wx.nextTick(runner);
    } else {
      setTimeout(runner, 50);
    }
  },

  scrollToBottom() {
    const arr = this.data.messages || [];
    if (arr.length) {
      const id = arr[arr.length - 1].id;
      this.setData({ lastMessageId: `msg-${id}`, scrollTargetId: `msg-${id}` });
    }
  },

  getHistoryMessages(opts = {}) {
    const { reset, beforeId, prepend } = opts;
    if (this.data.historyLoading) return;
    if (!this.data.spaceId) {
      wx.showToast({ title: '空间信息缺失', icon: 'none' });
      return;
    }
    this.setData({ historyLoading: true });
    const limit = this.data.historyLimit || 50;
    const userId = this._currentUserId || wx.getStorageSync('openid') || '';
    const params = { space_id: this.data.spaceId, limit, user_id: userId };
    if (beforeId) params.before_id = beforeId;
    wx.request({
      url: `${BASE_URL}/api/chat/history`,
      data: params,
      success: (res) => {
        if (res.statusCode !== 200) {
          this.setData({ historyLoading: false });
          wx.showToast({ title: res.data?.detail || '加载失败', icon: 'none' });
          return;
        }
        const myid = wx.getStorageSync('openid');
        const rawMsgs = res.data.messages || [];
        const msgs = rawMsgs.map(m => this.decorateMessage(m, myid));
        const hasMore = res.data.has_more !== undefined ? !!res.data.has_more : (msgs.length >= limit);
        if (prepend) {
          const existing = this.data.messages || [];
          const anchorId = existing.length ? existing[0].id : null;
          this.captureAnchorOffset(anchorId, (beforeOffset) => {
            const merged = this.applyDecorations(msgs.concat(existing));
            const rawExisting = this._rawMessages || [];
            this._rawMessages = rawMsgs.concat(rawExisting);
            this.saveCachedMessages();
            this.setData({
              messages: merged,
              unreadDividerId: this._lastUnreadDividerId || null,
              historyHasMore: hasMore,
              scrollTargetId: '',
              historyLoading: false
            }, () => {
              if (beforeOffset === null || !anchorId) return;
              wx.nextTick(() => {
                this.captureAnchorOffset(anchorId, (afterOffset) => {
                  if (afterOffset === null) return;
                  const diff = afterOffset - beforeOffset;
                  const nextTop = (this._scrollTop || 0) + diff;
                  this.setData({ scrollWithAnimation: false, scrollTop: nextTop }, () => {
                    this._scrollTop = nextTop;
                    setTimeout(() => this.setData({ scrollWithAnimation: true }), 0);
                  });
                });
              });
            });
          });
        } else {
          this._rawMessages = rawMsgs;
          this.saveCachedMessages();
          const decorated = this.applyDecorations(msgs);
          const lastId = msgs.length ? msgs[msgs.length - 1].id : '';
          const isInitial = !this._initialScrollDone;
          this._initialScrollDone = true;
          const nextData = {
            messages: decorated,
            unreadDividerId: this._lastUnreadDividerId || null,
            lastMessageId: lastId ? `msg-${lastId}` : '',
            scrollTargetId: isInitial ? '' : (lastId ? `msg-${lastId}` : ''),
            historyHasMore: hasMore,
            historyLoading: false,
            isAtBottom: true
          };
          if (isInitial) {
            nextData.scrollTop = 999999;
            nextData.scrollWithAnimation = false;
          }
          this.setData(nextData, () => {
            if (isInitial) {
              const enableAnim = () => this.setData({ scrollWithAnimation: true });
              if (wx.nextTick) {
                wx.nextTick(enableAnim);
              } else {
                setTimeout(enableAnim, 0);
              }
            }
          });
          if (this.data.isAtBottom) {
            this.markReadLatest();
          }
        }
      },
      fail: () => {
        this.setData({ historyLoading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        try { wx.removeStorageSync('aliasUpdatedAt'); } catch (e) {}
      }
    });
  },

  loadOlderMessages() {
    if (this.data.historyLoading || !this.data.historyHasMore) return;
    this.setData({ isAtBottom: false });
    const first = (this.data.messages || [])[0];
    if (!first) return;
    this.getHistoryMessages({ prepend: true, beforeId: first.id });
  },

  getCacheKey() {
    return `chat_cache_${this.data.spaceId}`;
  },

  loadCachedMessages() {
    if (!this.data.spaceId) return false;
    const key = this.getCacheKey();
    let cache = null;
    try {
      cache = wx.getStorageSync(key);
    } catch (e) {}
    const rawMsgs = Array.isArray(cache?.messages) ? cache.messages : [];
    if (!rawMsgs.length) return false;
    this._rawMessages = rawMsgs;
    const myid = wx.getStorageSync('openid');
    const msgs = rawMsgs.map(m => this.decorateMessage(m, myid));
    const decorated = this.applyDecorations(msgs);
    const lastId = msgs.length ? msgs[msgs.length - 1].id : '';
    const limit = this.data.historyLimit || CHAT_CACHE_LIMIT;
    const isInitial = !this._initialScrollDone;
    this._initialScrollDone = true;
    const nextData = {
      messages: decorated,
      unreadDividerId: this._lastUnreadDividerId || null,
      lastMessageId: lastId ? `msg-${lastId}` : '',
      scrollTargetId: isInitial ? '' : (lastId ? `msg-${lastId}` : ''),
      historyHasMore: rawMsgs.length >= limit,
      isAtBottom: true
    };
    if (isInitial) {
      nextData.scrollTop = 999999;
      nextData.scrollWithAnimation = false;
    }
    this.setData(nextData, () => {
      if (isInitial) {
        const enableAnim = () => this.setData({ scrollWithAnimation: true });
        if (wx.nextTick) {
          wx.nextTick(enableAnim);
        } else {
          setTimeout(enableAnim, 0);
        }
      }
    });
    return true;
  },

  saveCachedMessages() {
    if (!this.data.spaceId) return;
    const key = this.getCacheKey();
    const limit = this.data.historyLimit || CHAT_CACHE_LIMIT;
    const raw = Array.isArray(this._rawMessages) ? this._rawMessages : [];
    if (!raw.length) {
      try { wx.removeStorageSync(key); } catch (e) {}
      return;
    }
    const trimmed = raw.slice(-limit);
    const lastId = trimmed[trimmed.length - 1]?.id || null;
    try {
      wx.setStorageSync(key, { messages: trimmed, last_id: lastId, cached_at: Date.now() });
    } catch (e) {}
  },

  mergeRawMessage(message) {
    if (!message || !message.id) return;
    const raw = Array.isArray(this._rawMessages) ? this._rawMessages : [];
    if (raw.length && raw[raw.length - 1].id === message.id) return;
    if (raw.some(m => m.id === message.id)) return;
    raw.push(message);
    this._rawMessages = raw;
    this.saveCachedMessages();
  },

  syncLatestMessages({ force = false } = {}) {
    const now = Date.now();
    const minInterval = 2500;
    if (!force && this._latestSyncAt && now - this._latestSyncAt < minInterval) {
      return;
    }
    this._latestSyncAt = now;
    this.checkLatestMessage();
  },

  checkLatestMessage() {
    if (!this.data.spaceId) return;
    const raw = Array.isArray(this._rawMessages) ? this._rawMessages : [];
    const cachedLastId = raw.length ? raw[raw.length - 1].id : null;
    if (!cachedLastId) {
      this.getHistoryMessages({ reset: true });
      return;
    }
    const userId = this._currentUserId || wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/chat/history`,
      data: { space_id: this.data.spaceId, limit: 1, user_id: userId },
      success: (res) => {
        if (res.statusCode !== 200) return;
        const latest = (res.data?.messages || [])[0];
        if (!latest) return;
        if (latest.id !== cachedLastId) {
          this.getHistoryMessages({ reset: true });
        }
      }
    });
  },

  addPendingMessage(message, status) {
    const myId = message.user_id;
    const profile = this.getMyProfile();
    const tempId = -Math.floor(Date.now() + Math.random() * 1000);
    const initialStatus = status || 'sending';
    const pendingRaw = {
      ...message,
      id: tempId,
      alias: profile.alias || message.alias || '',
      avatar_url: profile.avatar || message.avatar_url || '',
      created_at: new Date().toISOString(),
      created_at_ts: Date.now(),
      pending: true,
      sending: initialStatus === 'sending',
      status: initialStatus
    };
    const displayed = this.decorateMessage(pendingRaw, myId);
    const messages = [...(this.data.messages || []), displayed];
    const decorated = this.applyDecorations(messages);
    this.setData({
      messages: decorated,
      lastMessageId: `msg-${pendingRaw.id}`,
      scrollTargetId: `msg-${pendingRaw.id}`,
      isAtBottom: true
    });
  },

  // Task 26: update the on-screen status indicator for a pending bubble.
  // Looks up the bubble by client_id and rewrites its `status`/`sending` flags.
  updateMessageStatus(clientId, status) {
    if (!clientId || !status) return;
    const messages = this.data.messages || [];
    const idx = messages.findIndex((m) => m.client_id === clientId);
    if (idx === -1) return;
    const next = [...messages];
    next[idx] = {
      ...next[idx],
      status,
      sending: status === 'sending',
      pending: status !== 'delivered',
    };
    this.setData({ messages: this.applyDecorations(next) });
  },

  // Task 26: hydrate previously-queued outbox entries on page load so
  // unsent messages stay visible across page reloads.
  hydratePendingFromOutbox() {
    const sid = this.data.spaceId;
    if (!sid) return;
    const pending = outbox.listPending(sid);
    if (!pending.length) return;
    pending.forEach((entry) => {
      const payload = entry.payload || {};
      const message = { ...payload, space_id: sid };
      this.addPendingMessage(message, entry.status || 'sending');
    });
  },

  // Task 26: retry a failed outbox entry. Resets attempts, marks the bubble
  // back to 'sending', and triggers a flush.
  onRetryFailed(e) {
    const clientId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.clientId;
    if (!clientId) return;
    const sid = this.data.spaceId;
    if (!sid) return;
    const entry = outbox.retry(sid, clientId);
    if (!entry) return;
    this.updateMessageStatus(clientId, 'sending');
    if (typeof this.flushPendingSends === 'function') {
      this.flushPendingSends();
    }
  },

  confirmPendingSent(clientId) {
    const messages = [...(this.data.messages || [])];
    const idx = messages.findIndex(m => m.client_id === clientId);
    if (idx === -1) return;
    messages[idx] = { ...messages[idx], sending: false, pending: false };
    this.setData({ messages: this.applyDecorations(messages) });
  },

  removePendingByClientId(clientId) {
    if (!clientId) return;
    const messages = (this.data.messages || []).filter(m => m.client_id !== clientId);
    this.setData({ messages: this.applyDecorations(messages) });
  },

  resolvePendingMessage(serverMessage) {
    if (!serverMessage) return false;
    const messages = [...(this.data.messages || [])];
    let idx = -1;
    const clientId = serverMessage.client_id;
    if (clientId) {
      idx = messages.findIndex(m => m.client_id === clientId);
    }
    if (idx === -1) {
      const serverUser = serverMessage.user_id;
      const serverType = String(serverMessage.message_type || 'text').toLowerCase();
      const serverContent = (serverMessage.content || '').trim();
      const serverMedia = serverMessage.media_url || '';
      const serverLiveCover = serverMessage.live_cover_url || '';
      const serverLiveVideo = serverMessage.live_video_url || '';
      const serverTs = Number(serverMessage.created_at_ts || 0);
      idx = messages.findIndex(m => {
        if (!m.pending) return false;
        if (m.userId !== serverUser) return false;
        if ((m.messageType || 'text') !== serverType) return false;
        if (serverType === 'text') {
          return (m.content || '').trim() === serverContent;
        }
        if (serverType === 'live') {
          if (serverLiveVideo && (m.liveVideoUrl || '') === serverLiveVideo) return true;
          if (serverLiveCover && (m.liveCoverUrl || '') === serverLiveCover) return true;
          if (serverTs && m.created_at_ts) {
            return Math.abs(serverTs - m.created_at_ts) < 15000;
          }
          return false;
        }
        if (serverMedia) {
          return (m.mediaUrl || '') === serverMedia;
        }
        if (serverTs && m.created_at_ts) {
          return Math.abs(serverTs - m.created_at_ts) < 15000;
        }
        return false;
      });
    }
    if (idx === -1) return false;
    const myId = this._currentUserId || wx.getStorageSync('openid');
    const decorated = this.decorateMessage(serverMessage, myId);
    // Server echoed the message → it is now delivered.
    decorated.status = 'delivered';
    decorated.sending = false;
    decorated.pending = false;
    messages[idx] = decorated;
    this.mergeRawMessage(serverMessage);
    // Task 26: drop the matching entry from the persistent outbox.
    if (serverMessage.client_id && this.data.spaceId) {
      outbox.removeByClientId(this.data.spaceId, serverMessage.client_id);
    }
    const updated = this.applyDecorations(messages);
    const scrollTargetId = this.data.isAtBottom ? `msg-${decorated.id}` : this.data.scrollTargetId;
    this.setData({ messages: updated, scrollTargetId, lastMessageId: `msg-${decorated.id}` });
    return true;
  },

  // Task 27: apply a server-confirmed edit. Looks up the bubble by id,
  // rewrites content + edited_at, and re-runs decorations so any read/
  // unread chrome stays in sync. Also patches the raw cache so reload
  // shows the edited content immediately.
  applyMessageEdit(messageId, content, editedAt) {
    if (!messageId) return;
    const messages = this.data.messages || [];
    const idx = messages.findIndex((m) => Number(m.id) === Number(messageId));
    if (idx < 0) return;
    const next = [...messages];
    next[idx] = {
      ...next[idx],
      content: content == null ? '' : String(content),
      edited: true,
      editedAt: editedAt || next[idx].editedAt || '',
    };
    this.setData({ messages: this.applyDecorations(next) });
    const raw = Array.isArray(this._rawMessages) ? this._rawMessages : [];
    let mutated = false;
    this._rawMessages = raw.map((m) => {
      if (Number(m.id) !== Number(messageId)) return m;
      mutated = true;
      return { ...m, content, edited_at: editedAt || m.edited_at || null };
    });
    if (mutated) this.saveCachedMessages();
  },

  removeMessageById(messageId) {
    if (!messageId) return;
    const messages = (this.data.messages || []).filter(m => m.id !== messageId);
    this.setData({ messages: this.applyDecorations(messages) });
    const raw = Array.isArray(this._rawMessages) ? this._rawMessages : [];
    this._rawMessages = raw.filter(m => m.id !== messageId);
    this.saveCachedMessages();
  },

  addMessage(message) {
    const messages = [...this.data.messages, message];
    const decorated = this.applyDecorations(messages);
    const shouldScroll = this.data.isAtBottom;
    this.setData({
      messages: decorated,
      unreadDividerId: this._lastUnreadDividerId || null,
      lastMessageId: `msg-${message.id}`,
      scrollTargetId: shouldScroll ? `msg-${message.id}` : this.data.scrollTargetId
    });
    if (this.data.isAtBottom) {
      this.markReadLatest();
    }
    this.maybeTriggerMutualMissYou(message);
  },

  isMissYouSystemMessage(message) {
    if (!message || message.messageType !== 'system') return false;
    const text = String(message.content || '').trim();
    return !!text && text.endsWith(MISS_YOU_SUFFIX);
  },

  maybeTriggerMutualMissYou(message) {
    if (!this.isMissYouSystemMessage(message)) return;
    const now = Date.now();
    if (message.isSelf) {
      this._lastMissYouByMeAt = now;
      return;
    }
    const myMissYouAt = Number(this._lastMissYouByMeAt || 0);
    if (!myMissYouAt) return;
    if (now - myMissYouAt > MUTUAL_MISSYOU_WINDOW_MS) return;
    const lastBurstAt = Number(this._lastHeartBurstAt || 0);
    if (lastBurstAt && now - lastBurstAt < HEART_BURST_COOLDOWN_MS) return;
    this._lastHeartBurstAt = now;
    this._lastMissYouByMeAt = 0;
    this.launchHeartBurst();
  },

  buildHeartBurstHearts(count = HEART_BURST_COUNT) {
    const hearts = [];
    for (let i = 0; i < count; i += 1) {
      const left = (Math.random() * 100).toFixed(2);
      const delay = (Math.random() * 0.45).toFixed(2);
      const duration = (1.8 + Math.random() * 1.6).toFixed(2);
      const size = (22 + Math.random() * 26).toFixed(0);
      const opacity = (0.72 + Math.random() * 0.28).toFixed(2);
      hearts.push({
        id: `${Date.now()}_${i}_${Math.random().toString(16).slice(2, 6)}`,
        style: `left:${left}%;animation-delay:${delay}s;animation-duration:${duration}s;font-size:${size}rpx;opacity:${opacity};`
      });
    }
    return hearts;
  },

  launchHeartBurst() {
    if (this._heartBurstTimer) {
      clearTimeout(this._heartBurstTimer);
      this._heartBurstTimer = null;
    }
    this.setData({
      heartBurstVisible: true,
      heartBurstHearts: this.buildHeartBurstHearts()
    });
    this._heartBurstTimer = setTimeout(() => {
      this._heartBurstTimer = null;
      this.setData({ heartBurstVisible: false, heartBurstHearts: [] });
    }, 3600);
  },

  decorateMessage(message, myId) {
    const nickname = message.alias || message.user_id || '匿名';
    const avatar = message.avatar_url || '';
    const initialSource = nickname || message.user_id || '匿';
    const duration = message.media_duration ? Math.round(message.media_duration / 1000) : 0;
    const type = String(message.message_type || 'text').toLowerCase();
    const rawContent = message.content || '';
    let reply = null;
    if (message.reply_to_id) {
      const replyNickname = message.reply_to_alias || message.reply_to_user_id || '匿名';
      const replyType = (message.reply_to_type || 'text').toLowerCase();
      const replyContent = message.reply_to_content || (
        replyType === 'image' ? '[图片]'
          : replyType === 'video' ? '[视频]'
            : replyType === 'audio' ? '[语音]'
              : replyType === 'sticker' ? '[表情]'
                : replyType === 'live' ? '[Live]'
                  : '[消息]'
      );
      reply = {
        id: message.reply_to_id,
        userId: message.reply_to_user_id,
        nickname: replyNickname,
        avatar: message.reply_to_avatar_url || '',
        content: replyContent,
        type: replyType,
        canPreview: ['image', 'video', 'live', 'sticker'].includes(replyType)
      };
    }
    return {
      id: message.id,
      userId: message.user_id,
      content: rawContent,
      displayTime: formatTime(message.created_at, message.created_at_ts),
      isSelf: message.user_id === myId,
      avatar,
      initial: initialSource.charAt(0),
      nickname,
      messageType: type,
      mediaUrl: message.media_url || '',
      liveCoverUrl: message.live_cover_url || '',
      liveVideoUrl: message.live_video_url || '',
      mediaDuration: message.media_duration || 0,
      audioDuration: duration,
      audioPlayId: this.normalizeAudioPlayId(message.id),
      client_id: message.client_id || '',
      sending: !!message.sending || !!message.pending,
      pending: !!message.pending,
      status: message.status || (message.pending ? 'sending' : 'delivered'),
      created_at_ts: message.created_at_ts || null,
      // Task 27: surface edit state to the UI. `edited`/`editedAt` drive
      // the "(已编辑)" indicator; `createdAtTs` is dataset for the
      // long-press menu's 5-min window check.
      edited: !!message.edited_at || !!message.edited,
      editedAt: message.edited_at || message.editedAt || '',
      // Task 28: reactions array; each entry is { emoji, user_ids: [...] }.
      // hasMine is precomputed for the WXML so we can highlight pills the
      // current user already reacted with without recomputing per render.
      reactions: this.buildReactionPills(message.reactions || [], myId),
      reply,
      readStatus: '',
      showUnreadDivider: false
    };
  },

  // Task 28: shape the reactions payload from server into a UI-friendly
  // form (pre-counted, pre-flagged for "is mine") so WXML stays dumb.
  buildReactionPills(rawReactions, myId) {
    if (!Array.isArray(rawReactions)) return [];
    return rawReactions.map((g) => {
      const userIds = Array.isArray(g.user_ids) ? g.user_ids.slice() : [];
      return {
        emoji: g.emoji,
        user_ids: userIds,
        count: userIds.length,
        hasMine: !!myId && userIds.indexOf(myId) >= 0,
      };
    }).filter((g) => g.count > 0);
  },

  // Task 28: in-place reconciliation when a `reaction_add` / `reaction_remove`
  // frame arrives over WS. Mirrors the optimistic-then-server-authoritative
  // pattern used by edit/delete handlers.
  applyReactionUpdate(payload) {
    if (!payload) return;
    const messageId = Number(payload.message_id);
    const userId = payload.user_id;
    const emoji = payload.emoji;
    const event = payload.event;
    if (!messageId || !userId || !emoji) return;
    const messages = this.data.messages || [];
    const idx = messages.findIndex((m) => Number(m.id) === messageId);
    if (idx < 0) return;
    const myId = this._currentUserId || wx.getStorageSync('openid');
    const current = messages[idx].reactions || [];
    const next = current.map((g) => ({
      emoji: g.emoji,
      user_ids: (g.user_ids || []).slice(),
      count: g.count || 0,
      hasMine: !!g.hasMine,
    }));
    let group = next.find((g) => g.emoji === emoji);
    if (event === 'reaction_add') {
      if (!group) {
        group = { emoji, user_ids: [userId], count: 1, hasMine: userId === myId };
        next.push(group);
      } else if (group.user_ids.indexOf(userId) < 0) {
        group.user_ids.push(userId);
        group.count = group.user_ids.length;
        if (userId === myId) group.hasMine = true;
      }
    } else if (event === 'reaction_remove') {
      if (group) {
        group.user_ids = group.user_ids.filter((u) => u !== userId);
        group.count = group.user_ids.length;
        if (userId === myId) group.hasMine = false;
      }
    }
    const filtered = next.filter((g) => g.count > 0);
    const updatedMessages = [...messages];
    updatedMessages[idx] = { ...messages[idx], reactions: filtered };
    this.setData({ messages: updatedMessages });
    // Patch the raw cache so a reload picks up the latest state.
    const raw = Array.isArray(this._rawMessages) ? this._rawMessages : [];
    let mutated = false;
    this._rawMessages = raw.map((m) => {
      if (Number(m.id) !== messageId) return m;
      mutated = true;
      const rawReactions = Array.isArray(m.reactions) ? m.reactions.map((g) => ({
        emoji: g.emoji,
        user_ids: Array.isArray(g.user_ids) ? g.user_ids.slice() : [],
      })) : [];
      let rawGroup = rawReactions.find((g) => g.emoji === emoji);
      if (event === 'reaction_add') {
        if (!rawGroup) rawReactions.push({ emoji, user_ids: [userId] });
        else if (rawGroup.user_ids.indexOf(userId) < 0) rawGroup.user_ids.push(userId);
      } else if (event === 'reaction_remove' && rawGroup) {
        rawGroup.user_ids = rawGroup.user_ids.filter((u) => u !== userId);
      }
      return { ...m, reactions: rawReactions.filter((g) => g.user_ids.length > 0) };
    });
    if (mutated) this.saveCachedMessages();
  },

  // Task 28: tapping an existing pill toggles the current user's reaction.
  // The decision happens client-side (so we know whether to send add/remove);
  // the server is still authoritative — its broadcast frame reconciles.
  onToggleReaction(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const messageId = Number(dataset.messageId || 0);
    const emoji = dataset.emoji || '';
    if (!messageId || !emoji) return;
    const myId = this._currentUserId || wx.getStorageSync('openid');
    if (!myId) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    const messages = this.data.messages || [];
    const msg = messages.find((m) => Number(m.id) === messageId);
    if (!msg) return;
    const group = (msg.reactions || []).find((g) => g.emoji === emoji);
    const alreadyReacted = !!(group && group.hasMine);
    if (typeof this.sendWsEvent !== 'function') return;
    this.sendWsEvent({
      event: alreadyReacted ? 'reaction_remove' : 'reaction_add',
      user_id: myId,
      message_id: messageId,
      emoji,
    });
  },
};
