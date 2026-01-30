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
    myAlias: '',
    myAvatarUrl: '',
    isOwner: false,
    ownerUserId: '',
    reviewMode: false,
  },
  onBack() { wx.reLaunch({ url: '/pages/index/index' }); },
  goHome() { wx.reLaunch({ url: '/pages/index/index' }); },

  onLoad() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    const myUserId = wx.getStorageSync('openid') || '';
    const reviewMode = !!wx.getStorageSync('reviewMode');
    this.setData({ spaceId, myUserId, reviewMode });
    this.refreshMyProfileCache(spaceId);
    this.syncTabBar();
    this.fetchSpaceInfo();
  },

  onShow() {
    const app = getApp && getApp();
    if (this._previewHoldActive && app && typeof app.leaveForegroundHold === 'function') {
      this._previewHoldActive = false;
      setTimeout(() => app.leaveForegroundHold(), 200);
      this.setData({ reviewMode: !!wx.getStorageSync('reviewMode') });
      this.syncTabBar();
      return;
    }
    this.refreshMyProfileCache(this.data.spaceId);
    this.setData({ reviewMode: !!wx.getStorageSync('reviewMode') });
    this.syncTabBar();
    this.getPosts();
  },

  refreshMyProfileCache(spaceId) {
    const sid = spaceId || this.data.spaceId;
    if (!sid) return;
    let alias = '';
    let avatarUrl = '';
    try {
      alias = wx.getStorageSync(`myAlias_${sid}`) || '';
      avatarUrl = wx.getStorageSync(`myAvatar_${sid}`) || '';
    } catch (e) {}
    this.setData({ myAlias: alias, myAvatarUrl: avatarUrl });
  },

  onPullDownRefresh() {
    this.getPosts({ stopPullDown: true });
  },

  syncTabBar() {
    try {
      if (this.data.reviewMode) {
        wx.hideTabBar({ animation: false });
      } else {
        wx.showTabBar({ animation: false });
      }
    } catch (e) {}
  },

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

  getPosts({ stopPullDown = false } = {}) {
    this.setData({ loading: true });
    wx.request({
      url: `${BASE_URL}/api/feed/list`,
      data: { space_id: this.data.spaceId, user_id: this.data.myUserId },
      success: (res) => {
        const posts = (res.data.posts || []).map(item => this.decoratePost(item));
        this.setData({ posts });
        const myId = this.data.myUserId;
        if (myId) {
          const mine = posts.find(p => p.user_id === myId);
          if (mine) {
            const alias = mine.alias || '';
            const avatarUrl = mine.avatar || '';
            if (alias || avatarUrl) {
              try {
                if (alias) wx.setStorageSync(`myAlias_${this.data.spaceId}`, alias);
                if (avatarUrl) wx.setStorageSync(`myAvatar_${this.data.spaceId}`, avatarUrl);
              } catch (e) {}
              this.setData({ myAlias: alias || this.data.myAlias, myAvatarUrl: avatarUrl || this.data.myAvatarUrl });
            }
          }
        }
        const app = getApp && getApp();
        if (app && typeof app.markNotesRead === 'function') {
          app.markNotesRead(this.data.spaceId);
        }
      },
      fail: () => { wx.showToast({ title: '加载失败', icon: 'none' }); },
      complete: () => {
        this.setData({ loading: false });
        if (stopPullDown) {
          try { wx.stopPullDownRefresh(); } catch (e) {}
        }
      }
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
    if (this.data.reviewMode) return;
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
      success: (res) => {
        this.setData({
          [`commentInputs.${id}`]: '',
          [`commentPlaceholders.${id}`]: '',
          [`replyTargets.${id}`]: null,
          activeCommentInput: null
        });
        const comment = res.data || {};
        if (comment && comment.id) {
          const posts = [...this.data.posts];
          const targetIndex = posts.findIndex(p => p.id === id);
          if (targetIndex >= 0) {
            const post = { ...posts[targetIndex] };
            const comments = Array.isArray(post.comments) ? [...post.comments] : [];
            const decorated = {
              ...comment,
              postId: id,
              avatar: comment.avatar_url || '',
              initial: (comment.alias || comment.user_id || '匿').charAt(0),
              canDelete: this.data.isOwner || comment.user_id === this.data.myUserId,
              displayTime: this.formatFriendlyTime(comment.created_at)
            };
            comments.push(decorated);
            post.comments = comments;
            posts[targetIndex] = post;
            this.setData({ posts });
          }
        }
      }
    });
  },

  previewImage(e) {
    const { urls = [], current } = e.currentTarget.dataset;
    if (!urls.length) return;
    const app = getApp && getApp();
    if (app && typeof app.enterForegroundHold === 'function') {
      this._previewHoldActive = true;
      app.enterForegroundHold(60000);
    } else if (app && typeof app.markTemporaryForegroundAllowed === 'function') {
      this._previewHoldActive = true;
      app.markTemporaryForegroundAllowed();
    } else if (app && app.globalData) {
      this._previewHoldActive = true;
      app.globalData.skipNextHideRedirect = true;
    }
    wx.previewImage({
      current: current || urls[0],
      urls
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
            const posts = (this.data.posts || []).filter(p => p.id !== postId);
            this.setData({ posts });
          },
          fail: () => wx.showToast({ title: '删除失败', icon: 'none' })
        });
      }
    });
  }
  ,
  deleteComment(e) {
    if (this.data.reviewMode) return;
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
            const posts = [...this.data.posts];
            posts.forEach((post) => {
              if (Array.isArray(post.comments)) {
                post.comments = post.comments.filter(c => c.id !== commentId);
              }
            });
            this.setData({ posts });
          },
          fail: () => wx.showToast({ title: '删除失败', icon: 'none' })
        });
      }
    });
  }
  ,
  toggleLike(e) {
    if (this.data.reviewMode) return;
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
            const likes = Array.isArray(updated[index].likes) ? [...updated[index].likes] : [];
            const myUserId = this.data.myUserId;
            const existingIdx = likes.findIndex(l => l.user_id === myUserId);
            if (res.data.liked) {
              if (existingIdx === -1) {
                const alias = this.data.myAlias || wx.getStorageSync(`myAlias_${this.data.spaceId}`) || '';
                const avatarUrl = this.data.myAvatarUrl || wx.getStorageSync(`myAvatar_${this.data.spaceId}`) || '';
                likes.push({
                  user_id: myUserId,
                  alias,
                  avatar_url: avatarUrl,
                  avatar: avatarUrl,
                  initial: (alias || '我').charAt(0)
                });
              }
            } else if (existingIdx >= 0) {
              likes.splice(existingIdx, 1);
            }
            updated[index].likes = likes;
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
  },
  replyComment(e) {
    if (this.data.reviewMode) return;
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
