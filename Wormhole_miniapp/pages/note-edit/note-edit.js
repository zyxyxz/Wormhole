const { BASE_URL } = require('../../utils/config.js');

Page({
  data: {
    id: null,
    title: '',
    content: '',
    spaceId: '',
    allowEdit: true,
  },
  onBack() {
    wx.navigateBack();
  },

  onLoad(query) {
    const spaceId = wx.getStorageSync('currentSpaceId');
    this.setData({ spaceId });
    if (query && query.id) {
      this.setData({ id: Number(query.id) });
      // 简化：从列表进入，通常已有数据。这里可选：重新拉取详情接口（未实现），先保留空白。
    }
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value });
  },

  onToggleEdit(e) {
    this.setData({ allowEdit: e.detail.value });
  },

  saveNote() {
    const { id, title, content, spaceId } = this.data;
    const userId = wx.getStorageSync('openid') || '';
    if (!title.trim()) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }
    if (!content.trim()) {
      wx.showToast({ title: '请输入内容', icon: 'none' });
      return;
    }
    if (id) {
      // 更新
      wx.request({
        url: `${BASE_URL}/api/notes/${id}`,
        method: 'PUT',
        data: { title, content, user_id: userId, editable_by_others: this.data.allowEdit },
        success: () => {
          wx.showToast({ title: '已保存' });
          setTimeout(() => wx.navigateBack(), 300);
        }
      });
    } else {
      // 新建
      wx.request({
        url: `${BASE_URL}/api/notes/create`,
        method: 'POST',
        data: { space_id: spaceId, user_id: userId, title, content, editable_by_others: this.data.allowEdit },
        success: () => {
          wx.showToast({ title: '已创建' });
          setTimeout(() => wx.navigateBack(), 300);
        }
      });
    }
  }
});
