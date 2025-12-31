const { BASE_URL } = require('../../utils/config.js');

Page({
  data: {
    posts: [],
    spaceId: '',
    commentInputs: {},
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
      avatar: comment.avatar_url || '',
      initial: (comment.alias || comment.user_id || '匿').charAt(0),
      canDelete: this.data.isOwner || comment.user_id === this.data.myUserId
    }));
    return {
      ...post,
      avatar: post.avatar_url || '',
      initial,
      canDelete,
      comments,
      likeCount: post.like_count || 0,
      likedByMe: !!post.liked_by_me
    };
  },

  createPost() { wx.navigateTo({ url: '/pages/post-create/post-create' }); },

  onCommentInput(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ [`commentInputs.${id}`]: e.detail.value });
  },

  submitComment(e) {
    const id = e.currentTarget.dataset.id;
    const content = this.data.commentInputs[id] || '';
    if (!content.trim()) return;
    const userId = wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/feed/comment`,
      method: 'POST',
      data: { post_id: id, user_id: userId, content },
      success: () => { this.setData({ [`commentInputs.${id}`]: '' }); this.getPosts(); }
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
  }
});
