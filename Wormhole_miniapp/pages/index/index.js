// index.js
const { BASE_URL } = require('../../utils/config.js');
Page({
  data: {
    spaceCode: ['','','','','',''],  // 6位空间号
  },

  onKeyTap(e) {
    const key = e.currentTarget.dataset.key;
    let spaceCode = [...this.data.spaceCode];
    
    // 找到第一个空位的索引
    const emptyIndex = spaceCode.findIndex(digit => digit === '');
    
    if (key === '删除') {
      // 删除最后一个非空的数字
      const lastFilledIndex = spaceCode.map(digit => digit !== '').lastIndexOf(true);
      if (lastFilledIndex !== -1) {
        spaceCode[lastFilledIndex] = '';
      }
    } else if (key !== '' && emptyIndex !== -1) {
      // 输入数字
      spaceCode[emptyIndex] = key;
    }
    
    this.setData({ spaceCode }, () => {
      // 自动进入：当6位均已填充
      if (this.data.spaceCode.every(d => d !== '')) {
        this.onConfirm();
      }
    });
  },

  onConfirm() {
    const code = this.data.spaceCode.join('');
    if (code.length === 6) {
      // 调用后端API验证空间号
      wx.request({
        url: `${BASE_URL}/api/space/enter`,
        method: 'POST',
        data: { space_code: code, user_id: wx.getStorageSync('openid') || '' },
        success: (res) => {
          if (res.data && res.data.success) {
            // 保存空间ID
            wx.setStorageSync('currentSpaceId', res.data.space_id);
            wx.setStorageSync('currentSpaceCode', code);
            wx.switchTab({
              url: '/pages/chat/chat'
            });
          } else {
            wx.showToast({ title: res.data?.message || '进入失败', icon: 'none' });
          }
        },
        fail: () => {
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      });
    }
  }
  ,
  goJoinByShare() {
    wx.navigateTo({ url: '/pages/join/join' });
  }
});
