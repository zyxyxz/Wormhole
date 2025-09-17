const { BASE_URL } = require('../../utils/config.js');

Page({
  data: {
    spaceCode: '',
    newSpaceCode: '',
    shareCode: '',
    showModifyModal: false,
    showShareModal: false,
    showAliasModal: false,
    alias: '',
    newAlias: '',
    spaceId: '',
    isOwner: false,
    members: []
  },
  onBack() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onLoad() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    const spaceCode = wx.getStorageSync('currentSpaceCode');
    this.setData({ 
      spaceId,
      spaceCode 
    });
    this.fetchAlias();
    this.fetchSpaceInfo();
  },

  fetchSpaceInfo() {
    wx.request({
      url: `${BASE_URL}/api/space/info`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        const info = res.data;
        const isOwner = wx.getStorageSync('openid') === info.owner_user_id;
        this.setData({ isOwner, ownerUserId: info.owner_user_id });
        if (isOwner) this.fetchMembers();
      }
    });
  },

  fetchMembers() {
    wx.request({
      url: `${BASE_URL}/api/space/members`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        this.setData({ members: res.data.members || [] });
        this.fetchBlocks();
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
          this.setData({ alias: res.data.alias });
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
    wx.request({
      url: `${BASE_URL}/api/space/share`,
      method: 'POST',
      data: { space_id: this.data.spaceId },
      success: (res) => {
        this.setData({
          shareCode: res.data.share_code || res.data.shareCode || res.data.share_code,
          showShareModal: true
        });
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
    this.setData({ showShareModal: false });
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
  confirmAlias() {
    const alias = this.data.newAlias.trim();
    const openid = wx.getStorageSync('openid');
    if (!openid) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/user/set-alias`,
      method: 'POST',
      data: { space_id: this.data.spaceId, user_id: openid, alias },
      success: () => {
        this.setData({ alias, showAliasModal: false });
        // 保存到本地，并触发页面刷新标记
        try {
          wx.setStorageSync('myAlias', alias);
          wx.setStorageSync('aliasUpdatedAt', Date.now());
        } catch (e) {}
        wx.showToast({ title: '已保存' });
      }
    });
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
