const { BASE_URL } = require('../../utils/config.js');
const { markdownToPlainText } = require('../../utils/markdown.js');

function normalizeDateString(str) {
  if (!str) return '';
  let normalized = String(str).replace(' ', 'T');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized += 'Z';
  }
  return normalized;
}

function maskOpenId(id) {
  const value = String(id || '');
  if (value.length <= 10) return value || '匿名';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

Page({
  data: {
    notes: [],
    loading: true,
    refreshing: false,
    spaceId: '',
    myUserId: '',
    ownerUserId: ''
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onLoad() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    const myUserId = wx.getStorageSync('openid') || '';
    this.setData({ spaceId, myUserId });
    if (!spaceId) {
      this.setData({ loading: false });
      return;
    }
    this.loadCachedNotes();
    this.ensureIdentity().then(() => {
      this.fetchSpaceInfo();
      this.getNotes();
    });
  },

  onShow() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    const myUserId = wx.getStorageSync('openid') || '';
    if (!spaceId) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    this.setData({ spaceId, myUserId });
    this.loadCachedNotes();
    this.ensureIdentity().then(() => {
      this.fetchSpaceInfo();
      const refreshFlagKey = `notebook_need_refresh_${spaceId}`;
      const shouldForce = !!wx.getStorageSync(refreshFlagKey);
      if (shouldForce) {
        try { wx.removeStorageSync(refreshFlagKey); } catch (e) {}
      }
      this.getNotes({ force: shouldForce });
    });
  },

  ensureIdentity() {
    const exists = this.data.myUserId || wx.getStorageSync('openid') || '';
    if (exists) {
      if (exists !== this.data.myUserId) {
        this.setData({ myUserId: exists });
      }
      return Promise.resolve(exists);
    }
    const app = typeof getApp === 'function' ? getApp() : null;
    const ensure = app && typeof app.ensureOpenId === 'function'
      ? app.ensureOpenId()
      : Promise.resolve('');
    return ensure.then((uid) => {
      const userId = uid || wx.getStorageSync('openid') || '';
      if (userId) {
        this.setData({ myUserId: userId });
      }
      return userId;
    });
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true });
    this.getNotes({ stopPullDown: true, force: true });
  },

  getCacheKey() {
    return `notebook_cache_${this.data.spaceId}`;
  },

  loadCachedNotes() {
    if (!this.data.spaceId) return false;
    let cache = null;
    try {
      cache = wx.getStorageSync(this.getCacheKey());
    } catch (e) {}
    const rawNotes = Array.isArray(cache?.notes) ? cache.notes : [];
    if (!rawNotes.length) return false;
    this._rawNotes = rawNotes;
    this.setData({
      notes: rawNotes.map((n) => this.decorateNote(n)),
      loading: false
    });
    return true;
  },

  saveCachedNotes(rawNotes) {
    if (!this.data.spaceId) return;
    try {
      wx.setStorageSync(this.getCacheKey(), {
        notes: rawNotes || [],
        cached_at: Date.now()
      });
    } catch (e) {}
  },

  fetchSpaceInfo() {
    if (!this.data.spaceId) return;
    const userId = this.data.myUserId || wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/space/info`,
      data: { space_id: this.data.spaceId, user_id: userId },
      success: (res) => {
        if (res.statusCode !== 200) return;
        const ownerUserId = res.data?.owner_user_id || '';
        this.setData({ ownerUserId });
      }
    });
  },

  buildSignature(rawNotes) {
    try {
      return JSON.stringify((rawNotes || []).map((n) => ({
        id: n.id,
        title: n.title || '',
        content: n.content || '',
        user_id: n.user_id || '',
        alias: n.alias || '',
        editable_by_others: !!n.editable_by_others,
        can_edit: !!n.can_edit,
        updated_at: n.updated_at || '',
        created_at: n.created_at || ''
      })));
    } catch (e) {
      return '';
    }
  },

  getNotes({ stopPullDown = false, force = false } = {}) {
    if (!this.data.spaceId) return;
    if (!force && this._loadingNotes) return;
    this._loadingNotes = true;
    if (!this.data.notes.length) {
      this.setData({ loading: true });
    }
    const userId = this.data.myUserId || wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/notes`,
      data: { space_id: this.data.spaceId, user_id: userId },
      success: (res) => {
        if (res.statusCode !== 200) {
          wx.showToast({ title: res.data?.detail || '加载失败', icon: 'none' });
          return;
        }
        const rawNotes = Array.isArray(res.data?.notes) ? res.data.notes : [];
        const incomingSig = this.buildSignature(rawNotes);
        const currentSig = this.buildSignature(this._rawNotes || []);
        this._rawNotes = rawNotes;
        this.saveCachedNotes(rawNotes);
        if (force || incomingSig !== currentSig) {
          this.setData({ notes: rawNotes.map((n) => this.decorateNote(n)) });
        }
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        this._loadingNotes = false;
        if (this.data.loading) {
          this.setData({ loading: false });
        }
        if (stopPullDown) {
          this.setData({ refreshing: false });
          try { wx.stopPullDownRefresh(); } catch (e) {}
        }
      }
    });
  },

  decorateNote(note) {
    const ownerName = (note.alias || '').trim() || maskOpenId(note.user_id);
    const preview = markdownToPlainText(note.content || '');
    const isOwner = note.user_id === this.data.myUserId;
    const canEdit = !!note.can_edit;
    return {
      ...note,
      ownerName,
      preview: preview ? preview.slice(0, 120) : '暂无内容',
      permissionText: note.editable_by_others ? '协作编辑' : '只读共享',
      permissionClass: note.editable_by_others ? 'editable' : 'readonly',
      canEdit,
      canDelete: isOwner,
      displayTime: this.formatFriendlyTime(note.updated_at || note.created_at)
    };
  },

  formatFriendlyTime(isoString) {
    const date = new Date(normalizeDateString(isoString));
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((startOfToday - startOfTarget) / (24 * 60 * 60 * 1000));
    const timeText = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    if (diffDays === 0) return `今天 ${timeText}`;
    if (diffDays === 1) return `昨天 ${timeText}`;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${timeText}`;
  },

  openNote(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/note-edit/note-edit?id=${id}` });
  },

  createNote() {
    wx.navigateTo({ url: '/pages/note-edit/note-edit' });
  },

  deleteNote(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.showModal({
      title: '删除笔记',
      content: '删除后不可恢复，确认删除？',
      success: (res) => {
        if (!res.confirm) return;
        const userId = this.data.myUserId || wx.getStorageSync('openid') || '';
        wx.request({
          url: `${BASE_URL}/api/notes/${id}?user_id=${encodeURIComponent(userId)}`,
          method: 'DELETE',
          success: (resp) => {
            if (resp.statusCode === 200) {
              const next = (this._rawNotes || []).filter((n) => n.id !== id);
              this._rawNotes = next;
              this.saveCachedNotes(next);
              this.setData({ notes: next.map((n) => this.decorateNote(n)) });
              wx.showToast({ title: '已删除', icon: 'none' });
            } else {
              wx.showToast({ title: resp.data?.detail || '删除失败', icon: 'none' });
            }
          },
          fail: () => wx.showToast({ title: '删除失败', icon: 'none' })
        });
      }
    });
  }
});
