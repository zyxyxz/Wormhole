const { BASE_URL } = require('../../utils/config.js');

function setSystemPickerFlag(active) {
  if (typeof getApp !== 'function') return;
  const app = getApp();
  if (!app) return;
  const method = active ? 'markTemporaryForegroundAllowed' : 'clearTemporaryForegroundFlag';
  if (typeof app[method] === 'function') {
    app[method]();
  } else if (app.globalData) {
    app.globalData.skipNextHideRedirect = !!active;
  }
}

Page({
  data: {
    content: '',
    mediaType: 'none', // none|image|video|live
    mediaUrls: [],
    uploading: false,
  },

  onBack() { wx.navigateBack(); },
  onContentInput(e) { this.setData({ content: e.detail.value }); },

  chooseImage() {
    setSystemPickerFlag(true);
    wx.chooseImage({
      count: 9,
      success: (res) => { this.uploadFiles(res.tempFilePaths, 'image'); },
      complete: () => { setSystemPickerFlag(false); }
    });
  },

  chooseVideo() {
    setSystemPickerFlag(true);
    wx.chooseVideo({
      sourceType: ['album','camera'],
      maxDuration: 60,
      success: (res) => { this.uploadFiles([res.tempFilePath], 'video'); },
      complete: () => { setSystemPickerFlag(false); }
    });
  },

  chooseLive() {
    setSystemPickerFlag(true);
    wx.chooseMedia({
      count: 2,
      mediaType: ['image', 'video'],
      sourceType: ['album'],
      maxDuration: 10,
      success: (res) => {
        const files = Array.isArray(res.tempFiles) ? res.tempFiles : [];
        const imageFile = files.find(item => (item.fileType || item.type) === 'image');
        const videoFile = files.find(item => (item.fileType || item.type) === 'video');
        if (!videoFile) {
          wx.showToast({ title: '请选择包含实况视频的媒体', icon: 'none' });
          return;
        }
        const coverPath = (imageFile && imageFile.tempFilePath) || videoFile.thumbTempFilePath || '';
        const videoPath = videoFile.tempFilePath || '';
        if (!coverPath || !videoPath) {
          wx.showToast({ title: '实况文件不完整', icon: 'none' });
          return;
        }
        this.setData({ uploading: true });
        Promise.all([
          this.uploadSingleFile(coverPath, 'image'),
          this.uploadSingleFile(videoPath, 'video')
        ]).then(([coverUrl, videoUrl]) => {
          if (!coverUrl || !videoUrl) {
            wx.showToast({ title: '上传失败', icon: 'none' });
            return;
          }
          this.setData({
            mediaType: 'live',
            mediaUrls: [{ cover_url: coverUrl, video_url: videoUrl }]
          });
        }).finally(() => {
          this.setData({ uploading: false });
        });
      },
      complete: () => { setSystemPickerFlag(false); }
    });
  },

  uploadFiles(paths, type) {
    if (!paths || !paths.length) return;
    this.setData({ uploading: true });
    Promise.all(paths.map(p => this.uploadSingleFile(p, type))).then(urls => {
      const filtered = urls.filter(Boolean);
      if (filtered.length) {
        this.setData({ mediaType: type, mediaUrls: filtered });
      }
    }).finally(() => {
      this.setData({ uploading: false });
    });
  },

  uploadSingleFile(filePath, type) {
    const spaceId = wx.getStorageSync('currentSpaceId');
    const formData = {
      category: 'notes',
      media_type: type
    };
    if (spaceId) {
      formData.space_id = spaceId;
    }
    return new Promise((resolve) => {
      wx.uploadFile({
        url: `${BASE_URL}/api/upload`,
        filePath,
        name: 'file',
        formData,
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
