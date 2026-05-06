const { BASE_URL } = require('../../utils/config.js');

exports.methods = {
  openMessageActions(e) {
    const dataset = e.currentTarget.dataset || {};
    const myId = this._currentUserId || wx.getStorageSync('openid');
    const canDelete = dataset.userId === myId;
    const messageType = String(dataset.messageType || 'text').toLowerCase();
    const canCollectSticker = ['sticker', 'image'].includes(messageType) && !!String(dataset.mediaUrl || '').trim();
    const actions = ['回复', '复制'];
    if (canCollectSticker) actions.push('添加到表情包');
    if (canDelete) actions.push('撤回并删除');
    wx.showActionSheet({
      itemList: actions,
      success: (res) => {
        const action = actions[res.tapIndex];
        if (action === '回复') {
          this.setReplyFromDataset(dataset);
          return;
        }
        if (action === '复制') {
          let text = '';
          if (messageType === 'text') {
            text = dataset.content || '';
          } else if (messageType === 'live') {
            text = dataset.liveVideoUrl || dataset.liveCoverUrl || dataset.mediaUrl || '';
          } else {
            text = dataset.mediaUrl || dataset.content || '';
          }
          if (!text) {
            wx.showToast({ title: '暂无可复制内容', icon: 'none' });
            return;
          }
          wx.setClipboardData({ data: text });
          return;
        }
        if (action === '添加到表情包') {
          this.addStickerToPack(dataset.mediaUrl || '');
          return;
        }
        if (action === '撤回并删除') {
          this.confirmDeleteMessage(dataset);
        }
      }
    });
  },

  setReplyFromDataset(dataset) {
    const preview = this.buildReplyPreview(dataset);
    const reply = {
      id: Number(dataset.id),
      userId: dataset.userId,
      nickname: dataset.nickname || dataset.userId || '匿名',
      type: String(dataset.messageType || 'text').toLowerCase(),
      content: preview
    };
    if (!reply.id) return;
    this.setData({ replyingTo: reply, inputMode: 'text' }, () => {
      this.updateBottomPadding({ forceMeasure: true });
    });
    if (this.data.emojiPanelVisible || this.data.plusPanelVisible) {
      this.setData({ emojiPanelVisible: false, plusPanelVisible: false });
      this.updateBottomPadding();
    }
    this.scrollToBottom();
  },

  buildReplyPreview(dataset) {
    const type = String(dataset.messageType || 'text').toLowerCase();
    const content = dataset.content || '';
    if (type === 'image') return '[图片]';
    if (type === 'video') return '[视频]';
    if (type === 'audio') return '[语音]';
    if (type === 'sticker') return '[表情]';
    if (type === 'live') return '[Live]';
    if (type === 'system') return '[系统提示]';
    const trimmed = (content || '').trim();
    return trimmed ? trimmed.slice(0, 80) : '[消息]';
  },

  confirmDeleteMessage(dataset) {
    const messageId = Number(dataset.id || 0);
    if (!messageId) return;
    if (messageId < 0) {
      this.removeMessageById(messageId);
      return;
    }
    wx.showModal({
      title: '确认删除',
      content: '将在所有用户的聊天记录中删除该消息，是否确认？',
      success: (res) => {
        if (!res.confirm) return;
        this.deleteMessage(messageId);
      }
    });
  },

  deleteMessage(messageId) {
    const operator = this._currentUserId || wx.getStorageSync('openid');
    if (!operator) {
      wx.showToast({ title: '未登录', icon: 'none' });
      return;
    }
    wx.request({
      url: `${BASE_URL}/api/chat/delete`,
      method: 'POST',
      data: { message_id: messageId, operator_user_id: operator },
      success: (res) => {
        if (res.statusCode === 200 && res.data?.success) {
          this.removeMessageById(messageId);
        } else {
          wx.showToast({ title: res.data?.detail || '删除失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.showToast({ title: '删除失败', icon: 'none' });
      }
    });
  },

  cancelReply() {
    this.setData({ replyingTo: null }, () => {
      this.updateBottomPadding({ forceMeasure: true });
    });
  },

  previewChatImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.enterForegroundHold === 'function') {
      this._previewHoldActive = true;
      app.enterForegroundHold(60000);
    }
    wx.previewImage({
      current: url,
      urls: [url]
    });
  },

  previewVideoUrl(videoUrl, coverUrl = '') {
    const url = (videoUrl || '').trim();
    if (!url) return false;
    const poster = (coverUrl || '').trim();
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.enterForegroundHold === 'function') {
      this._previewHoldActive = true;
      app.enterForegroundHold(60000);
    }
    if (wx.previewMedia) {
      wx.previewMedia({
        sources: [{
          url,
          type: 'video',
          poster
        }]
      });
      return true;
    }
    if (poster) {
      wx.previewImage({ current: poster, urls: [poster] });
      return true;
    }
    wx.showToast({ title: '当前版本暂不支持预览', icon: 'none' });
    return false;
  },

  previewReplyMedia(e) {
    const dataset = e.currentTarget.dataset || {};
    const replyType = String(dataset.replyType || '').toLowerCase();
    if (!['image', 'video', 'live', 'sticker'].includes(replyType)) return;
    const replyId = Number(dataset.replyId || 0);
    const messages = this.data.messages || [];
    const target = replyId ? messages.find(item => Number(item.id) === replyId) : null;
    if (!target) {
      wx.showToast({ title: '引用内容暂不可预览', icon: 'none' });
      return;
    }
    if (target.messageType === 'image' && target.mediaUrl) {
      this.previewChatImage({ currentTarget: { dataset: { url: target.mediaUrl } } });
      return;
    }
    if (target.messageType === 'sticker' && target.mediaUrl) {
      this.previewChatImage({ currentTarget: { dataset: { url: target.mediaUrl } } });
      return;
    }
    if (target.messageType === 'video' && target.mediaUrl) {
      this.previewVideoUrl(target.mediaUrl);
      return;
    }
    if (target.messageType === 'live') {
      this.previewLiveMessage({
        currentTarget: {
          dataset: {
            cover: target.liveCoverUrl || target.mediaUrl || '',
            video: target.liveVideoUrl || ''
          }
        }
      });
      return;
    }
    wx.showToast({ title: '引用内容暂不可预览', icon: 'none' });
  },

  previewLiveMessage(e) {
    const dataset = e.currentTarget.dataset || {};
    const coverUrl = dataset.cover || '';
    const videoUrl = dataset.video || '';
    if (!videoUrl) {
      if (coverUrl) {
        this.previewChatImage({ currentTarget: { dataset: { url: coverUrl } } });
      }
      return;
    }
    this.previewVideoUrl(videoUrl, coverUrl);
  },
};
