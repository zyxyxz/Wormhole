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

Page({
  data: {
    adminOpenId: '',
    adminRoomCode: '',
    targetType: '',
    space: {},
    user: {},
    logEntries: [],
    loading: true,
    limit: 30
  },

  onLoad(options = {}) {
    const targetType = options.type || '';
    this.setData({
      adminOpenId: options.user_id || '',
      adminRoomCode: options.room_code || '',
      targetType,
      space: {
        space_id: options.space_id || '',
        code: options.space_code || '',
        owner: options.owner || ''
      },
      user: {
        user_id: options.target_user_id || '',
        alias: options.alias || ''
      }
    });
    this.fetchLogs();
  },

  goBack() {
    wx.navigateBack();
  },

  fetchLogs() {
    const { adminOpenId, adminRoomCode, targetType, space, user, limit } = this.data;
    if (!adminOpenId || !adminRoomCode) {
      this.setData({ loading: false });
      wx.showToast({ title: '缺少管理员信息', icon: 'none' });
      return;
    }
    const params = {
      user_id: adminOpenId,
      room_code: adminRoomCode,
      limit,
      offset: 0
    };
    if (targetType === 'space' && space.space_id) {
      params.space_id = space.space_id;
    }
    if (targetType === 'user' && user.user_id) {
      params.target_user_id = user.user_id;
    }
    this.setData({ loading: true });
    wx.request({
      url: `${BASE_URL}/api/logs/admin/list`,
      data: params,
      success: (res) => {
        const list = Array.isArray(res.data?.logs) ? res.data.logs : [];
        const decorated = list.map(item => ({
          ...item,
          created_at_bj: formatBeijingTime(item.created_at)
        }));
        this.setData({ logEntries: decorated, loading: false });
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '日志加载失败', icon: 'none' });
      }
    });
  }
});
