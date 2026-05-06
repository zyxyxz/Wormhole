const { BASE_URL } = require('../../utils/config.js');

// Debounce keystrokes so we don't fire a search on every input event;
// 300ms is a comfortable balance between responsiveness and request volume
// against the FTS endpoint.
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function formatTimeLabel(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const pad = (n) => String(n).padStart(2, '0');
    if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch (e) {
    return '';
  }
}

function aliasInitial(item) {
  const source = (item.alias || item.user_id || '').trim();
  if (!source) return '?';
  // Take the first non-whitespace code point so CJK characters render correctly.
  const codePoint = source.codePointAt(0);
  if (codePoint === undefined) return '?';
  return String.fromCodePoint(codePoint).toUpperCase();
}

Page({
  data: {
    query: '',
    submittedQuery: '',
    results: [],
    loading: false,
    themeClass: ''
  },

  onLoad() {
    this._debouncedSearch = debounce((q) => this._search(q), 300);
    const app = getApp();
    if (app && app.applyThemeToPage) {
      try { app.applyThemeToPage(this); } catch (e) {}
    }
  },

  onShow() {
    const app = getApp();
    if (app && app.applyThemeToPage) {
      try { app.applyThemeToPage(this); } catch (e) {}
    }
  },

  onInput(e) {
    const value = (e && e.detail && e.detail.value) || '';
    this.setData({ query: value });
    const trimmed = value.trim();
    if (trimmed.length >= 1) {
      this.setData({ loading: true });
      this._debouncedSearch(trimmed);
    } else {
      this.setData({ results: [], submittedQuery: '', loading: false });
    }
  },

  onSearch() {
    const q = (this.data.query || '').trim();
    if (q) {
      this.setData({ loading: true });
      this._search(q);
    }
  },

  onClear() {
    this.setData({ query: '', results: [], submittedQuery: '', loading: false });
  },

  onBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/chat/chat' });
      }
    });
  },

  _search(q) {
    const sid = wx.getStorageSync('currentSpaceId');
    if (!sid) {
      this.setData({ results: [], loading: false });
      return;
    }
    const url = `${BASE_URL}/api/search/messages?space_id=${encodeURIComponent(sid)}&q=${encodeURIComponent(q)}`;
    wx.request({
      url,
      method: 'GET',
      success: (res) => {
        // Ignore late responses if the user kept typing — the most recent
        // submitted query is the only one that should win.
        if ((this.data.query || '').trim() !== q && this.data.query !== '') {
          // Stale response; drop unless the input cleared (then keep loading=false).
        }
        const list = (res && res.data && res.data.messages) || [];
        const decorated = list.map((r) => ({
          ...r,
          timeLabel: formatTimeLabel(r.created_at),
          aliasInitial: aliasInitial(r)
        }));
        this.setData({
          results: decorated,
          submittedQuery: q,
          loading: false
        });
      },
      fail: () => {
        this.setData({ loading: false });
      }
    });
  },

  onTapResult(e) {
    const messageId = e.currentTarget.dataset.messageId;
    if (!messageId) return;
    // Deep-linking to a specific message position is out of scope for v1.
    // Navigate back to the chat tab so the user lands in the active room.
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/chat/chat' });
      }
    });
  }
});
