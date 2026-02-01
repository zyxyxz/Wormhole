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
    this.loadCachedWallet();
    this.getWalletInfo();
    this.getTransactions();
  },
  onShow() {
    // 返回本页时刷新余额与交易
    this.getWalletInfo();
    this.getTransactions();
  },

  getCacheKey() {
    return `wallet_cache_${this.data.spaceId || 'default'}`;
  },

  buildWalletSignature(balance, payCodeUrl, transactions) {
    try {
      return JSON.stringify({
        balance: Number(balance || 0),
        pay_code_url: payCodeUrl || '',
        transactions: (transactions || []).map(item => ({
          id: item.id,
          type: item.type || '',
          amount: item.amount || 0,
          alias: item.alias || '',
          created_at: item.created_at || ''
        }))
      });
    } catch (e) {
      return '';
    }
  },

  loadCachedWallet() {
    let cache = null;
    try {
      cache = wx.getStorageSync(this.getCacheKey());
    } catch (e) {}
    if (!cache) return false;
    this._walletSig = cache.signature || '';
    this.setData({
      balance: cache.balance || 0,
      payCodeUrl: cache.payCodeUrl || '',
      transactions: Array.isArray(cache.transactions) ? cache.transactions : []
    });
    return true;
  },

  saveCachedWallet(balance, payCodeUrl, transactions) {
    try {
      const signature = this.buildWalletSignature(balance, payCodeUrl, transactions);
      this._walletSig = signature;
      wx.setStorageSync(this.getCacheKey(), {
        balance: balance || 0,
        payCodeUrl: payCodeUrl || '',
        transactions: Array.isArray(transactions) ? transactions : [],
        signature,
        cached_at: Date.now()
      });
    } catch (e) {}
  },

  getWalletInfo() {
    wx.request({
      url: `${BASE_URL}/api/wallet/info`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        const nextBalance = res.data.balance;
        const nextPayCodeUrl = res.data.pay_code_url;
        const nextTransactions = this.data.transactions || [];
        const nextSig = this.buildWalletSignature(nextBalance, nextPayCodeUrl, nextTransactions);
        if (nextSig !== this._walletSig) {
          this.setData({ 
            balance: nextBalance,
            payCodeUrl: nextPayCodeUrl
          });
          this.saveCachedWallet(nextBalance, nextPayCodeUrl, nextTransactions);
        }
      },
      fail: () => { wx.showToast({ title: '加载失败', icon: 'none' }); }
    });
  },

  getTransactions() {
    wx.request({
      url: `${BASE_URL}/api/wallet/transactions`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        const nextTransactions = res.data.transactions || [];
        const nextSig = this.buildWalletSignature(this.data.balance, this.data.payCodeUrl, nextTransactions);
        if (nextSig !== this._walletSig) {
          this.setData({ transactions: nextTransactions });
          this.saveCachedWallet(this.data.balance, this.data.payCodeUrl, nextTransactions);
        }
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
