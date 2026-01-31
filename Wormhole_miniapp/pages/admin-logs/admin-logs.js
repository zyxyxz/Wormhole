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
    loadingMore: false,
    limit: 100,
    offset: 0,
    hasMore: true,
    startDate: '',
    endDate: '',
    filterLabel: '最近 100 条日志 · 北京时间'
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
    this.fetchLogs({ reset: true });
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return;
    this.fetchLogs({ reset: false });
  },

  goBack() {
    wx.navigateBack();
  },

  onStartDateChange(e) {
    const value = e.detail.value || '';
    this.setData({ startDate: value }, () => this.updateFilterLabel());
  },

  onEndDateChange(e) {
    const value = e.detail.value || '';
    this.setData({ endDate: value }, () => this.updateFilterLabel());
  },

  applyFilter() {
    const { startDate, endDate } = this.data;
    if (startDate && endDate && startDate > endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.fetchLogs({ reset: true });
  },

  resetFilter() {
    this.setData({ startDate: '', endDate: '' }, () => {
      this.updateFilterLabel();
      this.fetchLogs({ reset: true });
    });
  },

  updateFilterLabel() {
    const { startDate, endDate, limit } = this.data;
    if (!startDate && !endDate) {
      this.setData({ filterLabel: `最近 ${limit} 条日志 · 北京时间` });
      return;
    }
    const left = startDate || '开始';
    const right = endDate || '结束';
    this.setData({ filterLabel: `${left} 至 ${right} · 北京时间` });
  },

  fetchLogs({ reset }) {
    const { adminOpenId, adminRoomCode, targetType, space, user, limit, startDate, endDate } = this.data;
    if (!adminOpenId || !adminRoomCode) {
      this.setData({ loading: false, loadingMore: false });
      wx.showToast({ title: '缺少管理员信息', icon: 'none' });
      return;
    }
    const nextOffset = reset ? 0 : this.data.offset;
    const params = {
      user_id: adminOpenId,
      room_code: adminRoomCode,
      limit,
      offset: nextOffset
    };
    if (targetType === 'space' && space.space_id) {
      params.space_id = space.space_id;
    }
    if (targetType === 'user' && user.user_id) {
      params.target_user_id = user.user_id;
    }
    if (startDate) params.start_time = startDate;
    if (endDate) params.end_time = endDate;
    if (reset) {
      this.setData({ loading: true, loadingMore: false, hasMore: true, offset: 0, logEntries: [] });
    } else {
      this.setData({ loadingMore: true });
    }
    wx.request({
      url: `${BASE_URL}/api/logs/admin/list`,
      data: params,
      success: (res) => {
        const list = Array.isArray(res.data?.logs) ? res.data.logs : [];
        const decorated = list.map(item => ({
          ...item,
          created_at_bj: formatBeijingTime(item.created_at)
        }));
        const total = res.data?.total ?? 0;
        const merged = reset ? decorated : (this.data.logEntries || []).concat(decorated);
        const newOffset = merged.length;
        const hasMore = newOffset < total;
        this.setData({
          logEntries: merged,
          loading: false,
          loadingMore: false,
          offset: newOffset,
          hasMore
        });
      },
      fail: () => {
        this.setData({ loading: false, loadingMore: false });
        wx.showToast({ title: '日志加载失败', icon: 'none' });
      }
    });
  }
});
