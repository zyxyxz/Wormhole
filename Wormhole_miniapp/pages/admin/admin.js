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
  onLoad() {
    const openid = wx.getStorageSync('openid') || '';
    this.setData({ adminOpenId: openid });
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
  fetchOverview() {
    const { adminOpenId, adminRoomCode } = this.data;
    if (!adminOpenId || !adminRoomCode) {
      wx.showToast({ title: '请输入管理员ID和房间号', icon: 'none' });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/settings/admin/overview`,
      data: { user_id: adminOpenId, room_code: adminRoomCode },
      success: (res) => {
        if (res.data && res.data.users !== undefined) {
          this.setData({ overview: res.data });
        } else {
          wx.showToast({ title: res.data.detail || '加载失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  fetchUsers() {
    const { adminOpenId, adminRoomCode } = this.data;
    wx.request({
      url: `${BASE_URL}/api/settings/admin/users`,
      data: { user_id: adminOpenId, room_code: adminRoomCode },
      success: (res) => {
        if (res.data && Array.isArray(res.data.users)) {
          this.setData({ users: res.data.users });
        } else {
          wx.showToast({ title: res.data.detail || '加载失败', icon: 'none' });
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
