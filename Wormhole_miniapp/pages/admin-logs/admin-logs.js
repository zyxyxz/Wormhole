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

const ACTION_LABELS = {
  page_view: '浏览页面',
  login: '登录',
  chat_send: '发送消息',
  chat_delete: '撤回消息',
  feed_post: '发布动态',
  feed_comment: '评论动态',
  feed_like: '点赞动态',
  note_create: '创建笔记',
  note_update: '更新笔记',
  note_delete: '删除笔记',
  alias_update: '修改别名',
  space_modify_code: '修改空间号',
  space_share: '生成分享口令',
  space_delete: '删除空间',
  space_remove_member: '移除成员',
  space_block_member: '拉黑成员',
  space_unblock_member: '取消拉黑'
};

const ACTION_LEVELS = {
  page_view: 'view',
  login: 'minor',
  chat_send: 'normal',
  chat_delete: 'danger',
  feed_post: 'major',
  feed_comment: 'normal',
  feed_like: 'normal',
  note_create: 'major',
  note_update: 'normal',
  note_delete: 'danger',
  alias_update: 'normal',
  space_modify_code: 'major',
  space_share: 'major',
  space_delete: 'danger',
  space_remove_member: 'danger',
  space_block_member: 'danger',
  space_unblock_member: 'minor'
};

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
    filterLabel: '最近 100 条日志 · 北京时间',
    spaceOptions: ['全部房间'],
    spaceOptionValues: [''],
    spaceOptionIndex: 0,
    spaceIdFilter: null
  },

  onLoad(options = {}) {
    const targetType = options.type || '';
    const decode = (val) => {
      if (!val) return '';
      try { return decodeURIComponent(val); } catch (e) { return val; }
    };
    this.setData({
      adminOpenId: options.user_id || '',
      adminRoomCode: options.room_code || '',
      targetType,
      space: {
        space_id: options.space_id || '',
        code: decode(options.space_code || ''),
        owner: decode(options.owner || '')
      },
      user: {
        user_id: options.target_user_id || '',
        alias: decode(options.alias || '')
      }
    });
    if (targetType === 'user') {
      this.loadSpaceOptions();
    }
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

  onSpaceOptionChange(e) {
    const idx = Number(e.detail.value || 0);
    const safeIndex = Number.isNaN(idx) ? 0 : idx;
    this.setData({ spaceOptionIndex: safeIndex }, () => this.updateFilterLabel());
  },

  applyFilter() {
    const { startDate, endDate } = this.data;
    if (startDate && endDate && startDate > endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    const spaceId = this.getSelectedSpaceId();
    this.setData({ spaceIdFilter: spaceId }, () => this.fetchLogs({ reset: true }));
  },

  resetFilter() {
    this.setData({ startDate: '', endDate: '', spaceOptionIndex: 0, spaceIdFilter: null }, () => {
      this.updateFilterLabel();
      this.fetchLogs({ reset: true });
    });
  },

  updateFilterLabel() {
    const { startDate, endDate, limit, targetType, spaceOptions, spaceOptionIndex } = this.data;
    const codeLabel = targetType === 'user' && spaceOptionIndex > 0 ? (spaceOptions[spaceOptionIndex] || '') : '';
    const spaceLabel = codeLabel ? ` · 房间号 ${codeLabel}` : '';
    if (!startDate && !endDate) {
      this.setData({ filterLabel: `最近 ${limit} 条日志${spaceLabel} · 北京时间` });
      return;
    }
    const left = startDate || '开始';
    const right = endDate || '结束';
    this.setData({ filterLabel: `${left} 至 ${right}${spaceLabel} · 北京时间` });
  },

  getSelectedSpaceId() {
    const { spaceOptionIndex, spaceOptionValues } = this.data;
    if (!spaceOptionIndex || !spaceOptionValues) return null;
    const value = spaceOptionValues[spaceOptionIndex];
    if (!value) return null;
    return Number(value) || null;
  },

  loadSpaceOptions() {
    const { adminOpenId, adminRoomCode } = this.data;
    if (!adminOpenId || !adminRoomCode) return;
    if (this._spaceOptionsLoaded) return;
    this._spaceOptionsLoaded = true;
    wx.request({
      url: `${BASE_URL}/api/settings/admin/spaces`,
      data: { user_id: adminOpenId, room_code: adminRoomCode },
      success: (res) => {
        const list = Array.isArray(res.data?.spaces) ? res.data.spaces : [];
        const map = {};
        list.forEach((s) => {
          const code = String(s.code || '').trim();
          const spaceId = s.space_id || s.id;
          if (code && spaceId) {
            map[code] = spaceId;
          }
        });
        const codes = Object.keys(map).sort();
        const options = ['全部房间', ...codes];
        const values = [''].concat(codes.map(code => map[code]));
        this.setData({ spaceOptions: options, spaceOptionValues: values }, () => this.updateFilterLabel());
      }
    });
  },

  fetchLogs({ reset }) {
    const { adminOpenId, adminRoomCode, targetType, space, user, limit, startDate, endDate, spaceIdFilter } = this.data;
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
    if (targetType === 'user' && spaceIdFilter) {
      params.space_id = spaceIdFilter;
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
          created_at_bj: formatBeijingTime(item.created_at),
          action_label: ACTION_LABELS[item.action] || item.action || '操作',
          action_level: ACTION_LEVELS[item.action] || 'normal',
          is_page_view: item.action === 'page_view'
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
