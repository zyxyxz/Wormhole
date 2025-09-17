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
  onShow() {
    // 若昵称更新，刷新历史以展示新昵称
    const updated = wx.getStorageSync('aliasUpdatedAt');
    if (updated) {
      this.getHistoryMessages();
    }
  },
  onBack() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  initWebSocket() {
    const url = `${WS_URL}/ws/chat/${this.data.spaceId}`;
    const ws = wx.connectSocket({ url });

    ws.onOpen(() => {
      console.log('WebSocket 已连接:', url);
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

    ws.onClose(() => {
      console.log('WebSocket 已关闭，3秒后重连...');
      setTimeout(() => this.initWebSocket(), 3000);
    });

    ws.onError(() => {
      console.log('WebSocket 连接错误');
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
      },
      complete: () => {
        try { wx.removeStorageSync('aliasUpdatedAt'); } catch (e) {}
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
