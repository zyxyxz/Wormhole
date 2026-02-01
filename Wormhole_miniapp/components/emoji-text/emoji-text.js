const { parseWechatEmojiNodes } = require('../../utils/wechat-emoji.js');

Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    text: {
      type: String,
      value: ''
    },
    size: {
      type: Number,
      value: 24
    },
    mode: {
      type: String,
      value: 'inline'
    },
    customClass: {
      type: String,
      value: ''
    }
  },
  data: {
    nodes: []
  },
  observers: {
    'text,size': function (text, size) {
      this.setData({
        nodes: parseWechatEmojiNodes(text, { size })
      });
    }
  }
});
