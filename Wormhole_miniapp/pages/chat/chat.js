const { BASE_URL, WS_URL } = require('../../utils/config.js');

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes()
      .toString()
      .padStart(2, '0')}`;
  } catch (e) {
    return '';
  }
}

Page({
  data: {
    messages: [],
    inputMessage: '',
    lastMessageId: '',
    spaceId: ''
  },
  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onLoad() {
    // 获取空间ID
    const spaceId = wx.getStorageSync('currentSpaceId');
    const openid = wx.getStorageSync('openid');
    this.setData({ spaceId });
    
    // 初始化WebSocket连接
    this.initWebSocket();
    
    // 获取历史消息
    this.getHistoryMessages();
  },
  onBack() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  initWebSocket() {
    const ws = wx.connectSocket({
      url: `${WS_URL}/ws/chat/${this.data.spaceId}`,
      success: () => {
        console.log('WebSocket连接成功');
      }
    });

    ws.onMessage((res) => {
      let message = {};
      try {
        message = JSON.parse(res.data);
      } catch (e) {
        message = res.data;
      }
      // 适配前端显示字段
      const displayed = {
        id: message.id,
        content: message.content,
        time: formatTime(message.created_at),
        isSelf: message.user_id === wx.getStorageSync('openid'),
        avatar: '/assets/icons/chat.png',
        nickname: message.alias || message.user_id || '匿名',
      };
      this.addMessage(displayed);
    });

    this.ws = ws;
  },

  getHistoryMessages() {
    wx.request({
      url: `${BASE_URL}/api/chat/history`,
      data: { space_id: this.data.spaceId },
      success: (res) => {
        const myid = wx.getStorageSync('openid');
        const msgs = (res.data.messages || []).map(m => ({
          id: m.id,
          content: m.content,
          time: formatTime(m.created_at),
          isSelf: m.user_id === myid,
          avatar: '/assets/icons/chat.png',
          nickname: m.alias || m.user_id || '匿名',
        }));
        this.setData({ 
          messages: msgs,
          lastMessageId: msgs.length ? `msg-${msgs[msgs.length - 1].id}` : ''
        });
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    });
  },

  onInputChange(e) {
    this.setData({ inputMessage: e.detail.value });
  },

  sendMessage() {
    if (!this.data.inputMessage.trim()) return;

    const message = {
      content: this.data.inputMessage,
      user_id: wx.getStorageSync('openid') || '',
    };

    if (this.ws) {
      this.ws.send({
        data: JSON.stringify(message),
        success: () => {
          this.setData({ inputMessage: '' });
        },
        fail: () => {
          this.sendViaHttp(message);
        }
      });
    } else {
      this.sendViaHttp(message);
    }
  },

  sendViaHttp(message) {
    wx.request({
      url: `${BASE_URL}/api/chat/send`,
      method: 'POST',
      data: { ...message, space_id: this.data.spaceId },
      success: () => {
        this.setData({ inputMessage: '' });
        this.getHistoryMessages();
      }
    });
  },

  addMessage(message) {
    const messages = [...this.data.messages, message];
    this.setData({ 
      messages,
      lastMessageId: `msg-${message.id}`
    });
  },

  onUnload() {
    if (this.ws) {
      this.ws.close();
    }
  }
}); 
