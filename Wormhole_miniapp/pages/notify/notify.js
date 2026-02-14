const { BASE_URL } = require('../../utils/config.js');
const { ensureDiaryMode } = require('../../utils/review.js');

const PROVIDER_OPTIONS = [
  { label: '飞书机器人', value: 'feishu', placeholder: '请输入飞书机器人 Webhook URL' },
  { label: 'PushBear', value: 'pushbear', placeholder: '请输入 PushBear SendKey 或完整推送 URL' },
  { label: '通用 Webhook', value: 'webhook', placeholder: '请输入自定义 Webhook URL' }
];

const DISGUISE_OPTIONS = [
  { label: '价格波动监控', value: 'market' },
  { label: '系统巡检提醒', value: 'ops' },
  { label: '安全策略告警', value: 'security' },
  { label: '自定义内容', value: 'custom' }
];

const COOLDOWN_OPTIONS = [1, 3, 5, 10, 30, 60];

Page({
  data: {
    spaceId: '',
    channels: [],
    loading: false,
    showEditor: false,
    editingId: null,
    providerOptions: PROVIDER_OPTIONS.map(item => item.label),
    providerValues: PROVIDER_OPTIONS.map(item => item.value),
    providerIndex: 0,
    disguiseOptions: DISGUISE_OPTIONS.map(item => item.label),
    disguiseValues: DISGUISE_OPTIONS.map(item => item.value),
    disguiseIndex: 0,
    cooldownOptions: COOLDOWN_OPTIONS.map(item => `${item}分钟`),
    cooldownValues: COOLDOWN_OPTIONS,
    cooldownIndex: 3,
    targetPlaceholder: PROVIDER_OPTIONS[0].placeholder,
    form: {
      target: '',
      remark: '',
      enabled: true,
      notify_chat: true,
      notify_feed: true,
      skip_when_online: true,
      custom_title: '',
      custom_body: ''
    }
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onLoad() {
    if (ensureDiaryMode('pages/notify/notify')) return;
    const spaceId = wx.getStorageSync('currentSpaceId') || '';
    this.setData({ spaceId });
    this.fetchChannels();
  },

  onShow() {
    this.fetchChannels();
  },

  fetchChannels() {
    if (!this.data.spaceId || this.data.loading) return;
    this.setData({ loading: true });
    wx.request({
      url: `${BASE_URL}/api/notify/channels`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        if (res.statusCode >= 400) {
          wx.showToast({ title: res.data?.detail || '加载失败', icon: 'none' });
          return;
        }
        const list = Array.isArray(res.data?.channels) ? res.data.channels : [];
        const channels = list.map(item => this.decorateChannel(item));
        this.setData({ channels });
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
  },

  decorateChannel(channel) {
    const provider = (channel.provider || '').toLowerCase();
    const providerObj = PROVIDER_OPTIONS.find(item => item.value === provider);
    const disguise = (channel.disguise_type || '').toLowerCase();
    const disguiseObj = DISGUISE_OPTIONS.find(item => item.value === disguise);
    const cooldown = Math.max(0, Number(channel.cooldown_seconds || 0));
    const cooldownText = cooldown ? `${Math.round(cooldown / 60)}分钟内最多提醒1次` : '不限制提醒频率';
    return {
      ...channel,
      provider_label: providerObj ? providerObj.label : provider || '未知渠道',
      disguise_label: disguiseObj ? disguiseObj.label : '价格波动监控',
      cooldown_text: cooldownText,
      event_text: [
        channel.notify_chat ? '新消息' : '',
        channel.notify_feed ? '新动态' : ''
      ].filter(Boolean).join(' / ') || '未开启事件'
    };
  },

  resetForm() {
    this.setData({
      editingId: null,
      providerIndex: 0,
      disguiseIndex: 0,
      cooldownIndex: 3,
      targetPlaceholder: PROVIDER_OPTIONS[0].placeholder,
      form: {
        target: '',
        remark: '',
        enabled: true,
        notify_chat: true,
        notify_feed: true,
        skip_when_online: true,
        custom_title: '',
        custom_body: ''
      }
    });
  },

  openAddEditor() {
    this.resetForm();
    this.setData({ showEditor: true });
  },

  openEditEditor(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    const channel = (this.data.channels || []).find(item => Number(item.id) === id);
    if (!channel) return;
    const providerIndex = Math.max(0, this.data.providerValues.indexOf(channel.provider));
    const disguiseIndex = Math.max(0, this.data.disguiseValues.indexOf(channel.disguise_type));
    const cooldownMinutes = Math.max(1, Math.round(Number(channel.cooldown_seconds || 600) / 60));
    let cooldownIndex = this.data.cooldownValues.indexOf(cooldownMinutes);
    if (cooldownIndex < 0) {
      cooldownIndex = this.data.cooldownValues.indexOf(10);
    }
    this.setData({
      showEditor: true,
      editingId: id,
      providerIndex: providerIndex < 0 ? 0 : providerIndex,
      disguiseIndex: disguiseIndex < 0 ? 0 : disguiseIndex,
      cooldownIndex: cooldownIndex < 0 ? 3 : cooldownIndex,
      targetPlaceholder: PROVIDER_OPTIONS[(providerIndex < 0 ? 0 : providerIndex)].placeholder,
      form: {
        target: channel.target || '',
        remark: channel.remark || '',
        enabled: !!channel.enabled,
        notify_chat: !!channel.notify_chat,
        notify_feed: !!channel.notify_feed,
        skip_when_online: !!channel.skip_when_online,
        custom_title: channel.custom_title || '',
        custom_body: channel.custom_body || ''
      }
    });
  },

  closeEditor() {
    this.setData({ showEditor: false });
  },

  onProviderChange(e) {
    const providerIndex = Number(e.detail.value || 0);
    this.setData({
      providerIndex,
      targetPlaceholder: PROVIDER_OPTIONS[providerIndex] ? PROVIDER_OPTIONS[providerIndex].placeholder : PROVIDER_OPTIONS[0].placeholder
    });
  },

  onDisguiseChange(e) {
    this.setData({ disguiseIndex: Number(e.detail.value || 0) });
  },

  onCooldownChange(e) {
    this.setData({ cooldownIndex: Number(e.detail.value || 0) });
  },

  onTargetInput(e) {
    this.setData({ 'form.target': e.detail.value || '' });
  },

  onRemarkInput(e) {
    this.setData({ 'form.remark': e.detail.value || '' });
  },

  onCustomTitleInput(e) {
    this.setData({ 'form.custom_title': e.detail.value || '' });
  },

  onCustomBodyInput(e) {
    this.setData({ 'form.custom_body': e.detail.value || '' });
  },

  onEnabledChange(e) {
    this.setData({ 'form.enabled': !!e.detail.value });
  },

  onNotifyChatChange(e) {
    this.setData({ 'form.notify_chat': !!e.detail.value });
  },

  onNotifyFeedChange(e) {
    this.setData({ 'form.notify_feed': !!e.detail.value });
  },

  onSkipOnlineChange(e) {
    this.setData({ 'form.skip_when_online': !!e.detail.value });
  },

  submitEditor() {
    const provider = this.data.providerValues[this.data.providerIndex] || 'feishu';
    const disguiseType = this.data.disguiseValues[this.data.disguiseIndex] || 'market';
    const cooldownMinutes = this.data.cooldownValues[this.data.cooldownIndex] || 10;
    const target = (this.data.form.target || '').trim();
    if (!target) {
      wx.showToast({ title: '请填写通知地址', icon: 'none' });
      return;
    }
    if (!this.data.form.notify_chat && !this.data.form.notify_feed) {
      wx.showToast({ title: '至少开启一种提醒事件', icon: 'none' });
      return;
    }
    if (disguiseType === 'custom' && !(this.data.form.custom_title || '').trim()) {
      wx.showToast({ title: '请填写自定义标题', icon: 'none' });
      return;
    }
    const payload = {
      provider,
      target,
      remark: (this.data.form.remark || '').trim(),
      enabled: !!this.data.form.enabled,
      notify_chat: !!this.data.form.notify_chat,
      notify_feed: !!this.data.form.notify_feed,
      cooldown_seconds: Number(cooldownMinutes) * 60,
      disguise_type: disguiseType,
      custom_title: (this.data.form.custom_title || '').trim(),
      custom_body: (this.data.form.custom_body || '').trim(),
      skip_when_online: !!this.data.form.skip_when_online
    };
    const id = this.data.editingId;
    const method = id ? 'PUT' : 'POST';
    const url = id
      ? `${BASE_URL}/api/notify/channels/${id}`
      : `${BASE_URL}/api/notify/channels`;
    const data = id
      ? payload
      : { ...payload, space_id: Number(this.data.spaceId) };
    wx.request({
      url,
      method,
      data,
      success: (res) => {
        if (res.statusCode >= 400) {
          wx.showToast({ title: res.data?.detail || '保存失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: id ? '已更新' : '已添加', icon: 'none' });
        this.setData({ showEditor: false });
        this.fetchChannels();
      },
      fail: (err) => {
        const msg = err?.data?.detail || '保存失败';
        wx.showToast({ title: msg, icon: 'none' });
      }
    });
  },

  testChannel(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.showLoading({ title: '发送中', mask: true });
    wx.request({
      url: `${BASE_URL}/api/notify/channels/${id}/test`,
      method: 'POST',
      success: (res) => {
        if (res.statusCode >= 400) {
          wx.showToast({ title: res.data?.detail || '测试发送失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: '测试发送成功', icon: 'none' });
      },
      fail: (err) => {
        const msg = err?.data?.detail || '测试发送失败';
        wx.showToast({ title: msg, icon: 'none' });
      },
      complete: () => wx.hideLoading()
    });
  },

  removeChannel(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.showModal({
      title: '删除通知渠道',
      content: '删除后将不再推送此渠道的通知，确认删除？',
      success: (res) => {
        if (!res.confirm) return;
        wx.request({
          url: `${BASE_URL}/api/notify/channels/${id}`,
          method: 'DELETE',
          success: (resp) => {
            if (resp.statusCode >= 400) {
              wx.showToast({ title: resp.data?.detail || '删除失败', icon: 'none' });
              return;
            }
            wx.showToast({ title: '已删除', icon: 'none' });
            this.fetchChannels();
          },
          fail: () => {
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        });
      }
    });
  },

  toggleChannelEnabled(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    const channel = (this.data.channels || []).find(item => Number(item.id) === id);
    if (!channel) return;
    const payload = {
      provider: channel.provider,
      target: channel.target,
      remark: channel.remark || '',
      enabled: !channel.enabled,
      notify_chat: !!channel.notify_chat,
      notify_feed: !!channel.notify_feed,
      cooldown_seconds: Number(channel.cooldown_seconds || 600),
      disguise_type: channel.disguise_type || 'market',
      custom_title: channel.custom_title || '',
      custom_body: channel.custom_body || '',
      skip_when_online: !!channel.skip_when_online
    };
    wx.request({
      url: `${BASE_URL}/api/notify/channels/${id}`,
      method: 'PUT',
      data: payload,
      success: (res) => {
        if (res.statusCode >= 400) {
          wx.showToast({ title: res.data?.detail || '更新失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: payload.enabled ? '已启用' : '已停用', icon: 'none' });
        this.fetchChannels();
      },
      fail: () => {
        wx.showToast({ title: '更新失败', icon: 'none' });
      }
    });
  }
});
