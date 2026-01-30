const { BASE_URL } = require('../../utils/config.js');

Page({
  data: {
    adminOpenId: '',
    adminRoomCode: '',
    overview: {},
    users: [],
    loading: true,
    hasAccess: false,
    spaces: [],
    spaceList: [],
    spaceOwnerFilter: '',
    activeSection: '',
    showSpaceModal: false,
    spaceDetail: null,
    spaceMembers: [],
    recentPosts: [],
    recentMessages: [],
    spaceRecentPosts: [],
    spaceRecentMessages: [],
    reviewMode: false,
    messagesLoading: false,
    postsLoading: false,
    showLogModal: false,
    logTargetType: '',
    logSpace: null,
    logUser: null,
    logEntries: [],
    logLoading: false,
    logLimit: 30
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
      this.fetchUsers({ silent: true }),
      this.fetchSpaces({ silent: true }),
      this.fetchSystemFlags({ silent: true })
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

  cleanIdleSpaces() {
    const { adminOpenId, adminRoomCode } = this.data;
    if (!adminOpenId || !adminRoomCode) {
      wx.showToast({ title: '管理员信息缺失', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '清理中', mask: true });
    const url = `${BASE_URL}/api/settings/admin/cleanup-spaces?user_id=${encodeURIComponent(adminOpenId)}&room_code=${encodeURIComponent(adminRoomCode)}`;
    wx.request({
      url,
      method: 'POST',
      data: { user_id: adminOpenId, room_code: adminRoomCode },
      success: (res) => {
        wx.hideLoading();
        const deleted = res.data?.deleted ?? 0;
        wx.showToast({ title: `已清理 ${deleted} 个`, icon: 'none' });
        if (deleted > 0) {
          this.refreshData({ silent: true });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '操作失败', icon: 'none' });
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
    this.setSpaceFilter(targetUserId);
  },

  onStatTap(e) {
    const section = e.currentTarget.dataset.section;
    if (!section) return;
    const next = this.data.activeSection === section ? '' : section;
    if (next === 'spaces') {
      this.clearSpaceFilter();
    }
    this.setData({ activeSection: next });
    if (!next) return;
    if (next === 'users') {
      this.fetchUsers({ silent: true });
    } else if (next === 'spaces') {
      if (!this.data.spaces.length) {
        this.fetchSpaces({ silent: true });
      }
    } else if (next === 'messages') {
      this.fetchRecentMessages({ silent: true });
    } else if (next === 'posts') {
      this.fetchRecentPosts({ silent: true });
    }
  },

  setSpaceFilter(userId) {
    if (!userId) return;
    const applyFilter = () => {
      const spaces = this.data.spaces || [];
      const filtered = spaces.filter(s => s.owner_user_id === userId);
      this.setData({
        spaceOwnerFilter: userId,
        spaceList: filtered,
        activeSection: 'spaces'
      });
    };
    if (!this.data.spaces.length) {
      this.fetchSpaces({ silent: true }).then(applyFilter);
    } else {
      applyFilter();
    }
  },

  clearSpaceFilter() {
    const spaces = this.data.spaces || [];
    this.setData({ spaceOwnerFilter: '', spaceList: spaces });
  },

  fetchSpaces(opts = {}) {
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
        url: `${BASE_URL}/api/settings/admin/spaces`,
        data: { user_id: adminOpenId, room_code: adminRoomCode },
        success: (res) => {
          if (res.statusCode === 200 && Array.isArray(res.data?.spaces)) {
            const spaces = res.data.spaces || [];
            const filterOwner = (this.data.spaceOwnerFilter || '').trim();
            const spaceList = filterOwner
              ? spaces.filter(s => s.owner_user_id === filterOwner)
              : spaces;
            this.setData({ spaces, spaceList });
            resolve(spaces);
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

  fetchRecentMessages(opts = {}) {
    const { adminOpenId, adminRoomCode } = this.data;
    const silent = !!opts.silent;
    if (!adminOpenId || !adminRoomCode) {
      if (!silent) {
        wx.showToast({ title: '缺少管理员信息', icon: 'none' });
      }
      return Promise.reject(new Error('missing-admin'));
    }
    this.setData({ messagesLoading: true });
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${BASE_URL}/api/settings/admin/recent-messages`,
        data: { user_id: adminOpenId, room_code: adminRoomCode, limit: 10 },
        success: (res) => {
          const list = Array.isArray(res.data?.messages) ? res.data.messages : [];
          this.setData({ recentMessages: list, messagesLoading: false });
          resolve(list);
        },
        fail: () => {
          this.setData({ messagesLoading: false });
          if (!silent) {
            wx.showToast({ title: '消息加载失败', icon: 'none' });
          }
          reject(new Error('network'));
        }
      });
    });
  },

  fetchRecentPosts(opts = {}) {
    const { adminOpenId, adminRoomCode } = this.data;
    const silent = !!opts.silent;
    if (!adminOpenId || !adminRoomCode) {
      if (!silent) {
        wx.showToast({ title: '缺少管理员信息', icon: 'none' });
      }
      return Promise.reject(new Error('missing-admin'));
    }
    this.setData({ postsLoading: true });
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${BASE_URL}/api/settings/admin/recent-posts`,
        data: { user_id: adminOpenId, room_code: adminRoomCode, limit: 10 },
        success: (res) => {
          const list = Array.isArray(res.data?.posts) ? res.data.posts : [];
          this.setData({ recentPosts: list, postsLoading: false });
          resolve(list);
        },
        fail: () => {
          this.setData({ postsLoading: false });
          if (!silent) {
            wx.showToast({ title: '动态加载失败', icon: 'none' });
          }
          reject(new Error('network'));
        }
      });
    });
  },

  openSpaceDetail(e) {
    const spaceId = e.currentTarget.dataset.id;
    if (!spaceId) return;
    const { adminOpenId, adminRoomCode } = this.data;
    wx.showLoading({ title: '加载中', mask: true });
    wx.request({
      url: `${BASE_URL}/api/settings/admin/space-detail`,
      data: { user_id: adminOpenId, room_code: adminRoomCode, space_id: spaceId },
      success: (res) => {
        wx.hideLoading();
        if (res.data && res.data.space) {
          this.setData({
            spaceDetail: res.data.space,
            spaceMembers: res.data.members || [],
            spaceRecentPosts: res.data.recent_posts || [],
            spaceRecentMessages: res.data.recent_messages || [],
            showSpaceModal: true
          });
        } else {
          wx.showToast({ title: res.data?.detail || '加载失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  closeSpaceDetail() {
    this.setData({
      showSpaceModal: false,
      spaceDetail: null,
      spaceMembers: [],
      spaceRecentPosts: [],
      spaceRecentMessages: []
    });
  },

  openSpaceLogs(e) {
    const spaceId = e.currentTarget.dataset.id;
    const spaceCode = e.currentTarget.dataset.code || '';
    const owner = e.currentTarget.dataset.owner || '';
    if (!spaceId) return;
    this.setData({
      showLogModal: true,
      logTargetType: 'space',
      logSpace: { space_id: spaceId, code: spaceCode, owner },
      logUser: null,
      logEntries: [],
      logLoading: true
    });
    this.fetchSpaceLogs(spaceId);
  },

  closeSpaceLogs() {
    this.setData({
      showLogModal: false,
      logTargetType: '',
      logSpace: null,
      logUser: null,
      logEntries: []
    });
  },

  openUserLogs(e) {
    const userId = e.currentTarget.dataset.userid;
    const alias = e.currentTarget.dataset.alias || '';
    if (!userId) return;
    this.setData({
      showLogModal: true,
      logTargetType: 'user',
      logUser: { user_id: userId, alias },
      logSpace: null,
      logEntries: [],
      logLoading: true
    });
    this.fetchUserLogs(userId);
  },

  fetchSpaceLogs(spaceId) {
    const { adminOpenId, adminRoomCode, logLimit } = this.data;
    if (!adminOpenId || !adminRoomCode) {
      this.setData({ logLoading: false });
      wx.showToast({ title: '缺少管理员信息', icon: 'none' });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/logs/admin/list`,
      data: {
        user_id: adminOpenId,
        room_code: adminRoomCode,
        space_id: spaceId,
        limit: logLimit,
        offset: 0
      },
      success: (res) => {
        const list = Array.isArray(res.data?.logs) ? res.data.logs : [];
        this.setData({ logEntries: list, logLoading: false });
      },
      fail: () => {
        this.setData({ logLoading: false });
        wx.showToast({ title: '日志加载失败', icon: 'none' });
      }
    });
  },

  fetchUserLogs(targetUserId) {
    const { adminOpenId, adminRoomCode, logLimit } = this.data;
    if (!adminOpenId || !adminRoomCode) {
      this.setData({ logLoading: false });
      wx.showToast({ title: '缺少管理员信息', icon: 'none' });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/logs/admin/list`,
      data: {
        user_id: adminOpenId,
        room_code: adminRoomCode,
        target_user_id: targetUserId,
        limit: logLimit,
        offset: 0
      },
      success: (res) => {
        const list = Array.isArray(res.data?.logs) ? res.data.logs : [];
        this.setData({ logEntries: list, logLoading: false });
      },
      fail: () => {
        this.setData({ logLoading: false });
        wx.showToast({ title: '日志加载失败', icon: 'none' });
      }
    });
  },

  fetchSystemFlags(opts = {}) {
    const silent = !!opts.silent;
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${BASE_URL}/api/settings/system`,
        success: (res) => {
          const flag = !!res.data?.review_mode;
          this.setData({ reviewMode: flag });
          resolve(flag);
        },
        fail: () => {
          if (!silent) {
            wx.showToast({ title: '配置拉取失败', icon: 'none' });
          }
          reject(new Error('network'));
        }
      });
    });
  },

  toggleReviewMode(e) {
    const { adminOpenId, adminRoomCode } = this.data;
    if (!adminOpenId || !adminRoomCode) {
      wx.showToast({ title: '管理员信息缺失', icon: 'none' });
      return;
    }
    const next = !!e.detail.value;
    wx.request({
      url: `${BASE_URL}/api/settings/admin/system/review-mode`,
      method: 'POST',
      data: { user_id: adminOpenId, room_code: adminRoomCode, review_mode: next },
      success: () => {
        this.setData({ reviewMode: next });
        try {
          wx.setStorageSync('reviewMode', next);
          const app = getApp();
          if (app && typeof app.applyReviewMode === 'function') {
            app.applyReviewMode(next);
          }
        } catch (error) {}
        wx.showToast({ title: '已更新', icon: 'none' });
      },
      fail: () => {
        wx.showToast({ title: '操作失败', icon: 'none' });
        this.setData({ reviewMode: !next });
      }
    });
  }
});
