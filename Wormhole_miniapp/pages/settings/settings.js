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
    autoLockOptions: ['1分钟', '5分钟', '10分钟', '30分钟', '1小时']
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
    this.fetchAlias();
    this.fetchSpaceInfo();
    const autoLockSeconds = wx.getStorageSync('autoLockSeconds');
    this.updateAutoLockDisplay(autoLockSeconds);
  },

  fetchSpaceInfo() {
    wx.request({
      url: `${BASE_URL}/api/space/info`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        const info = res.data;
        const isOwner = wx.getStorageSync('openid') === info.owner_user_id;
        this.setData({ isOwner, ownerUserId: info.owner_user_id });
        this.fetchMembers();
      }
    });
  },

  fetchMembers() {
    wx.request({
      url: `${BASE_URL}/api/space/members`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        const membersRaw = res.data.members || [];
        const members = membersRaw.map(item => ({
          ...item,
          displayName: item.alias || item.user_id,
          initial: (item.alias || item.user_id || '?').charAt(0)
        }));
        const preview = members.slice(0, 4);
        this.setData({
          members,
          memberPreview: preview
        });
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
        this.setData({ blocks: res.data.blocks || [] });
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
          this.setData({
            alias,
            avatarUrl,
            aliasInitial: (alias || openid || '我').charAt(0)
          });
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
    const map = [60, 300, 600, 1800, 3600];
    if (seconds) {
      const idx = map.indexOf(seconds);
      if (idx >= 0) {
        index = idx;
        label = options[idx];
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
    this.setData({ autoLockIndex: Number(e.detail.value || 0) });
  },

  confirmAutoLock() {
    const map = [60, 300, 600, 1800, 3600];
    const seconds = map[this.data.autoLockIndex] || 0;
    wx.setStorageSync('autoLockSeconds', seconds);
    this.updateAutoLockDisplay(seconds);
    this.setData({ showAutoLockModal: false });
    wx.showToast({ title: '已保存', icon: 'none' });
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
  saveAlias({ alias = this.data.alias, avatarUrl = this.data.avatarUrl, closeModal = false } = {}) {
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/user/set-alias`,
      method: 'POST',
      data: { space_id: this.data.spaceId, user_id: openid, alias, avatar_url: avatarUrl },
      success: () => {
        const aliasInitial = (alias || openid || '我').charAt(0);
        this.setData({ alias, avatarUrl, aliasInitial, showAliasModal: closeModal ? false : this.data.showAliasModal });
        try {
          wx.setStorageSync(`myAlias_${this.data.spaceId}`, alias);
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
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确认删除该空间？',
      success: (res) => {
        if (res.confirm) {
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
              }
            }
          });
        }
      }
    });
  }
  ,
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
  }
  ,
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
