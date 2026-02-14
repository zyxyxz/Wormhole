const { BASE_URL } = require('../../utils/config.js');

function normalizeDateString(str) {
  if (!str) return '';
  let normalized = str.replace(' ', 'T');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized += 'Z';
  }
  return normalized;
}

function maskOpenId(id) {
  if (!id) return '';
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

Page({
  data: {
    items: [],
    loading: true,
    refreshing: false,
    loadingMore: false,
    hasMore: true,
    spaceId: '',
    myUserId: ''
  },

  goBack() { wx.navigateBack(); },

  onLoad() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    const myUserId = wx.getStorageSync('openid') || '';
    this.setData({ spaceId, myUserId });
    this.fetchActivity({ refresh: true });
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true });
    this.fetchActivity({ refresh: true, stopPullDown: true });
  },

  onReachBottom() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    this.fetchActivity({ append: true });
  },

  openNotes() {
    try {
      wx.switchTab({ url: '/pages/notes/notes' });
    } catch (e) {
      wx.navigateTo({ url: '/pages/notes/notes' });
    }
  },

  fetchActivity({ refresh = false, append = false, stopPullDown = false } = {}) {
    if (!this.data.spaceId || !this.data.myUserId) {
      this.setData({ loading: false, refreshing: false });
      return;
    }
    if (this.data.loadingMore) return;
    const limit = 20;
    let before = null;
    if (append && this.data.items.length) {
      const last = this.data.items[this.data.items.length - 1];
      before = last && last.created_at_ts ? last.created_at_ts : null;
    }
    if (append) {
      this.setData({ loadingMore: true });
    } else if (refresh) {
      this.setData({ loading: this.data.items.length === 0 });
    }
    const params = {
      space_id: this.data.spaceId,
      user_id: this.data.myUserId,
      limit
    };
    if (before) {
      params.before_ts = before;
    }
    wx.request({
      url: `${BASE_URL}/api/feed/activity`,
      data: params,
      success: (res) => {
        const list = Array.isArray(res.data?.items) ? res.data.items : [];
        const decorated = list.map(item => this.decorateItem(item));
        const nextItems = append ? [...this.data.items, ...decorated] : decorated;
        this.setData({
          items: nextItems,
          hasMore: list.length >= limit
        });
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        if (this.data.loading) {
          this.setData({ loading: false });
        }
        if (stopPullDown) {
          this.setData({ refreshing: false });
          try { wx.stopPullDownRefresh(); } catch (e) {}
        }
        this.setData({ loadingMore: false });
      }
    });
  },

  decorateItem(item) {
    const alias = (item.alias || '').trim();
    const displayName = alias || maskOpenId(item.user_id) || '匿名';
    const initial = (alias || item.user_id || '匿').charAt(0);
    const actionText = item.type === 'comment' ? '评论了你的动态' : '赞了你的动态';
    const commentPreview = item.type === 'comment' ? (item.comment_content || '') : '';
    const postSnippet = this.buildPostSnippet(item.post_content || '', item.post_media_type, item.post_media_urls);
    let previewImage = '';
    let previewVideo = false;
    if (item.post_media_type === 'image' && Array.isArray(item.post_media_urls)) {
      previewImage = item.post_media_urls[0] || '';
    } else if (item.post_media_type === 'video') {
      previewVideo = true;
    } else if (item.post_media_type === 'live' && Array.isArray(item.post_media_urls) && item.post_media_urls.length) {
      const firstLive = item.post_media_urls[0] || {};
      previewImage = firstLive.cover_url || '';
      previewVideo = true;
    }
    return {
      ...item,
      displayName,
      initial,
      actionText,
      commentPreview,
      postSnippet,
      previewImage,
      previewVideo,
      previewTag: item.post_media_type === 'live' ? 'Live' : '视频',
      avatar: item.avatar_url || '',
      displayTime: this.formatFriendlyTime(item.created_at, item.created_at_ts)
    };
  },

  buildPostSnippet(content, mediaType, mediaUrls) {
    const trimmed = (content || '').replace(/\s+/g, ' ').trim();
    if (trimmed) {
      return trimmed.length > 46 ? `${trimmed.slice(0, 46)}...` : trimmed;
    }
    if (mediaType === 'image' && Array.isArray(mediaUrls) && mediaUrls.length) {
      return '[图片]';
    }
    if (mediaType === 'video') {
      return '[视频]';
    }
    if (mediaType === 'live') {
      return '[Live]';
    }
    return '未填写内容';
  },

  formatFriendlyTime(isoString, ts) {
    let date = null;
    if (Number.isFinite(ts)) {
      const ms = ts < 1e12 ? ts * 1000 : ts;
      date = new Date(ms);
    } else {
      date = new Date(normalizeDateString(isoString));
    }
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.round((startOfToday - startOfTarget) / (24 * 60 * 60 * 1000));
    const timeText = `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    if (diffDays === 0) {
      return `今天 ${timeText}`;
    }
    if (diffDays === 1) {
      return `昨天 ${timeText}`;
    }
    return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')} ${timeText}`;
  }
});
