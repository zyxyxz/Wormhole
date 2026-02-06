const { BASE_URL } = require('../../utils/config.js');
const { ensureDiaryMode } = require('../../utils/review.js');

function setTemporaryForeground(active) {
  const app = typeof getApp === 'function' ? getApp() : null;
  if (!app) return;
  const method = active ? 'markTemporaryForegroundAllowed' : 'clearTemporaryForegroundFlag';
  if (typeof app[method] === 'function') {
    app[method]();
  } else if (app.globalData) {
    app.globalData.skipNextHideRedirect = !!active;
  }
}

Page({
  data: {
    spaceCode: '',
    newSpaceCode: '',
    shareCode: '',
    showModifyModal: false,
    showShareModal: false,
    showAliasModal: false,
    alias: '',
    aliasInitial: '我',
    avatarUrl: '',
    newAlias: '',
    spaceId: '',
    isOwner: false,
    members: [],
    memberPreview: [],
    showMembersModal: false,
    shareInfoText: '',
    blocks: [],
    showAutoLockModal: false,
    autoLockOptions: ['不锁定', '1分钟', '3分钟', '5分钟'],
    autoLockIndex: 0,
    autoLockDisplay: '不锁定',
    autoLockOnHide: true,
    showDeleteModal: false,
    deleteConfirmInput: '',
    deleteConfirmPhrase: '',
    themeOptions: ['跟随微信', '深色模式', '浅色模式'],
    themeValues: ['system', 'dark', 'light'],
    themeIndex: 0,
    themePreference: 'system'
  },
  onBack() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onLoad() {
    if (ensureDiaryMode('pages/settings/settings')) return;
    const spaceId = wx.getStorageSync('currentSpaceId');
    const spaceCode = wx.getStorageSync('currentSpaceCode');
    const myUserId = wx.getStorageSync('openid') || '';
    const cachedAlias = wx.getStorageSync(`myAlias_${spaceId}`) || '';
    this.setData({ 
      spaceId,
      spaceCode,
      myUserId,
      alias: cachedAlias || this.data.alias,
      aliasInitial: (cachedAlias || myUserId || '我').charAt(0)
    });
    this.loadCachedSettings();
    this.syncThemePreference();
    this.fetchAlias();
    this.fetchSpaceInfo();
    const autoLockSeconds = wx.getStorageSync('autoLockSeconds');
    this.updateAutoLockDisplay(autoLockSeconds);
    const autoLockOnHide = wx.getStorageSync('autoLockOnHide');
    this.setData({ autoLockOnHide: autoLockOnHide === '' || autoLockOnHide === undefined || autoLockOnHide === null ? true : !!autoLockOnHide });
  },

  getThemeIndex(pref) {
    const values = this.data.themeValues || [];
    const idx = values.indexOf(pref);
    return idx >= 0 ? idx : 0;
  },

  syncThemePreference() {
    const app = getApp && getApp();
    const spaceId = this.data.spaceId;
    let pref = this.data.themePreference || '';
    if (app && typeof app.getStoredThemePreference === 'function') {
      pref = app.getStoredThemePreference(spaceId) || pref;
    }
    if (!pref && app && app.globalData) {
      pref = app.globalData.themePreference || '';
    }
    if (!pref) pref = 'system';
    this.applyThemePreference(pref, { syncRemote: false });
  },

  applyThemePreference(pref, { syncRemote = false } = {}) {
    const app = getApp && getApp();
    const normalized = app && typeof app.normalizeThemePreference === 'function'
      ? app.normalizeThemePreference(pref)
      : (pref || 'system');
    const themeIndex = this.getThemeIndex(normalized);
    if (normalized === this.data.themePreference && themeIndex === this.data.themeIndex) {
      if (app && app.globalData && app.globalData.themePreference === normalized) {
        return;
      }
    }
    this.setData({
      themePreference: normalized,
      themeIndex
    });
    if (app && typeof app.applyThemePreference === 'function') {
      app.applyThemePreference(normalized, { spaceId: this.data.spaceId, persist: true });
      if (typeof app.refreshThemeOnActivePages === 'function') {
        app.refreshThemeOnActivePages();
      }
    }
    this.persistSettingsCache({ themePreference: normalized });
    if (syncRemote) {
      this.saveAlias({
        alias: this.data.alias,
        avatarUrl: this.data.avatarUrl,
        themePreference: normalized
      });
    }
  },

  fetchSpaceInfo() {
    wx.request({
      url: `${BASE_URL}/api/space/info`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        const info = res.data;
        const isOwner = wx.getStorageSync('openid') === info.owner_user_id;
        const nextOwner = info.owner_user_id || '';
        if (nextOwner !== this.data.ownerUserId || isOwner !== this.data.isOwner) {
          this.setData({ isOwner, ownerUserId: nextOwner });
          this.persistSettingsCache();
        }
        this.fetchMembers();
      }
    });
  },

  getCacheKey() {
    return `settings_cache_${this.data.spaceId}`;
  },

  buildAliasSignature(alias, avatarUrl) {
    return `${alias || ''}|${avatarUrl || ''}`;
  },

  buildMembersSignature(membersRaw) {
    try {
      return JSON.stringify((membersRaw || []).map(item => ({
        user_id: item.user_id || '',
        alias: item.alias || '',
        avatar_url: item.avatar_url || ''
      })));
    } catch (e) {
      return '';
    }
  },

  buildBlocksSignature(blocks) {
    try {
      return JSON.stringify((blocks || []).map(item => item.user_id || ''));
    } catch (e) {
      return '';
    }
  },

  loadCachedSettings() {
    if (!this.data.spaceId) return false;
    let cache = null;
    try {
      cache = wx.getStorageSync(this.getCacheKey());
    } catch (e) {}
    if (!cache) return false;
    const members = Array.isArray(cache.members) ? cache.members : [];
    const blocks = Array.isArray(cache.blocks) ? cache.blocks : [];
    const alias = cache.alias || '';
    const avatarUrl = cache.avatarUrl || '';
    const ownerUserId = cache.ownerUserId || '';
    const isOwner = !!cache.isOwner;
    const aliasInitial = (alias || this.data.myUserId || '我').charAt(0);
    this._aliasSig = this.buildAliasSignature(alias, avatarUrl);
    this._membersSig = cache.membersSig || '';
    this._blocksSig = cache.blocksSig || '';
    const cachedThemePreference = cache.themePreference || '';
    this.setData({
      alias,
      avatarUrl,
      aliasInitial,
      themePreference: cachedThemePreference || this.data.themePreference,
      themeIndex: this.getThemeIndex(cachedThemePreference || this.data.themePreference),
      members,
      memberPreview: members.slice(0, 4),
      blocks,
      ownerUserId,
      isOwner: isOwner || (this.data.myUserId && ownerUserId === this.data.myUserId)
    });
    return true;
  },

  persistSettingsCache(extra = {}) {
    if (!this.data.spaceId) return;
    const payload = {
      alias: this.data.alias || '',
      avatarUrl: this.data.avatarUrl || '',
      ownerUserId: this.data.ownerUserId || '',
      isOwner: !!this.data.isOwner,
      members: this.data.members || [],
      blocks: this.data.blocks || [],
      membersSig: this._membersSig || '',
      blocksSig: this._blocksSig || '',
      themePreference: this.data.themePreference || 'system',
      cached_at: Date.now(),
      ...extra
    };
    try {
      wx.setStorageSync(this.getCacheKey(), payload);
    } catch (e) {}
  },

  fetchMembers() {
    wx.request({
      url: `${BASE_URL}/api/space/members`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        const membersRaw = res.data.members || [];
        const nextSig = this.buildMembersSignature(membersRaw);
        const members = membersRaw.map(item => ({
          ...item,
          displayName: item.alias || item.user_id,
          initial: (item.alias || item.user_id || '?').charAt(0)
        }));
        const preview = members.slice(0, 4);
        if (nextSig !== this._membersSig) {
          this._membersSig = nextSig;
          this.setData({
            members,
            memberPreview: preview
          });
          this.persistSettingsCache({ membersSig: nextSig });
        }
        if (this.data.isOwner) {
          this.fetchBlocks();
        }
      }
    });
  },
  fetchBlocks() {
    wx.request({
      url: `${BASE_URL}/api/space/blocks`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        const blocks = res.data.blocks || [];
        const nextSig = this.buildBlocksSignature(blocks);
        if (nextSig !== this._blocksSig) {
          this._blocksSig = nextSig;
          this.setData({ blocks });
          this.persistSettingsCache({ blocksSig: nextSig });
        }
      }
    });
  },

  fetchAlias() {
    const openid = wx.getStorageSync('openid');
    if (!openid) return;
    wx.request({
      url: `${BASE_URL}/api/user/alias`,
      data: { space_id: this.data.spaceId, user_id: openid },
      success: (res) => {
        if (res.data && res.data.alias !== undefined) {
          const alias = res.data.alias;
          const avatarUrl = res.data.avatar_url || '';
          const themePreference = res.data.theme_preference || '';
          const nextSig = this.buildAliasSignature(alias, avatarUrl);
          if (nextSig === this._aliasSig) {
            if (themePreference) {
              this.applyThemePreference(themePreference, { syncRemote: false });
            }
            return;
          }
          this._aliasSig = nextSig;
          this.setData({
            alias,
            avatarUrl,
            aliasInitial: (alias || openid || '我').charAt(0)
          });
          this.persistSettingsCache();
          if (themePreference) {
            this.applyThemePreference(themePreference, { syncRemote: false });
          }
          try {
            wx.setStorageSync(`myAlias_${this.data.spaceId}`, alias);
            wx.setStorageSync(`myAvatar_${this.data.spaceId}`, avatarUrl);
            wx.setStorageSync('aliasUpdatedAt', Date.now());
          } catch (e) {}
        }
      }
    });
  },

  modifySpaceCode() {
    this.setData({ showModifyModal: true });
  },

  onSpaceCodeInput(e) {
    this.setData({ newSpaceCode: e.detail.value });
  },

  confirmModify() {
    if (this.data.newSpaceCode.length !== 6) {
      wx.showToast({
        title: '请输入6位数字',
        icon: 'none'
      });
      return;
    }

    wx.request({
      url: `${BASE_URL}/api/space/modify-code`,
      method: 'POST',
      data: {
        space_id: this.data.spaceId,
        new_code: this.data.newSpaceCode
      },
      success: (res) => {
        if (res.data.success) {
          wx.setStorageSync('currentSpaceCode', this.data.newSpaceCode);
          this.setData({
            spaceCode: this.data.newSpaceCode,
            showModifyModal: false
          });
          wx.showToast({ title: '修改成功' });
        }
      }
    });
  },

  cancelModify() {
    this.setData({ showModifyModal: false });
  },

  shareSpace() {
    if (!this.data.isOwner) {
      wx.showToast({ title: '仅房主可分享', icon: 'none' });
      return;
    }
    const operatorUserId = wx.getStorageSync('openid');
    if (!operatorUserId) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/space/share`,
      method: 'POST',
      data: { space_id: this.data.spaceId, operator_user_id: operatorUserId },
      success: (res) => {
        const expires = res.data.expires_in || res.data.expiresIn;
        const hint = expires ? `口令将在 ${Math.ceil(expires / 60)} 分钟后失效，仅可使用一次` : '口令仅可使用一次';
        this.setData({
          shareCode: res.data.share_code || res.data.shareCode || res.data.share_code,
          shareInfoText: hint,
          showShareModal: true
        });
      }
    });
  },

  updateAutoLockDisplay(seconds) {
    let label = '未设置';
    const options = this.data.autoLockOptions;
    let index = -1;
    const map = [0, 60, 180, 300];
    if (seconds !== undefined && seconds !== null) {
      const idx = map.indexOf(Number(seconds) || 0);
      if (idx >= 0) {
        index = idx;
        label = options[idx];
      } else if (seconds === 0) {
        label = options[0];
      } else {
        label = `${Math.round(seconds / 60)}分钟`;
      }
    }
    this.setData({ autoLockDisplay: label, autoLockIndex: index >= 0 ? index : 0 });
  },

  openAutoLockModal() {
    this.setData({ showAutoLockModal: true });
  },

  closeAutoLockModal() {
    this.setData({ showAutoLockModal: false });
  },

  onAutoLockChange(e) {
    const idx = Number(e.detail.value || 0);
    this.setData({ autoLockIndex: idx }, () => {
      this.applyAutoLockSelection();
    });
  },

  onThemeChange(e) {
    const idx = Number(e.detail.value || 0);
    const pref = (this.data.themeValues && this.data.themeValues[idx]) || 'system';
    this.applyThemePreference(pref, { syncRemote: true });
  },

  applyAutoLockSelection() {
    const map = [0, 60, 180, 300];
    const seconds = map[this.data.autoLockIndex] || 0;
    wx.setStorageSync('autoLockSeconds', seconds);
    this.updateAutoLockDisplay(seconds);
    wx.showToast({ title: '已保存', icon: 'none' });
  },

  toggleAutoLockOnHide(e) {
    const next = !!e.detail.value;
    if (!next) {
      wx.showModal({
        title: '确认关闭',
        content: '这样会导致不安全，是否确认要关闭？',
        success: (res) => {
          if (res.confirm) {
            wx.setStorageSync('autoLockOnHide', false);
            this.setData({ autoLockOnHide: false });
          } else {
            this.setData({ autoLockOnHide: true });
          }
        }
      });
      return;
    }
    wx.setStorageSync('autoLockOnHide', true);
    this.setData({ autoLockOnHide: true });
    wx.showToast({ title: '已开启', icon: 'none' });
  },

  chooseAvatar() {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    setTemporaryForeground(true);
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      success: (res) => {
        const filePath = res.tempFilePaths && res.tempFilePaths[0];
        if (!filePath) return;
        wx.showLoading({ title: '上传中', mask: true });
        const formData = {
          category: 'avatars',
          user_id: openid
        };
        if (this.data.spaceId) {
          formData.space_id = this.data.spaceId;
        }
        wx.uploadFile({
          url: `${BASE_URL}/api/upload`,
          filePath,
          name: 'file',
          formData,
          success: (resp) => {
            try {
              const data = JSON.parse(resp.data || '{}');
              let url = data.url || '';
              if (url && url.startsWith('/')) {
                url = `${BASE_URL}${url}`;
              }
              if (url) {
                this.saveAlias({ avatarUrl: url });
              }
            } catch (e) {
              wx.showToast({ title: '上传失败', icon: 'none' });
            }
          },
          fail: () => {
            wx.showToast({ title: '上传失败', icon: 'none' });
          },
          complete: () => {
            wx.hideLoading();
          }
        });
      },
      complete: () => {
        setTemporaryForeground(false);
      }
    });
  },

  copyShareCode() {
    wx.setClipboardData({
      data: this.data.shareCode,
      success: () => {
        wx.showToast({ title: '已复制' });
      }
    });
  },

  closeShareModal() {
    this.setData({ showShareModal: false, shareInfoText: '' });
  },

  openMembersModal() {
    if (!this.data.members.length) return;
    this.setData({ showMembersModal: true });
  },

  closeMembersModal() {
    this.setData({ showMembersModal: false });
  },

  openAliasModal() {
    this.setData({ showAliasModal: true, newAlias: this.data.alias });
  },
  closeAliasModal() {
    this.setData({ showAliasModal: false });
  },
  onAliasInput(e) {
    this.setData({ newAlias: e.detail.value });
  },
  saveAlias({ alias = this.data.alias, avatarUrl = this.data.avatarUrl, themePreference = this.data.themePreference, closeModal = false } = {}) {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/user/set-alias`,
      method: 'POST',
      data: { space_id: this.data.spaceId, user_id: openid, alias, avatar_url: avatarUrl, theme_preference: themePreference },
      success: () => {
        const aliasInitial = (alias || openid || '我').charAt(0);
        this._aliasSig = this.buildAliasSignature(alias, avatarUrl);
        this.setData({ alias, avatarUrl, aliasInitial, themePreference, themeIndex: this.getThemeIndex(themePreference), showAliasModal: closeModal ? false : this.data.showAliasModal });
        this.persistSettingsCache();
        try {
          wx.setStorageSync(`myAlias_${this.data.spaceId}`, alias);
          wx.setStorageSync(`myAvatar_${this.data.spaceId}`, avatarUrl);
          wx.setStorageSync('aliasUpdatedAt', Date.now());
        } catch (e) {}
        wx.showToast({ title: '已保存', icon: 'none' });
      }
    });
  },
  confirmAlias() {
    const alias = this.data.newAlias.trim();
    this.saveAlias({ alias, closeModal: true });
  },

  deleteSpace() {
    const phrase = `我确定删除空间${this.data.spaceCode || ''}`;
    this.setData({ showDeleteModal: true, deleteConfirmInput: '', deleteConfirmPhrase: phrase });
  },
  onDeleteConfirmInput(e) {
    this.setData({ deleteConfirmInput: e.detail.value || '' });
  },
  closeDeleteModal() {
    this.setData({ showDeleteModal: false, deleteConfirmInput: '' });
  },
  confirmDeleteSpace() {
    const phrase = this.data.deleteConfirmPhrase || `我确定删除空间${this.data.spaceCode || ''}`;
    if ((this.data.deleteConfirmInput || '').trim() !== phrase) {
      wx.showToast({ title: '请输入完整确认文字', icon: 'none' });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/space/delete`,
      method: 'POST',
      data: { space_id: this.data.spaceId, operator_user_id: wx.getStorageSync('openid') || '' },
      success: (res) => {
        if (res.data.success) {
          wx.clearStorageSync();
          wx.reLaunch({
            url: '/pages/index/index'
          });
        } else {
          wx.showToast({ title: res.data?.detail || '删除失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '删除失败', icon: 'none' });
      }
    });
  },
  blockMember(e) {
    const memberUserId = e.currentTarget.dataset.userid;
    wx.showModal({
      title: '拉黑成员',
      content: '将该成员加入黑名单并移出房间，确认？',
      success: (res) => {
        if (res.confirm) {
          wx.request({
            url: `${BASE_URL}/api/space/block-member`,
            method: 'POST',
            data: { space_id: this.data.spaceId, member_user_id: memberUserId, operator_user_id: wx.getStorageSync('openid') || '' },
            success: () => { this.fetchMembers(); this.fetchBlocks(); }
          });
        }
      }
    })
  },
  unblockMember(e) {
    const memberUserId = e.currentTarget.dataset.userid;
    wx.request({
      url: `${BASE_URL}/api/space/unblock-member`,
      method: 'POST',
      data: { space_id: this.data.spaceId, member_user_id: memberUserId, operator_user_id: wx.getStorageSync('openid') || '' },
      success: () => { this.fetchBlocks(); }
    });
  },
  removeMember(e) {
    const memberUserId = e.currentTarget.dataset.userid;
    wx.showModal({
      title: '移除成员',
      content: '确认将该成员移出房间？',
      success: (res) => {
        if (res.confirm) {
          wx.request({
            url: `${BASE_URL}/api/space/remove-member`,
            method: 'POST',
            data: { space_id: this.data.spaceId, member_user_id: memberUserId, operator_user_id: wx.getStorageSync('openid') || '' },
            success: () => { this.fetchMembers(); }
          });
        }
      }
    });
  }
}); 
