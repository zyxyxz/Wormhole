function ensureDiaryMode(currentPageRoute) {
  const review = !!wx.getStorageSync('reviewMode');
  if (review && currentPageRoute !== 'pages/notes/notes') {
    wx.showToast({ title: '当前为日记模式', icon: 'none', duration: 1500 });
    wx.reLaunch({ url: '/pages/notes/notes' });
    try { wx.hideTabBar({ animation: false }); } catch (e) {}
    return true;
  }
  return false;
}

module.exports = {
  ensureDiaryMode
};
