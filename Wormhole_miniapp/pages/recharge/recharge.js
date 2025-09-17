const { BASE_URL } = require('../../utils/config.js');

Page({
  data: {
    amount: '',
    spaceId: ''
  },
  onBack() {
    wx.navigateBack();
  },

  onLoad() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    this.setData({ spaceId });
  },

  onAmountInput(e) {
    this.setData({ amount: e.detail.value });
  },

  submit() {
    const amt = parseFloat(this.data.amount);
    if (!amt || amt <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }
    const userId = wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/wallet/recharge`,
      method: 'POST',
      data: { space_id: this.data.spaceId, amount: amt, user_id: userId },
      success: () => {
        wx.showToast({ title: '充值成功' });
        setTimeout(() => wx.navigateBack(), 300);
      }
    });
  }
});
