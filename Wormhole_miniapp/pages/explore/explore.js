const { ensureDiaryMode } = require('../../utils/review.js');

Page({
  data: {
    spaceId: '',
    spaceCode: ''
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onLoad() {
    if (ensureDiaryMode('pages/explore/explore')) return;
    this.syncSpaceContext();
  },

  onShow() {
    if (ensureDiaryMode('pages/explore/explore')) return;
    this.syncSpaceContext();
  },

  syncSpaceContext() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    if (!spaceId) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    const spaceCode = wx.getStorageSync('currentSpaceCode') || '';
    this.setData({ spaceId, spaceCode });
  },

  openNotebook() {
    wx.navigateTo({ url: '/pages/notebook/notebook' });
  },

  openWallet() {
    wx.navigateTo({ url: '/pages/wallet/wallet' });
  },

  openActivity() {
    wx.navigateTo({ url: '/pages/notes-activity/notes-activity' });
  },

  openEmojiDiary() {
    wx.navigateTo({ url: '/pages/emoji-diary/emoji-diary' });
  }
});
