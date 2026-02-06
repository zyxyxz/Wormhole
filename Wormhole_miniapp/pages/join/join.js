const { BASE_URL } = require('../../utils/config.js');

Page({
  data: {
    shareCode: '',
    newCode: ''
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  onShareCodeInput(e) {
    this.setData({ shareCode: e.detail.value.toUpperCase() });
  },

  onNewCodeInput(e) {
    this.setData({ newCode: e.detail.value });
  },

  submit() {
    const { shareCode, newCode } = this.data;
    const userId = wx.getStorageSync('openid');
    if (!shareCode || shareCode.length < 6) {
      wx.showToast({ title: '请输入分享口令', icon: 'none' });
      return;
    }
    if (!/^[0-9]{6}$/.test(newCode)) {
      wx.showToast({ title: '请输入6位数字新空间号', icon: 'none' });
      return;
    }
    if (!userId) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/space/join-by-share`,
      method: 'POST',
      data: { share_code: shareCode, new_code: newCode, user_id: userId },
      success: (res) => {
        if (res.statusCode === 200 && res.data.success) {
          wx.setStorageSync('currentSpaceId', res.data.space_id);
          wx.setStorageSync('currentSpaceCode', newCode);
          wx.switchTab({ url: '/pages/chat/chat' });
        } else {
          const msg = res.data.detail || res.data.message || '加入失败';
          wx.showToast({ title: msg, icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  }
});
