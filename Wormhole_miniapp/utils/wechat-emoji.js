const emojiData = require('../assets/emoji/emoji-data.js');

const DEFAULT_SPRITE_URL = '/assets/emoji/emoji-sprite.png';
const PANEL = emojiData.panel || {};
const EMOJI_LIST = Array.isArray(emojiData.emojis) ? emojiData.emojis : [];

const EMOJI_POS_MAP = EMOJI_LIST.reduce((acc, item) => {
  if (item && item.cn && item.position) {
    acc[item.cn] = item.position;
  }
  return acc;
}, {});

const EMOJI_CODES = Object.keys(EMOJI_POS_MAP);

function buildScale(sizePx) {
  const width = Number(PANEL.width || 0);
  const cols = Number(PANEL.x || 0);
  const paddingLeft = Number(PANEL.paddingLeft || 0);
  const paddingRight = Number(PANEL.paddingRight || 0);
  const gapX = Number(PANEL.gapX || 0);
  if (!width || !cols) return { scale: 1, bgSize: width };
  const cellWidth = (width - paddingLeft - paddingRight - gapX * (cols - 1)) / cols;
  const scale = cellWidth ? sizePx / cellWidth : 1;
  const bgSize = +(width * scale).toFixed(2);
  return { scale, bgSize };
}

function getEmojiStyle(position, sizePx, spriteUrl = DEFAULT_SPRITE_URL) {
  if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
    return '';
  }
  const gapX = Number(PANEL.gapX || 0);
  const gapY = Number(PANEL.gapY || 0);
  const { scale, bgSize } = buildScale(sizePx);
  const offsetX = -(position.x * (sizePx + scale * gapX)).toFixed(2);
  const offsetY = -(position.y * (sizePx + scale * gapY)).toFixed(2);
  return [
    'display:inline-block',
    `width:${sizePx}px`,
    `height:${sizePx}px`,
    `background-image:url(${spriteUrl})`,
    'background-repeat:no-repeat',
    `background-position:${offsetX}px ${offsetY}px`,
    `background-size:${bgSize}px`,
    'vertical-align:middle'
  ].join(';');
}

function pushTextNodes(nodes, text) {
  if (!text) return;
  const parts = String(text).split('\n');
  parts.forEach((part, idx) => {
    if (part) {
      nodes.push({ type: 'text', text: part });
    }
    if (idx < parts.length - 1) {
      nodes.push({ name: 'br', attrs: {} });
    }
  });
}

function parseWechatEmojiNodes(text, options = {}) {
  const size = Number(options.size || 24);
  const spriteUrl = options.spriteUrl || DEFAULT_SPRITE_URL;
  const nodes = [];
  const source = String(text || '');
  if (!source) return nodes;
  const regex = /\[[^\[\]]+?\]/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      pushTextNodes(nodes, source.slice(lastIndex, start));
    }
    const code = match[0];
    const position = EMOJI_POS_MAP[code];
    if (position) {
      const style = getEmojiStyle(position, size, spriteUrl);
      nodes.push({
        name: 'span',
        attrs: {
          class: 'wx-emoji',
          title: code,
          style
        }
      });
    } else {
      pushTextNodes(nodes, code);
    }
    lastIndex = start + code.length;
  }
  if (lastIndex < source.length) {
    pushTextNodes(nodes, source.slice(lastIndex));
  }
  return nodes;
}

function buildEmojiDisplayList(sizePx = 32, spriteUrl = DEFAULT_SPRITE_URL) {
  return EMOJI_CODES.map(code => ({
    code,
    style: getEmojiStyle(EMOJI_POS_MAP[code], sizePx, spriteUrl)
  }));
}

const EMOJI_DISPLAY_LIST = buildEmojiDisplayList(32);

module.exports = {
  EMOJI_CODES,
  EMOJI_DISPLAY_LIST,
  parseWechatEmojiNodes,
  getEmojiStyle
};
