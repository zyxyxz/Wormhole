// utils/subscribe.js — Task 33: proactive subscribe-message asks.
// We ask the user once per (eventKey, device) combination, persisted in
// wx storage. Empty templateId is a no-op so the feature degrades to
// silent when ops hasn't configured WeChat template IDs yet.
const STORAGE_KEY = 'subscribe_asked';

function _alreadyAsked(eventKey) {
  try {
    const map = wx.getStorageSync(STORAGE_KEY) || {};
    return !!map[eventKey];
  } catch (e) { return false; }
}

function _markAsked(eventKey) {
  try {
    const map = wx.getStorageSync(STORAGE_KEY) || {};
    map[eventKey] = Date.now();
    wx.setStorageSync(STORAGE_KEY, map);
  } catch (e) {}
}

function requestOnce(eventKey, templateId) {
  if (!templateId) return;
  if (_alreadyAsked(eventKey)) return;
  if (typeof wx.requestSubscribeMessage !== 'function') return;
  wx.requestSubscribeMessage({
    tmplIds: [templateId],
    complete: () => _markAsked(eventKey),
  });
}

module.exports = { requestOnce };
