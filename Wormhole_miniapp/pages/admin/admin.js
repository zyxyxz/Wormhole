const { BASE_URL } = require('../../utils/config.js');

Page({
  data: {
    adminOpenId: '',
    adminRoomCode: '',
    overview: {},
    users: [],
    currentUserSpaces: [],
    currentUserId: '',
    loading: true,
    hasAccess: false
  },
  onLoad(options = {}) {
    const openid = wx.getStorageSync('openid') || '';
    const roomCode = options.room_code || '';
    this.setData({ adminOpenId: openid, adminRoomCode: roomCode, loading: true });
    if (openid && roomCode) {
      this.refreshData({ silent: true, exitOnFail: true });
    } else {
      this.exitDueToNoAccess('未授权');
    }
  },
  goBack() {
    wx.navigateBack();
  },
  fetchOverview(opts = {}) {
    const { adminOpenId, adminRoomCode } = this.data;
    const silent = !!opts.silent;
    return new Promise((resolve, reject) => {
      if (!adminOpenId || !adminRoomCode) {
        if (!silent) {
          wx.showToast({ title: '缺少管理员信息', icon: 'none' });
        }
        reject(new Error('missing-admin'));
        return;
      }
      wx.request({
        url: `${BASE_URL}/api/settings/admin/overview`,
        data: { user_id: adminOpenId, room_code: adminRoomCode },
        success: (res) => {
          if (res.statusCode === 200 && res.data && res.data.users !== undefined) {
            this.setData({ overview: res.data });
            resolve(res.data);
          } else {
            if (!silent) {
              wx.showToast({ title: res.data?.detail || '加载失败', icon: 'none' });
            }
            reject(new Error('denied'));
          }
        },
        fail: () => {
          if (!silent) {
            wx.showToast({ title: '网络异常', icon: 'none' });
          }
          reject(new Error('network'));
        }
      });
    });
  },

  fetchUsers(opts = {}) {
    const { adminOpenId, adminRoomCode } = this.data;
    const silent = !!opts.silent;
    return new Promise((resolve, reject) => {
      if (!adminOpenId || !adminRoomCode) {
        if (!silent) {
          wx.showToast({ title: '缺少管理员信息', icon: 'none' });
        }
        reject(new Error('missing-admin'));
        return;
      }
      wx.request({
        url: `${BASE_URL}/api/settings/admin/users`,
        data: { user_id: adminOpenId, room_code: adminRoomCode },
        success: (res) => {
          if (res.statusCode === 200 && Array.isArray(res.data?.users)) {
            this.setData({ users: res.data.users });
            resolve(res.data.users);
          } else {
            if (!silent) {
              wx.showToast({ title: res.data?.detail || '加载失败', icon: 'none' });
            }
            reject(new Error('denied'));
          }
        },
        fail: () => {
          if (!silent) {
            wx.showToast({ title: '网络异常', icon: 'none' });
          }
          reject(new Error('network'));
        }
      });
    });
  },

  refreshData(arg = {}) {
    const opts = (arg && arg.currentTarget) ? {} : (arg || {});
    const { silent, exitOnFail } = opts;
    this.setData({ loading: true });
    Promise.all([
      this.fetchOverview({ silent: true }),
      this.fetchUsers({ silent: true })
    ]).then(() => {
      this.setData({ loading: false, hasAccess: true });
    }).catch(() => {
      this.setData({ loading: false });
      if (!silent) {
        wx.showToast({ title: '刷新失败', icon: 'none' });
      }
      if (exitOnFail) {
        this.exitDueToNoAccess('无权限');
      }
    });
  },

  exitDueToNoAccess(message) {
    if (message) {
      wx.showToast({ title: message, icon: 'none' });
    }
    setTimeout(() => {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.reLaunch({ url: '/pages/index/index' });
      }
    }, 600);
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
