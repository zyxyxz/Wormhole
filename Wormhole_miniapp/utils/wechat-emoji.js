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
  const height = Number(PANEL.height || 0);
  const cols = Number(PANEL.x || 0);
  const paddingLeft = Number(PANEL.paddingLeft || 0);
  const paddingRight = Number(PANEL.paddingRight || 0);
  const gapX = Number(PANEL.gapX || 0);
  if (!width || !cols) return { scale: 1, bgWidth: width, bgHeight: height };
  const cellWidth = (width - paddingLeft - paddingRight - gapX * (cols - 1)) / cols;
  const scale = cellWidth ? sizePx / cellWidth : 1;
  const bgWidth = +(width * scale).toFixed(2);
  const bgHeight = +(height * scale).toFixed(2);
  return { scale, bgWidth, bgHeight };
}

function getEmojiStyles(position, sizePx, spriteUrl = DEFAULT_SPRITE_URL) {
  if (!position || typeof position.x !== 'number' || typeof position.y !== 'number') {
    return null;
  }
  const gapX = Number(PANEL.gapX || 0);
  const gapY = Number(PANEL.gapY || 0);
  const { scale, bgWidth, bgHeight } = buildScale(sizePx);
  const offsetX = -(position.x * (sizePx + scale * gapX)).toFixed(2);
  const offsetY = -(position.y * (sizePx + scale * gapY)).toFixed(2);
  return {
    wrapperStyle: [
      'display:inline-block',
      `width:${sizePx}px`,
      `height:${sizePx}px`,
      'overflow:hidden',
      'vertical-align:middle'
    ].join(';'),
    spriteStyle: [
      `width:${bgWidth}px`,
      `height:${bgHeight}px`,
      `transform:translate(${offsetX}px, ${offsetY}px)`,
      'transform-origin:0 0'
    ].join(';'),
    spriteUrl
  };
}

function parseWechatEmojiSegments(text, options = {}) {
  const size = Number(options.size || 24);
  const spriteUrl = options.spriteUrl || DEFAULT_SPRITE_URL;
  const segments = [];
  const source = String(text || '');
  if (!source) return segments;
  const regex = /\[[^\[\]]+?\]/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      segments.push({ type: 'text', text: source.slice(lastIndex, start) });
    }
    const code = match[0];
    const position = EMOJI_POS_MAP[code];
    if (position) {
      const styles = getEmojiStyles(position, size, spriteUrl);
      segments.push({
        type: 'emoji',
        code,
        wrapperStyle: styles?.wrapperStyle || '',
        spriteStyle: styles?.spriteStyle || '',
        spriteUrl: styles?.spriteUrl || spriteUrl
      });
    } else {
      segments.push({ type: 'text', text: code });
    }
    lastIndex = start + code.length;
  }
  if (lastIndex < source.length) {
    segments.push({ type: 'text', text: source.slice(lastIndex) });
  }
  return segments;
}

function buildEmojiDisplayList(sizePx = 32, spriteUrl = DEFAULT_SPRITE_URL) {
  return EMOJI_CODES.map(code => {
    const styles = getEmojiStyles(EMOJI_POS_MAP[code], sizePx, spriteUrl) || {};
    return {
      code,
      wrapperStyle: styles.wrapperStyle || '',
      spriteStyle: styles.spriteStyle || '',
      spriteUrl: styles.spriteUrl || spriteUrl
    };
  });
}

const EMOJI_DISPLAY_LIST = buildEmojiDisplayList(40);

module.exports = {
  EMOJI_CODES,
  EMOJI_DISPLAY_LIST,
  parseWechatEmojiSegments,
  getEmojiStyles
};
