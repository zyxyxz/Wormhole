// index.js
const { BASE_URL } = require('../../utils/config.js');

const emptySpaceCode = () => ['', '', '', '', '', ''];

Page({
  data: {
    spaceCode: emptySpaceCode(),
    reviewMode: false,
  },

  onShow() {
    this.resetSpaceCode();
    this.syncReviewMode();
  },

  syncReviewMode() {
    const review = !!wx.getStorageSync('reviewMode');
    this.setData({ reviewMode: review });
    try {
      review ? wx.hideTabBar({ animation: false }) : wx.showTabBar({ animation: false });
    } catch (e) {}
  },

  resetSpaceCode(force = false) {
    const hasDigits = (this.data.spaceCode || []).some(d => d !== '');
    if (!force && !hasDigits) return;
    this.setData({ spaceCode: emptySpaceCode() });
  },

  onKeyTap(e) {
    const key = e.currentTarget.dataset.key;
    let spaceCode = [...this.data.spaceCode];
    const emptyIndex = spaceCode.findIndex(digit => digit === '');

    if (key === '删除') {
      const lastFilledIndex = spaceCode.map(digit => digit !== '').lastIndexOf(true);
      if (lastFilledIndex !== -1) {
        spaceCode[lastFilledIndex] = '';
      }
    } else if (key !== '' && emptyIndex !== -1) {
      spaceCode[emptyIndex] = key;
    }

    this.setData({ spaceCode }, () => {
      if (this.data.spaceCode.every(d => d !== '')) {
        this.onConfirm();
      }
    });
  },

  onConfirm() {
    const code = this.data.spaceCode.join('');
    if (code.length !== 6) return;
    const openid = wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/space/enter`,
      method: 'POST',
      data: { space_code: code, user_id: openid, create_if_missing: true },
      success: (res) => {
        const data = res.data || {};
        if (data.admin_entry) {
          this.resetSpaceCode(true);
          wx.navigateTo({ url: `/pages/admin/admin?room_code=${code}` });
          return;
        }
        if (data.success) {
          wx.setStorageSync('currentSpaceId', data.space_id);
          wx.setStorageSync('currentSpaceCode', code);
          const review = !!wx.getStorageSync('reviewMode');
          if (review) {
            wx.reLaunch({ url: '/pages/notes/notes' });
            try { wx.hideTabBar({ animation: false }); } catch (e) {}
          } else {
            wx.switchTab({ url: '/pages/chat/chat' });
          }
        } else {
          wx.showToast({ title: data?.message || '进入失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  goJoinByShare() {
    wx.navigateTo({ url: '/pages/join/join' });
  }
});
