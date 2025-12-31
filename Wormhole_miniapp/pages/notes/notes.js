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

  previewImage(e) {
    const { urls = [], current } = e.currentTarget.dataset;
    if (!urls.length) return;
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
            this.getPosts();
          },
          fail: () => wx.showToast({ title: '删除失败', icon: 'none' })
        });
      }
    });
  }
});
