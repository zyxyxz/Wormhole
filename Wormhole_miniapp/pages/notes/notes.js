const { BASE_URL } = require('../../utils/config.js');

function normalizeDateString(str) {
  if (!str) return '';
  let normalized = str.replace(' ', 'T');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized += 'Z';
  }
  return normalized;
}

Page({
  data: {
    posts: [],
    spaceId: '',
    commentInputs: {},
    commentPlaceholders: {},
    replyTargets: {},
    activeCommentInput: null,
    loading: true,
    myUserId: '',
    isOwner: false,
    ownerUserId: '',
  },
  onBack() { wx.reLaunch({ url: '/pages/index/index' }); },
  goHome() { wx.reLaunch({ url: '/pages/index/index' }); },

  onLoad() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    const myUserId = wx.getStorageSync('openid') || '';
    this.setData({ spaceId, myUserId });
    this.fetchSpaceInfo();
    this.getPosts();
  },

  onShow() { this.getPosts(); },

  fetchSpaceInfo() {
    if (!this.data.spaceId) return;
    wx.request({
      url: `${BASE_URL}/api/space/info`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        const info = res.data || {};
        const myUserId = this.data.myUserId;
        this.setData({
          ownerUserId: info.owner_user_id || '',
          isOwner: !!myUserId && info.owner_user_id === myUserId,
        });
      }
    });
  },

  getPosts() {
    this.setData({ loading: true });
    wx.request({
      url: `${BASE_URL}/api/feed/list`,
      data: { space_id: this.data.spaceId, user_id: this.data.myUserId },
      success: (res) => {
        const posts = (res.data.posts || []).map(item => this.decoratePost(item));
        this.setData({ posts });
      },
      fail: () => { wx.showToast({ title: '加载失败', icon: 'none' }); },
      complete: () => { this.setData({ loading: false }); }
    });
  },

  decoratePost(post) {
    const initial = (post.alias || post.user_id || '匿').charAt(0);
    const canDelete = this.data.isOwner || post.user_id === this.data.myUserId;
    const comments = (post.comments || []).map(comment => ({
      ...comment,
      postId: post.id,
      avatar: comment.avatar_url || '',
      initial: (comment.alias || comment.user_id || '匿').charAt(0),
      canDelete: this.data.isOwner || comment.user_id === this.data.myUserId,
      displayTime: this.formatFriendlyTime(comment.created_at)
    }));
    const likes = (post.likes || []).map(like => ({
      ...like,
      avatar: like.avatar_url || '',
      initial: (like.alias || like.user_id || '匿').charAt(0)
    }));
    return {
      ...post,
      avatar: post.avatar_url || '',
      initial,
      canDelete,
      comments,
      likes,
      likeCount: post.like_count || 0,
      likedByMe: !!post.liked_by_me,
      displayTime: this.formatFriendlyTime(post.created_at)
    };
  },

  createPost() { wx.navigateTo({ url: '/pages/post-create/post-create' }); },

  onCommentInput(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ [`commentInputs.${id}`]: e.detail.value });
  },

  onCommentFocus(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ activeCommentInput: id });
  },

  submitComment(e) {
    const id = e.currentTarget.dataset.id;
    const content = this.data.commentInputs[id] || '';
    if (!content.trim()) return;
    const userId = wx.getStorageSync('openid') || '';
    const reply = this.data.replyTargets[id];
    let payloadContent = content.trim();
    if (reply && reply.userId && reply.userId !== this.data.myUserId) {
      payloadContent = `回复 ${reply.alias || reply.userId}: ${payloadContent}`;
    }
    wx.request({
      url: `${BASE_URL}/api/feed/comment`,
      method: 'POST',
      data: { post_id: id, user_id: userId, content: payloadContent },
      success: () => {
        this.setData({
          [`commentInputs.${id}`]: '',
          [`commentPlaceholders.${id}`]: '',
          [`replyTargets.${id}`]: null,
          activeCommentInput: null
        });
        this.getPosts();
      }
    });
  },

  previewImage(e) {
    const { urls = [], current } = e.currentTarget.dataset;
    if (!urls.length) return;
    const app = getApp && getApp();
    if (app && typeof app.markTemporaryForegroundAllowed === 'function') {
      app.markTemporaryForegroundAllowed();
    } else if (app && app.globalData) {
      app.globalData.skipNextHideRedirect = true;
    }
    wx.previewImage({
      current: current || urls[0],
      urls,
      complete: () => {
        if (app && typeof app.clearTemporaryForegroundFlag === 'function') {
          app.clearTemporaryForegroundFlag();
        } else if (app && app.globalData) {
          app.globalData.skipNextHideRedirect = false;
        }
      }
    });
  },

  deletePost(e) {
    const postId = e.currentTarget.dataset.id;
    const operator = this.data.myUserId;
    if (!operator) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除动态',
      content: '删除后不可恢复，确认删除该动态？',
      confirmColor: '#0F766E',
      success: (res) => {
        if (!res.confirm) return;
        wx.request({
          url: `${BASE_URL}/api/feed/delete`,
          method: 'POST',
          data: { post_id: postId, operator_user_id: operator },
          success: () => {
            wx.showToast({ title: '已删除', icon: 'none' });
            this.getPosts();
          },
          fail: () => wx.showToast({ title: '删除失败', icon: 'none' })
        });
      }
    });
  }
  ,
  deleteComment(e) {
    const commentId = e.currentTarget.dataset.id;
    const operator = this.data.myUserId;
    if (!operator) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除评论',
      content: '确定删除这条评论吗？',
      confirmColor: '#0F766E',
      success: (res) => {
        if (!res.confirm) return;
        wx.request({
          url: `${BASE_URL}/api/feed/comment/delete`,
          method: 'POST',
          data: { comment_id: commentId, operator_user_id: operator },
          success: () => {
            wx.showToast({ title: '已删除', icon: 'none' });
            this.getPosts();
          },
          fail: () => wx.showToast({ title: '删除失败', icon: 'none' })
        });
      }
    });
  }
  ,
  toggleLike(e) {
    const postId = e.currentTarget.dataset.id;
    const index = e.currentTarget.dataset.index;
    const posts = [...this.data.posts];
    const target = posts[index];
    if (!target || !this.data.myUserId) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    const prevState = target.likedByMe;
    const prevCount = target.likeCount;
    const nextState = !prevState;
    target.likedByMe = nextState;
    target.likeCount = Math.max(0, prevCount + (nextState ? 1 : -1));
    this.setData({ posts });
    wx.request({
      url: `${BASE_URL}/api/feed/like`,
      method: 'POST',
      data: { post_id: postId, user_id: this.data.myUserId, like: nextState },
      success: (res) => {
        if (res.data && typeof res.data.like_count === 'number') {
          const updated = [...this.data.posts];
          if (updated[index]) {
            updated[index].likeCount = res.data.like_count;
            updated[index].likedByMe = !!res.data.liked;
            this.setData({ posts: updated });
          }
        }
        this.getPosts();
      },
      fail: () => {
        const rollback = [...this.data.posts];
        if (rollback[index]) {
          rollback[index].likedByMe = prevState;
          rollback[index].likeCount = prevCount;
          this.setData({ posts: rollback });
        }
        wx.showToast({ title: '操作失败', icon: 'none' });
      }
    });
  },
  replyComment(e) {
    const postId = e.currentTarget.dataset.postid;
    const alias = e.currentTarget.dataset.alias;
    const userId = e.currentTarget.dataset.userid;
    if (!postId || !userId || userId === this.data.myUserId) return;
    this.setData({
      [`commentPlaceholders.${postId}`]: `回复 ${alias || '匿名'}...`,
      [`replyTargets.${postId}`]: { userId, alias },
      activeCommentInput: postId,
      [`commentInputs.${postId}`]: this.data.commentInputs[postId] || ''
    });
  },
  formatFriendlyTime(isoString) {
    if (!isoString) return '';
    const date = new Date(normalizeDateString(isoString));
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
