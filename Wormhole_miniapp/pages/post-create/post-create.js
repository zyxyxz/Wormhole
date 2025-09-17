const { BASE_URL } = require('../../utils/config.js');

Page({
  data: {
    content: '',
    mediaType: 'none', // none|image|video
    mediaUrls: [],
    uploading: false,
  },

  onBack() { wx.navigateBack(); },
  onContentInput(e) { this.setData({ content: e.detail.value }); },

  chooseImage() {
    wx.chooseImage({ count: 9, success: (res) => { this.uploadFiles(res.tempFilePaths, 'image'); } });
  },

  chooseVideo() {
    wx.chooseVideo({ sourceType: ['album','camera'], maxDuration: 60, success: (res) => { this.uploadFiles([res.tempFilePath], 'video'); } });
  },

  uploadFiles(paths, type) {
    if (!paths || !paths.length) return;
    this.setData({ uploading: true });
    const uploads = paths.map(p => new Promise((resolve) => {
      wx.uploadFile({
        url: `${BASE_URL}/api/upload`,
        filePath: p,
        name: 'file',
        success: (resp) => {
          try {
            const data = JSON.parse(resp.data);
            const u = data.url || '';
            const full = u.startsWith('/') ? `${BASE_URL}${u}` : u;
            resolve(full);
          } catch (e) { resolve(null); }
        },
        fail: () => resolve(null)
      });
    }));
    Promise.all(uploads).then(urls => {
      const filtered = urls.filter(Boolean);
      if (filtered.length) {
        this.setData({ mediaType: type, mediaUrls: filtered });
      }
      this.setData({ uploading: false });
    });
  },

  submit() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    const userId = wx.getStorageSync('openid') || '';
    const { content, mediaType, mediaUrls } = this.data;
    if (!content.trim() && !mediaUrls.length) {
      wx.showToast({ title: '说点什么或选择媒体', icon: 'none' });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/feed/create`,
      method: 'POST',
      data: { space_id: spaceId, user_id: userId, content, media_type: mediaType, media_urls: mediaUrls },
      success: () => {
        wx.showToast({ title: '已发布' });
        setTimeout(() => wx.navigateBack(), 300);
      }
    })
  }
});
