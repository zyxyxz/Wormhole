const { BASE_URL } = require('../../utils/config.js');

Page({
  data: {
    adminOpenId: '',
    adminRoomCode: '',
    overview: {},
    users: [],
    currentUserSpaces: [],
    currentUserId: ''
  },
  onLoad(options = {}) {
    const openid = wx.getStorageSync('openid') || '';
    const roomCode = options.room_code || '';
    const autoEnter = options.auto === '1';
    this.setData({ adminOpenId: openid, adminRoomCode: roomCode });
    if (autoEnter && openid && roomCode) {
      this.fetchOverview({ silent: true });
      this.fetchUsers({ silent: true });
    }
  },
  goBack() {
    wx.navigateBack();
  },
  onAdminIdInput(e) {
    this.setData({ adminOpenId: e.detail.value });
  },
  onAdminRoomInput(e) {
    this.setData({ adminRoomCode: e.detail.value });
  },
  fetchOverview(opts = {}) {
    const { adminOpenId, adminRoomCode } = this.data;
    const silent = !!opts.silent;
    if (!adminOpenId || !adminRoomCode) {
      if (!silent) {
        wx.showToast({ title: '请输入管理员ID和房间号', icon: 'none' });
      }
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/settings/admin/overview`,
      data: { user_id: adminOpenId, room_code: adminRoomCode },
      success: (res) => {
        if (res.data && res.data.users !== undefined) {
          this.setData({ overview: res.data });
        } else if (!silent) {
          wx.showToast({ title: res.data.detail || '加载失败', icon: 'none' });
        }
      },
      fail: () => {
        if (!silent) {
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      }
    });
  },

  fetchUsers(opts = {}) {
    const { adminOpenId, adminRoomCode } = this.data;
    const silent = !!opts.silent;
    if (!adminOpenId || !adminRoomCode) {
      if (!silent) {
        wx.showToast({ title: '请输入管理员ID和房间号', icon: 'none' });
      }
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/settings/admin/users`,
      data: { user_id: adminOpenId, room_code: adminRoomCode },
      success: (res) => {
        if (res.data && Array.isArray(res.data.users)) {
          this.setData({ users: res.data.users });
        } else if (!silent) {
          wx.showToast({ title: res.data.detail || '加载失败', icon: 'none' });
        }
      },
      fail: () => {
        if (!silent) {
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      }
    });
  },

  viewSpaces(e) {
    const targetUserId = e.currentTarget.dataset.userid;
    if (!targetUserId) return;
    const { adminOpenId, adminRoomCode } = this.data;
    wx.request({
      url: `${BASE_URL}/api/settings/admin/user-spaces`,
      data: { user_id: adminOpenId, room_code: adminRoomCode, target_user_id: targetUserId },
      success: (res) => {
        if (res.data && Array.isArray(res.data.spaces)) {
          this.setData({ currentUserSpaces: res.data.spaces, currentUserId: targetUserId });
        } else {
          wx.showToast({ title: res.data.detail || '加载失败', icon: 'none' });
        }
      }
    });
  }
});
