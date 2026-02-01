const { BASE_URL } = require('../../utils/config.js');

function normalizeDateString(str) {
  if (!str) return '';
  let normalized = str.replace(' ', 'T');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized += 'Z';
  }
  return normalized;
}

function formatBeijingTime(isoString) {
  if (!isoString) return '';
  const normalized = normalizeDateString(isoString);
  const ts = Date.parse(normalized);
  if (Number.isNaN(ts)) return isoString;
  const bj = new Date(ts + 8 * 60 * 60 * 1000);
  const pad = (n) => n.toString().padStart(2, '0');
  return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`;
}

function maskOpenId(id) {
  if (!id) return '';
  const text = String(id);
  if (text.length <= 8) return text;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function resolveDisplayName(alias, userId) {
  if (alias) return alias;
  return maskOpenId(userId);
}

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
    recentPosts: [],
    recentMessages: [],
    reviewMode: false,
    messagesLoading: false,
    postsLoading: false
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
            const overview = { ...res.data };
            if (overview.last_login) {
              overview.last_login_bj = formatBeijingTime(overview.last_login);
            }
            this.setData({ overview });
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
            const list = (res.data.users || []).map(u => ({
              ...u,
              created_at_bj: formatBeijingTime(u.created_at)
            }));
            this.setData({ users: list });
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
    wx.showModal({
      title: '确认清理空房',
      content: '将清理只有房主、且无任何数据记录（含软删除数据和日志）的房间，确认继续？',
      success: (res) => {
        if (!res.confirm) return;
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
            const spaces = (res.data.spaces || []).map(s => ({
              ...s,
              created_at_bj: formatBeijingTime(s.created_at),
              owner_display: resolveDisplayName(s.owner_alias, s.owner_user_id)
            }));
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
          const list = (Array.isArray(res.data?.messages) ? res.data.messages : []).map(m => ({
            ...m,
            created_at_bj: formatBeijingTime(m.created_at)
          }));
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
          const list = (Array.isArray(res.data?.posts) ? res.data.posts : []).map(p => ({
            ...p,
            created_at_bj: formatBeijingTime(p.created_at)
          }));
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
    const url = `/pages/admin-space/admin-space?space_id=${encodeURIComponent(spaceId)}`
      + `&user_id=${encodeURIComponent(adminOpenId)}&room_code=${encodeURIComponent(adminRoomCode)}`;
    wx.navigateTo({ url });
  },

  openSpaceLogs(e) {
    const spaceId = e.currentTarget.dataset.id;
    const spaceCode = e.currentTarget.dataset.code || '';
    const owner = e.currentTarget.dataset.owner || '';
    if (!spaceId) return;
    const { adminOpenId, adminRoomCode } = this.data;
    const url = `/pages/admin-logs/admin-logs?type=space&space_id=${encodeURIComponent(spaceId)}`
      + `&space_code=${encodeURIComponent(spaceCode)}&owner=${encodeURIComponent(owner)}`
      + `&user_id=${encodeURIComponent(adminOpenId)}&room_code=${encodeURIComponent(adminRoomCode)}`;
    wx.navigateTo({ url });
  },

  openUserLogs(e) {
    const userId = e.currentTarget.dataset.userid;
    const alias = e.currentTarget.dataset.alias || '';
    if (!userId) return;
    const { adminOpenId, adminRoomCode } = this.data;
    const url = `/pages/admin-logs/admin-logs?type=user&target_user_id=${encodeURIComponent(userId)}`
      + `&alias=${encodeURIComponent(alias)}&user_id=${encodeURIComponent(adminOpenId)}&room_code=${encodeURIComponent(adminRoomCode)}`;
    wx.navigateTo({ url });
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
