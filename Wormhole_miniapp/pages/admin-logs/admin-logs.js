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
    spaceCodeFilter: '',
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

  onSpaceCodeInput(e) {
    const value = (e.detail.value || '').trim();
    this.setData({ spaceCodeFilter: value }, () => this.updateFilterLabel());
  },

  applyFilter() {
    const { startDate, endDate } = this.data;
    if (startDate && endDate && startDate > endDate) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.resolveSpaceFilter()
      .then((spaceId) => {
        this.setData({ spaceIdFilter: spaceId }, () => this.fetchLogs({ reset: true }));
      })
      .catch(() => {});
  },

  resetFilter() {
    this.setData({ startDate: '', endDate: '', spaceCodeFilter: '', spaceIdFilter: null }, () => {
      this.updateFilterLabel();
      this.fetchLogs({ reset: true });
    });
  },

  updateFilterLabel() {
    const { startDate, endDate, limit, targetType, spaceCodeFilter } = this.data;
    const spaceLabel = targetType === 'user' && spaceCodeFilter ? ` · 房间号 ${spaceCodeFilter}` : '';
    if (!startDate && !endDate) {
      this.setData({ filterLabel: `最近 ${limit} 条日志${spaceLabel} · 北京时间` });
      return;
    }
    const left = startDate || '开始';
    const right = endDate || '结束';
    this.setData({ filterLabel: `${left} 至 ${right}${spaceLabel} · 北京时间` });
  },

  resolveSpaceFilter() {
    const { targetType, spaceCodeFilter } = this.data;
    if (targetType !== 'user') {
      return Promise.resolve(null);
    }
    const code = (spaceCodeFilter || '').trim();
    if (!code) {
      return Promise.resolve(null);
    }
    return this.getSpaceIdByCode(code).then((spaceId) => {
      if (!spaceId) {
        wx.showToast({ title: '房间号不存在', icon: 'none' });
        throw new Error('space-not-found');
      }
      return spaceId;
    });
  },

  getSpaceIdByCode(code) {
    if (this._spaceCodeMap && this._spaceCodeMap[code]) {
      return Promise.resolve(this._spaceCodeMap[code]);
    }
    const { adminOpenId, adminRoomCode } = this.data;
    if (!adminOpenId || !adminRoomCode) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      wx.request({
        url: `${BASE_URL}/api/settings/admin/spaces`,
        data: { user_id: adminOpenId, room_code: adminRoomCode },
        success: (res) => {
          const list = Array.isArray(res.data?.spaces) ? res.data.spaces : [];
          this._spaceCodeMap = list.reduce((acc, s) => {
            const key = String(s.code || '');
            if (key) acc[key] = s.space_id || s.id;
            return acc;
          }, {});
          resolve(this._spaceCodeMap[code] || null);
        },
        fail: () => resolve(null)
      });
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
