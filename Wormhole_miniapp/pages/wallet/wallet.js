const { BASE_URL } = require('../../utils/config.js');
const { ensureDiaryMode } = require('../../utils/review.js');

Page({
  data: {
    balance: 0,
    transactions: [],
    showPayCode: false,
    payCodeUrl: '',
    spaceId: ''
  },
  onBack() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onLoad() {
    if (ensureDiaryMode('pages/wallet/wallet')) return;
    const spaceId = wx.getStorageSync('currentSpaceId');
    this.setData({ spaceId });
    this.getWalletInfo();
    this.getTransactions();
  },
  onShow() {
    // 返回本页时刷新余额与交易
    this.getWalletInfo();
    this.getTransactions();
  },

  getWalletInfo() {
    wx.request({
      url: `${BASE_URL}/api/wallet/info`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        this.setData({ 
          balance: res.data.balance,
          payCodeUrl: res.data.pay_code_url
        });
      },
      fail: () => { wx.showToast({ title: '加载失败', icon: 'none' }); }
    });
  },

  getTransactions() {
    wx.request({
      url: `${BASE_URL}/api/wallet/transactions`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        this.setData({ transactions: res.data.transactions || [] });
      },
      fail: () => { wx.showToast({ title: '加载失败', icon: 'none' }); }
    });
  },

  showRecharge() {
    wx.navigateTo({
      url: '/pages/recharge/recharge'
    });
  },

  openPayCode() {
    this.setData({ showPayCode: true });
  },

  hidePayCode() {
    this.setData({ showPayCode: false });
  }
}); 
