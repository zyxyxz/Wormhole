const { BASE_URL } = require('../../utils/config.js');
const { renderMarkdown } = require('../../utils/markdown.js');

Page({
  data: {
    id: 0,
    title: '',
    content: '',
    spaceId: '',
    myUserId: '',
    ownerUserId: '',
    ownerAlias: '',
    allowEdit: true,
    permissionLocked: false,
    canEdit: true,
    loading: false,
    saving: false,
    mode: 'edit',
    previewHtml: ''
  },

  onBack() {
    wx.navigateBack();
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onLoad(query) {
    const spaceId = wx.getStorageSync('currentSpaceId');
    const myUserId = wx.getStorageSync('openid') || '';
    if (!spaceId) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    const id = Number(query?.id || 0);
    this.setData({ spaceId, myUserId, id });
    this.ensureIdentity().then(() => {
      if (id) {
        this.fetchDetail(id);
      } else {
        this.updatePreview('');
      }
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

  getPageTitle() {
    return this.data.id ? '编辑笔记' : '新建笔记';
  },

  fetchDetail(id) {
    this.setData({ loading: true });
    const userId = this.data.myUserId || wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/notes/${id}`,
      method: 'GET',
      data: { user_id: userId },
      success: (res) => {
        if (res.statusCode !== 200) {
          wx.showToast({ title: res.data?.detail || '加载失败', icon: 'none' });
          return;
        }
        const note = res.data || {};
        const canEdit = !!note.can_edit;
        const ownerUserId = note.user_id || '';
        this.setData({
          id: note.id || id,
          title: note.title || '',
          content: note.content || '',
          allowEdit: !!note.editable_by_others,
          permissionLocked: !!ownerUserId && ownerUserId !== this.data.myUserId,
          canEdit,
          ownerUserId,
          ownerAlias: (note.alias || '').trim(),
          mode: canEdit ? 'edit' : 'preview'
        });
        this.updatePreview(note.content || '');
      },
      fail: () => wx.showToast({ title: '加载失败', icon: 'none' }),
      complete: () => this.setData({ loading: false })
    });
  },

  updatePreview(content) {
    this.setData({ previewHtml: renderMarkdown(content || '') });
  },

  onTitleInput(e) {
    if (!this.data.canEdit) return;
    this.setData({ title: e.detail.value || '' });
  },

  onContentInput(e) {
    if (!this.data.canEdit) return;
    const content = e.detail.value || '';
    this.setData({ content });
    if (this.data.mode === 'preview') {
      this.updatePreview(content);
    }
  },

  onPermissionChange(e) {
    if (!this.data.canEdit) return;
    if (this.data.ownerUserId && this.data.ownerUserId !== this.data.myUserId) return;
    const mode = e.detail?.value || 'editable';
    this.setData({ allowEdit: mode === 'editable' });
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.mode) return;
    if (mode === 'edit' && !this.data.canEdit) return;
    if (mode === 'preview') {
      this.updatePreview(this.data.content || '');
    }
    this.setData({ mode });
  },

  insertMarkdown(e) {
    if (!this.data.canEdit) return;
    const action = e.currentTarget.dataset.action;
    const map = {
      heading: '\n## 标题\n',
      bold: '**加粗文字**',
      list: '\n- 列表项\n',
      quote: '\n> 引用内容\n',
      code: '\n```\n代码块\n```\n',
      link: '[链接文字](https://example.com)'
    };
    const fragment = map[action] || '';
    if (!fragment) return;
    const next = `${this.data.content || ''}${fragment}`;
    this.setData({ content: next });
    if (this.data.mode === 'preview') {
      this.updatePreview(next);
    }
  },

  saveNote() {
    if (!this.data.canEdit || this.data.saving) return;
    const title = (this.data.title || '').trim();
    const content = this.data.content || '';
    if (!title) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }
    if (!content.trim()) {
      wx.showToast({ title: '请输入内容', icon: 'none' });
      return;
    }
    const userId = this.data.myUserId || wx.getStorageSync('openid') || '';
    if (!userId) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    const isUpdate = !!this.data.id;
    const url = isUpdate ? `${BASE_URL}/api/notes/${this.data.id}` : `${BASE_URL}/api/notes/create`;
    const method = isUpdate ? 'PUT' : 'POST';
    const payload = isUpdate
      ? { title, content, user_id: userId }
      : { space_id: this.data.spaceId, user_id: userId, title, content };
    if (!isUpdate || this.data.ownerUserId === userId) {
      payload.editable_by_others = !!this.data.allowEdit;
    }
    wx.request({
      url,
      method,
      data: payload,
      success: (res) => {
        if (res.statusCode !== 200) {
          wx.showToast({ title: res.data?.detail || '保存失败', icon: 'none' });
          return;
        }
        this.patchNotebookCache(res.data);
        wx.showToast({ title: isUpdate ? '已保存' : '已创建' });
        setTimeout(() => {
          const refreshFlagKey = `notebook_need_refresh_${this.data.spaceId}`;
          try { wx.setStorageSync(refreshFlagKey, Date.now()); } catch (e) {}
          wx.navigateBack();
        }, 280);
      },
      fail: () => wx.showToast({ title: '保存失败', icon: 'none' }),
      complete: () => this.setData({ saving: false })
    });
  },

  patchNotebookCache(savedNote) {
    if (!this.data.spaceId || !savedNote || !savedNote.id) return;
    const key = `notebook_cache_${this.data.spaceId}`;
    let rawNotes = [];
    try {
      const cache = wx.getStorageSync(key);
      rawNotes = Array.isArray(cache?.notes) ? cache.notes : [];
    } catch (e) {}
    const idx = rawNotes.findIndex((item) => Number(item.id) === Number(savedNote.id));
    if (idx >= 0) {
      rawNotes[idx] = savedNote;
    } else {
      rawNotes.unshift(savedNote);
    }
    try {
      wx.setStorageSync(key, {
        notes: rawNotes,
        cached_at: Date.now()
      });
    } catch (e) {}
  }
});
