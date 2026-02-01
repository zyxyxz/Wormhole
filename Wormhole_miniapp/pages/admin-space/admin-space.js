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
    spaceId: '',
    space: {},
    members: [],
    recentPosts: [],
    recentMessages: [],
    recentNotes: [],
    includeDeleted: false,
    limit: 20,
    limitInput: '20',
    loading: true
  },

  onLoad(options = {}) {
    this.setData({
      adminOpenId: options.user_id || '',
      adminRoomCode: options.room_code || '',
      spaceId: options.space_id || ''
    });
    this.fetchDetail();
  },

  goBack() {
    wx.navigateBack();
  },

  goLogs() {
    const { adminOpenId, adminRoomCode, space } = this.data;
    if (!space || !space.space_id) return;
    const url = `/pages/admin-logs/admin-logs?type=space&space_id=${space.space_id}`
      + `&space_code=${encodeURIComponent(space.code || '')}`
      + `&owner=${encodeURIComponent(space.owner_alias || space.owner_user_id || '')}`
      + `&user_id=${encodeURIComponent(adminOpenId)}`
      + `&room_code=${encodeURIComponent(adminRoomCode)}`;
    wx.navigateTo({ url });
  },

  onToggleIncludeDeleted(e) {
    this.setData({ includeDeleted: !!e.detail.value });
    this.fetchDetail();
  },

  onLimitInput(e) {
    this.setData({ limitInput: e.detail.value });
  },

  applyLimit() {
    const raw = parseInt(this.data.limitInput || '20', 10);
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 200)) : 20;
    this.setData({ limit, limitInput: String(limit) });
    this.fetchDetail();
  },

  previewImage(e) {
    const urls = e.currentTarget.dataset.urls || [];
    const current = e.currentTarget.dataset.current || urls[0];
    if (!urls.length) return;
    wx.previewImage({ current, urls });
  },

  fetchDetail() {
    const { adminOpenId, adminRoomCode, spaceId, includeDeleted, limit } = this.data;
    if (!adminOpenId || !adminRoomCode || !spaceId) {
      wx.showToast({ title: '缺少管理员信息', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载中', mask: true });
    wx.request({
      url: `${BASE_URL}/api/settings/admin/space-detail`,
      data: {
        user_id: adminOpenId,
        room_code: adminRoomCode,
        space_id: spaceId,
        include_deleted: includeDeleted ? 1 : 0,
        limit: limit || 20
      },
      success: (res) => {
        wx.hideLoading();
        if (res.data && res.data.space) {
          const space = res.data.space || {};
          space.created_at_bj = formatBeijingTime(space.created_at);
          const recentPosts = (res.data.recent_posts || []).map(item => ({
            ...item,
            created_at_bj: formatBeijingTime(item.created_at)
          }));
          const recentMessages = (res.data.recent_messages || []).map(item => ({
            ...item,
            created_at_bj: formatBeijingTime(item.created_at)
          }));
          const recentNotes = (res.data.recent_notes || []).map(item => ({
            ...item,
            created_at_bj: formatBeijingTime(item.created_at)
          }));
          this.setData({
            space,
            members: res.data.members || [],
            recentPosts,
            recentMessages,
            recentNotes,
            loading: false
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
  }
});
