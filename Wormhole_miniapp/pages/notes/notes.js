const { BASE_URL } = require('../../utils/config.js');

Page({
  data: {
    posts: [],
    spaceId: '',
    commentInputs: {},
    loading: true,
  },
  onBack() { wx.reLaunch({ url: '/pages/index/index' }); },
  goHome() { wx.reLaunch({ url: '/pages/index/index' }); },

  onLoad() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    this.setData({ spaceId });
    this.getPosts();
  },

  onShow() { this.getPosts(); },

  getPosts() {
    this.setData({ loading: true });
    wx.request({
      url: `${BASE_URL}/api/feed/list`,
      data: { space_id: this.data.spaceId },
      success: (res) => { this.setData({ posts: res.data.posts || [] }); },
      fail: () => { wx.showToast({ title: '加载失败', icon: 'none' }); },
      complete: () => { this.setData({ loading: false }); }
    });
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
});
