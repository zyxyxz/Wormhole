// index.js
const { BASE_URL } = require('../../utils/config.js');

const emptySpaceCode = () => ['', '', '', '', '', ''];

Page({
  data: {
    spaceCode: emptySpaceCode(),  // 6位空间号
  },

  onShow() {
    this.resetSpaceCode();
  },

  resetSpaceCode(force = false) {
    const hasDigits = (this.data.spaceCode || []).some(d => d !== '');
    if (!force && !hasDigits) return;
    this.setData({ spaceCode: emptySpaceCode() });
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
    if (code.length !== 6) return;
    this.enterSpaceRequest(code);
  },

  enterSpaceRequest(code, { createIfMissing = false } = {}) {
    const openid = wx.getStorageSync('openid') || '';
    wx.request({
      url: `${BASE_URL}/api/space/enter`,
      method: 'POST',
      data: { space_code: code, user_id: openid || '', create_if_missing: createIfMissing },
      success: (res) => {
        const data = res.data || {};
        if (data.admin_entry) {
          this.resetSpaceCode(true);
          wx.navigateTo({ url: `/pages/admin/admin?room_code=${code}` });
          return;
        }
        if (data.requires_creation) {
          wx.showModal({
            title: '创建空间',
            content: '该空间号尚未创建，是否立即创建？',
            success: (modalRes) => {
              if (modalRes.confirm) {
                this.enterSpaceRequest(code, { createIfMissing: true });
              } else {
                this.resetSpaceCode(true);
              }
            }
          });
          return;
        }
        if (data.success) {
          wx.setStorageSync('currentSpaceId', data.space_id);
          wx.setStorageSync('currentSpaceCode', code);
          wx.switchTab({ url: '/pages/chat/chat' });
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
