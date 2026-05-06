const CHECK_TEXT = 'wormhole-vault-check-v1';
const KDF_ALGO = 'pbkdf2-sha256';
const CIPHER_ALGO = 'chacha20-hmac-sha256';
const DEFAULT_ITERATIONS = 30000;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function utf8ToBytes(text) {
  const value = String(text || '');
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }
  const encoded = unescape(encodeURIComponent(value));
  const out = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i += 1) out[i] = encoded.charCodeAt(i);
  return out;
}

function bytesToUtf8(bytes) {
  const data = toBytes(bytes);
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(data);
  }
  let binary = '';
  for (let i = 0; i < data.length; i += 8192) {
    const chunk = data.subarray(i, i + 8192);
    binary += String.fromCharCode.apply(null, Array.prototype.slice.call(chunk));
  }
  return decodeURIComponent(escape(binary));
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || []);
}

function concatBytes(parts) {
  let total = 0;
  parts.forEach((p) => { total += toBytes(p).length; });
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((p) => {
    const bytes = toBytes(p);
    out.set(bytes, offset);
    offset += bytes.length;
  });
  return out;
}

function base64Encode(bytes) {
  const data = toBytes(bytes);
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i];
    const b = i + 1 < data.length ? data[i + 1] : 0;
    const c = i + 2 < data.length ? data[i + 2] : 0;
    const triplet = (a << 16) | (b << 8) | c;
    out += B64[(triplet >> 18) & 63] + B64[(triplet >> 12) & 63];
    out += i + 1 < data.length ? B64[(triplet >> 6) & 63] : '=';
    out += i + 2 < data.length ? B64[triplet & 63] : '=';
  }
  return out;
}

function base64Decode(text) {
  const clean = String(text || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = clean[i + 2] === '=' ? 64 : B64.indexOf(clean[i + 2]);
    const d = clean[i + 3] === '=' ? 64 : B64.indexOf(clean[i + 3]);
    if (a < 0 || b < 0) continue;
    const triplet = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
    bytes.push((triplet >> 16) & 255);
    if (c !== 64) bytes.push((triplet >> 8) & 255);
    if (d !== 64) bytes.push(triplet & 255);
  }
  return new Uint8Array(bytes);
}

function randomBytes(length) {
  return new Promise((resolve, reject) => {
    const out = new Uint8Array(length);
    const nativeCrypto = typeof crypto !== 'undefined' ? crypto : null;
    if (nativeCrypto && typeof nativeCrypto.getRandomValues === 'function') {
      nativeCrypto.getRandomValues(out);
      resolve(out);
      return;
    }
    if (typeof wx !== 'undefined' && typeof wx.getRandomValues === 'function') {
      wx.getRandomValues({
        length,
        success: (res) => resolve(new Uint8Array(res.randomValues || res.arrayBuffer || res.data)),
        fail: reject
      });
      return;
    }
    reject(new Error('当前环境缺少安全随机数能力'));
  });
}

function rotr(value, shift) {
  return (value >>> shift) | (value << (32 - shift));
}

function sha256(bytes) {
  const input = toBytes(bytes);
  const bitLenHi = Math.floor(input.length / 0x20000000);
  const bitLenLo = (input.length << 3) >>> 0;
  const withOne = input.length + 1;
  const zeroPad = (64 - ((withOne + 8) % 64)) % 64;
  const total = withOne + zeroPad + 8;
  const msg = new Uint8Array(total);
  msg.set(input);
  msg[input.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(total - 8, bitLenHi, false);
  view.setUint32(total - 4, bitLenLo, false);
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, i) => outView.setUint32(i * 4, word, false));
  return out;
}

function hmacSha256(key, message) {
  let k = toBytes(key);
  if (k.length > 64) k = sha256(k);
  const block = new Uint8Array(64);
  block.set(k);
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    ipad[i] = block[i] ^ 0x36;
    opad[i] = block[i] ^ 0x5c;
  }
  return sha256(concatBytes([opad, sha256(concatBytes([ipad, message]))]));
}

function pbkdf2Sha256(passwordBytes, saltBytes, iterations, dkLen) {
  const blocks = Math.ceil(dkLen / 32);
  const out = new Uint8Array(blocks * 32);
  for (let block = 1; block <= blocks; block += 1) {
    const blockIndex = new Uint8Array(4);
    new DataView(blockIndex.buffer).setUint32(0, block, false);
    let u = hmacSha256(passwordBytes, concatBytes([saltBytes, blockIndex]));
    const t = new Uint8Array(u);
    for (let i = 1; i < iterations; i += 1) {
      u = hmacSha256(passwordBytes, u);
      for (let j = 0; j < 32; j += 1) t[j] ^= u[j];
    }
    out.set(t, (block - 1) * 32);
  }
  return out.slice(0, dkLen);
}

function readU32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function writeU32LE(bytes, offset, value) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >>> 8) & 255;
  bytes[offset + 2] = (value >>> 16) & 255;
  bytes[offset + 3] = (value >>> 24) & 255;
}

function rotl(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function quarterRound(x, a, b, c, d) {
  x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 12);
  x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 8);
  x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 7);
}

function chachaBlock(key, nonce, counter) {
  const state = new Uint32Array(16);
  state[0] = 0x61707865; state[1] = 0x3320646e; state[2] = 0x79622d32; state[3] = 0x6b206574;
  for (let i = 0; i < 8; i += 1) state[4 + i] = readU32LE(key, i * 4);
  state[12] = counter >>> 0;
  state[13] = readU32LE(nonce, 0);
  state[14] = readU32LE(nonce, 4);
  state[15] = readU32LE(nonce, 8);
  const working = new Uint32Array(state);
  for (let i = 0; i < 10; i += 1) {
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13);
    quarterRound(working, 3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i += 1) writeU32LE(out, i * 4, (working[i] + state[i]) >>> 0);
  return out;
}

function chachaXor(data, key, nonce) {
  const input = toBytes(data);
  const out = new Uint8Array(input.length);
  let counter = 1;
  for (let offset = 0; offset < input.length; offset += 64) {
    const block = chachaBlock(key, nonce, counter);
    counter = (counter + 1) >>> 0;
    const len = Math.min(64, input.length - offset);
    for (let i = 0; i < len; i += 1) out[offset + i] = input[offset + i] ^ block[i];
  }
  return out;
}

function safeEqual(a, b) {
  const left = toBytes(a);
  const right = toBytes(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function deriveKey(passphrase, salt, iterations) {
  const raw = pbkdf2Sha256(utf8ToBytes(passphrase), toBytes(salt), iterations || DEFAULT_ITERATIONS, 64);
  return {
    encKey: raw.slice(0, 32),
    macKey: raw.slice(32, 64),
    kdf_algo: KDF_ALGO,
    kdf_iterations: iterations || DEFAULT_ITERATIONS,
    key_salt: base64Encode(salt)
  };
}

function sealBytes(plainBytes, key, nonce, context) {
  const cipher = chachaXor(plainBytes, key.encKey, nonce);
  const tag = hmacSha256(key.macKey, concatBytes([utf8ToBytes(context), nonce, cipher]));
  return { ciphertext: cipher, tag };
}

function openBytes(cipherBytes, key, nonce, tag, context) {
  const expected = hmacSha256(key.macKey, concatBytes([utf8ToBytes(context), nonce, cipherBytes]));
  if (!safeEqual(expected, tag)) {
    throw new Error('口令错误或文件已损坏');
  }
  return chachaXor(cipherBytes, key.encKey, nonce);
}

async function createVaultCheck(passphrase, iterations = DEFAULT_ITERATIONS) {
  const salt = await randomBytes(16);
  const nonce = await randomBytes(12);
  const key = deriveKey(passphrase, salt, iterations);
  const sealed = sealBytes(utf8ToBytes(CHECK_TEXT), key, nonce, 'vault-check');
  return {
    key,
    fields: {
      key_salt: base64Encode(salt),
      kdf_algo: KDF_ALGO,
      kdf_iterations: iterations,
      check_nonce: base64Encode(nonce),
      check_ciphertext: base64Encode(sealed.ciphertext),
      check_tag: base64Encode(sealed.tag)
    }
  };
}

function unlockVault(passphrase, status) {
  if (!status || !status.key_salt || !status.check_nonce || !status.check_ciphertext || !status.check_tag) {
    throw new Error('保密柜信息不完整');
  }
  const key = deriveKey(passphrase, base64Decode(status.key_salt), status.kdf_iterations || DEFAULT_ITERATIONS);
  const plain = openBytes(
    base64Decode(status.check_ciphertext),
    key,
    base64Decode(status.check_nonce),
    base64Decode(status.check_tag),
    'vault-check'
  );
  if (bytesToUtf8(plain) !== CHECK_TEXT) {
    throw new Error('保密口令不正确');
  }
  return key;
}

async function encryptText(text, key, context) {
  const nonce = await randomBytes(12);
  const sealed = sealBytes(utf8ToBytes(text), key, nonce, context);
  return {
    ciphertext: base64Encode(sealed.ciphertext),
    nonce: base64Encode(nonce),
    tag: base64Encode(sealed.tag)
  };
}

function decryptText(payload, key, context) {
  const plain = openBytes(
    base64Decode(payload.ciphertext),
    key,
    base64Decode(payload.nonce),
    base64Decode(payload.tag),
    context
  );
  return bytesToUtf8(plain);
}

async function encryptVaultFile(fileBytes, key, fileName, meta) {
  const fileNonce = await randomBytes(12);
  const cipher = sealBytes(fileBytes, key, fileNonce, 'vault-file');
  const nameBox = await encryptText(fileName || '未命名文件', key, 'vault-name');
  const metaBox = await encryptText(JSON.stringify(meta || {}), key, 'vault-meta');
  return {
    cipherBytes: cipher.ciphertext,
    fields: {
      encrypted_name: nameBox.ciphertext,
      name_nonce: nameBox.nonce,
      name_tag: nameBox.tag,
      encrypted_meta: metaBox.ciphertext,
      meta_nonce: metaBox.nonce,
      meta_tag: metaBox.tag,
      file_nonce: base64Encode(fileNonce),
      file_tag: base64Encode(cipher.tag),
      cipher_algo: CIPHER_ALGO
    }
  };
}

function decryptVaultFile(cipherBytes, key, item) {
  return openBytes(
    cipherBytes,
    key,
    base64Decode(item.file_nonce),
    base64Decode(item.file_tag),
    'vault-file'
  );
}

function decryptVaultItemInfo(item, key) {
  const name = decryptText({
    ciphertext: item.encrypted_name,
    nonce: item.name_nonce,
    tag: item.name_tag
  }, key, 'vault-name');
  let meta = {};
  try {
    meta = JSON.parse(decryptText({
      ciphertext: item.encrypted_meta,
      nonce: item.meta_nonce,
      tag: item.meta_tag
    }, key, 'vault-meta'));
  } catch (e) {
    meta = {};
  }
  return { name, meta };
}

module.exports = {
  CIPHER_ALGO,
  DEFAULT_ITERATIONS,
  base64Encode,
  base64Decode,
  createVaultCheck,
  decryptVaultFile,
  decryptVaultItemInfo,
  encryptVaultFile,
  unlockVault
};
