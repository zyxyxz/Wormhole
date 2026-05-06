const { BASE_URL } = require('../../utils/config.js');
const vaultCrypto = require('../../utils/vaultCrypto.js');

const fs = wx.getFileSystemManager();
// See docs/audits/2026-05-vault.md F1: raised from 30000 to align with the
// vaultCrypto DEFAULT_ITERATIONS bump. Existing vaults keep their stored
// iteration count; this only affects newly created vaults.
const CHECK_ITERATIONS = 100000;

function formatBytes(size) {
  const value = Number(size || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${value}B`;
}

function normalizeDateString(str) {
  if (!str) return '';
  let normalized = String(str).replace(' ', 'T');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) normalized += 'Z';
  return normalized;
}

function formatTime(str) {
  const date = new Date(normalizeDateString(str));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function guessMime(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    zip: 'application/zip'
  };
  return map[ext] || 'application/octet-stream';
}

function fileIcon(contentType, name) {
  const type = String(contentType || '').toLowerCase();
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎬';
  if (type.includes('pdf')) return '📕';
  if (['doc', 'docx'].includes(ext)) return '📄';
  if (['xls', 'xlsx'].includes(ext)) return '📊';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
  return '🔒';
}

function safeName(name) {
  const raw = String(name || 'vault-file').replace(/[\\/:*?"<>|]/g, '_');
  return raw.slice(0, 80) || 'vault-file';
}

function bytesToArrayBuffer(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy.buffer;
}

function readFile(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      success: (res) => resolve(res.data),
      fail: reject
    });
  });
}

function writeFile(filePath, bytes) {
  return new Promise((resolve, reject) => {
    fs.writeFile({
      filePath,
      data: bytesToArrayBuffer(bytes),
      success: resolve,
      fail: reject
    });
  });
}

function unlinkFile(filePath) {
  if (!filePath) return;
  try {
    fs.unlink({ filePath });
  } catch (e) {}
}

Page({
  data: {
    spaceId: '',
    userId: '',
    initialized: false,
    unlocked: false,
    unlocking: false,
    uploading: false,
    downloading: false,
    loading: false,
    refreshing: false,
    passphrase: '',
    files: [],
    maxFileBytes: 10 * 1024 * 1024,
    maxFileSizeLabel: '10MB',
    showVideoPreview: false,
    videoPreviewPath: '',
    videoPreviewName: ''
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  noop() {},

  onLoad() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    const userId = wx.getStorageSync('openid') || '';
    this._plainTempFiles = [];
    this.setData({ spaceId, userId });
    if (!spaceId) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    this.ensureIdentity().then(() => this.loadStatus());
  },

  onShow() {
    if (this.data.unlocked) this.loadFiles();
  },

  onUnload() {
    this.cleanupPlainTemps();
  },

  ensureIdentity() {
    const exists = this.data.userId || wx.getStorageSync('openid') || '';
    if (exists) {
      this.setData({ userId: exists });
      return Promise.resolve(exists);
    }
    const app = typeof getApp === 'function' ? getApp() : null;
    const ensure = app && typeof app.ensureOpenId === 'function'
      ? app.ensureOpenId()
      : Promise.resolve('');
    return ensure.then((uid) => {
      const userId = uid || wx.getStorageSync('openid') || '';
      this.setData({ userId });
      return userId;
    });
  },

  onPassphraseInput(e) {
    this.setData({ passphrase: e.detail.value || '' });
  },

  onPullDownRefresh() {
    if (!this.data.unlocked) return;
    this.setData({ refreshing: true });
    this.loadFiles().finally(() => this.setData({ refreshing: false }));
  },

  request(options) {
    return new Promise((resolve, reject) => {
      wx.request({
        ...options,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
            return;
          }
          reject(new Error(res.data?.detail || '请求失败'));
        },
        fail: reject
      });
    });
  },

  loadStatus() {
    const userId = this.data.userId || wx.getStorageSync('openid') || '';
    return this.request({
      url: `${BASE_URL}/api/vault/status`,
      data: { space_id: this.data.spaceId, user_id: userId }
    }).then((status) => {
      this._status = status;
      this.setData({
        initialized: !!status.initialized,
        maxFileBytes: status.max_file_bytes || 10 * 1024 * 1024,
        maxFileSizeLabel: formatBytes(status.max_file_bytes || 10 * 1024 * 1024)
      });
      return status;
    }).catch(() => {
      wx.showToast({ title: '保密柜状态加载失败', icon: 'none' });
    });
  },

  unlockOrCreate() {
    const passphrase = this.data.passphrase || '';
    if (passphrase.length < 8) {
      wx.showToast({ title: '口令至少 8 位', icon: 'none' });
      return;
    }
    if (!this.data.initialized) {
      this.createVault(passphrase);
      return;
    }
    this.unlockVault(passphrase);
  },

  createVault(passphrase) {
    const userId = this.data.userId || wx.getStorageSync('openid') || '';
    this.setData({ unlocking: true });
    wx.showLoading({ title: '正在创建' });
    vaultCrypto.createVaultCheck(passphrase, CHECK_ITERATIONS).then(({ key, fields }) => (
      this.request({
        url: `${BASE_URL}/api/vault/init`,
        method: 'POST',
        data: {
          space_id: this.data.spaceId,
          user_id: userId,
          ...fields
        }
      }).then((status) => {
        this._vaultKey = key;
        this._status = status;
        this.setData({
          initialized: true,
          unlocked: true,
          maxFileBytes: status.max_file_bytes || this.data.maxFileBytes,
          maxFileSizeLabel: formatBytes(status.max_file_bytes || this.data.maxFileBytes)
        });
        return this.loadFiles();
      })
    )).then(() => {
      wx.showToast({ title: '已解锁', icon: 'success' });
    }).catch((err) => {
      wx.showToast({ title: err.message || '创建失败', icon: 'none' });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ unlocking: false });
    });
  },

  onForgotPassphrase() {
    if (!this.data.initialized || this.data.unlocking) return;
    // Two-stage confirmation: a warning modal first, then a typed-text gate.
    // Both stages must pass before we even talk to the server. The server
    // also independently checks `confirm == '重置'` so a stray POST can't
    // bypass the UI guard.
    wx.showModal({
      title: '永久重置保密柜',
      content: '保密柜采用端到端加密，忘记口令时服务端无法解出内容。继续将永久删除当前空间所有保密文件，且无法恢复。是否继续？',
      cancelText: '取消',
      confirmText: '继续',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res || !res.confirm) return;
        wx.showModal({
          title: '请输入「重置」以确认',
          editable: true,
          placeholderText: '重置',
          cancelText: '取消',
          confirmText: '永久重置',
          confirmColor: '#dc2626',
          success: (res2) => {
            if (!res2 || !res2.confirm) return;
            const typed = (res2.content || '').trim();
            if (typed !== '重置') {
              wx.showToast({ title: '确认文本不正确', icon: 'none' });
              return;
            }
            this.resetVault();
          }
        });
      }
    });
  },

  resetVault() {
    const userId = this.data.userId || wx.getStorageSync('openid') || '';
    this.setData({ unlocking: true });
    wx.showLoading({ title: '正在重置', mask: true });
    this.request({
      url: `${BASE_URL}/api/vault/reset`,
      method: 'POST',
      data: {
        space_id: this.data.spaceId,
        user_id: userId,
        confirm: '重置'
      }
    }).then((data) => {
      // Wipe local in-memory state so the page re-enters "create vault" mode.
      this._vaultKey = null;
      this._status = null;
      this.cleanupPlainTemps();
      this.setData({
        initialized: false,
        unlocked: false,
        passphrase: '',
        files: []
      });
      const removed = (data && data.deleted_files) || 0;
      wx.showToast({
        title: removed > 0 ? `已重置（清理 ${removed} 文件）` : '已重置',
        icon: 'success'
      });
    }).catch((err) => {
      wx.showToast({ title: err.message || '重置失败', icon: 'none' });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ unlocking: false });
    });
  },

  unlockVault(passphrase) {
    this.setData({ unlocking: true });
    wx.showLoading({ title: '正在解锁' });
    Promise.resolve().then(() => {
      const key = vaultCrypto.unlockVault(passphrase, this._status);
      this._vaultKey = key;
      this.setData({ unlocked: true });
      return this.loadFiles();
    }).then(() => {
      wx.showToast({ title: '已解锁', icon: 'success' });
    }).catch((err) => {
      wx.showToast({ title: err.message || '口令不正确', icon: 'none' });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ unlocking: false });
    });
  },

  loadFiles() {
    if (!this._vaultKey) return Promise.resolve();
    const userId = this.data.userId || wx.getStorageSync('openid') || '';
    this.setData({ loading: true });
    return this.request({
      url: `${BASE_URL}/api/vault/files`,
      data: { space_id: this.data.spaceId, user_id: userId }
    }).then((data) => {
      const files = (data.files || []).map((item) => this.decorateFile(item));
      this._rawFiles = data.files || [];
      this.setData({ files });
    }).catch((err) => {
      wx.showToast({ title: err.message || '文件列表加载失败', icon: 'none' });
    }).finally(() => {
      this.setData({ loading: false });
    });
  },

  decorateFile(item) {
    let info = { name: '无法解密的文件', meta: {} };
    try {
      info = vaultCrypto.decryptVaultItemInfo(item, this._vaultKey);
    } catch (e) {}
    const meta = info.meta || {};
    const contentType = meta.content_type || item.content_type || 'application/octet-stream';
    const name = info.name || meta.name || '未命名文件';
    return {
      ...item,
      name,
      meta,
      icon: fileIcon(contentType, name),
      sizeLabel: formatBytes(meta.size || item.original_size || 0),
      timeLabel: formatTime(item.created_at),
      contentType
    };
  },

  chooseAndUpload() {
    if (!this._vaultKey || this.data.uploading) return;
    wx.chooseMessageFile({
      count: 1,
      type: 'all',
      success: (res) => {
        const file = (res.tempFiles || [])[0];
        if (!file) return;
        this.encryptAndUpload(file);
      }
    });
  },

  encryptAndUpload(file) {
    const filePath = file.path || file.tempFilePath;
    const fileName = file.name || '未命名文件';
    const size = Number(file.size || 0);
    if (!filePath) {
      wx.showToast({ title: '文件路径无效', icon: 'none' });
      return;
    }
    if (size > this.data.maxFileBytes) {
      wx.showToast({ title: `文件不能超过 ${this.data.maxFileSizeLabel}`, icon: 'none' });
      return;
    }
    const userId = this.data.userId || wx.getStorageSync('openid') || '';
    const contentType = guessMime(fileName);
    const cipherPath = `${wx.env.USER_DATA_PATH}/vault_cipher_${Date.now()}.bin`;
    this.setData({ uploading: true });
    wx.showLoading({ title: '本地加密中' });
    readFile(filePath).then((buffer) => {
      const plainBytes = new Uint8Array(buffer);
      return vaultCrypto.encryptVaultFile(plainBytes, this._vaultKey, fileName, {
        name: fileName,
        size: plainBytes.length,
        content_type: contentType,
        encrypted_at: Date.now()
      });
    }).then((encrypted) => (
      writeFile(cipherPath, encrypted.cipherBytes).then(() => encrypted)
    )).then((encrypted) => new Promise((resolve, reject) => {
      wx.hideLoading();
      wx.showLoading({ title: '上传密文中' });
      wx.uploadFile({
        url: `${BASE_URL}/api/vault/upload`,
        filePath: cipherPath,
        name: 'file',
        formData: {
          space_id: String(this.data.spaceId),
          user_id: userId,
          original_size: String(size),
          content_type: contentType,
          ...encrypted.fields
        },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
            return;
          }
          let detail = '上传失败';
          try {
            detail = JSON.parse(res.data || '{}').detail || detail;
          } catch (e) {}
          reject(new Error(detail));
        },
        fail: reject
      });
    })).then(() => {
      wx.showToast({ title: '已上传密文', icon: 'success' });
      return this.loadFiles();
    }).catch((err) => {
      wx.showToast({ title: err.message || '上传失败', icon: 'none' });
    }).finally(() => {
      unlinkFile(cipherPath);
      wx.hideLoading();
      this.setData({ uploading: false });
    });
  },

  getRawFile(id) {
    const targetId = Number(id);
    return (this._rawFiles || []).find((item) => Number(item.id) === targetId);
  },

  downloadAndPreview(e) {
    if (this.data.downloading) return;
    const id = e.currentTarget.dataset.id;
    const raw = this.getRawFile(id);
    if (!raw) return;
    const decorated = this.decorateFile(raw);
    const userId = this.data.userId || wx.getStorageSync('openid') || '';
    this.setData({ downloading: true });
    wx.showLoading({ title: '下载密文中' });
    this.request({
      url: `${BASE_URL}/api/vault/files/${id}/download`,
      data: { user_id: userId }
    }).then((payload) => new Promise((resolve, reject) => {
      wx.downloadFile({
        url: payload.url,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
            resolve(res.tempFilePath);
            return;
          }
          reject(new Error('下载失败'));
        },
        fail: reject
      });
    })).then((cipherPath) => {
      wx.hideLoading();
      wx.showLoading({ title: '本地解密中' });
      return readFile(cipherPath);
    }).then((buffer) => {
      const plain = vaultCrypto.decryptVaultFile(new Uint8Array(buffer), this._vaultKey, raw);
      const plainPath = `${wx.env.USER_DATA_PATH}/vault_plain_${Date.now()}_${safeName(decorated.name)}`;
      return writeFile(plainPath, plain).then(() => plainPath);
    }).then((plainPath) => {
      this._plainTempFiles.push(plainPath);
      this.previewPlainFile(plainPath, decorated);
    }).catch((err) => {
      wx.showToast({ title: err.message || '打开失败', icon: 'none' });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ downloading: false });
    });
  },

  previewPlainFile(filePath, item) {
    const type = String(item.contentType || item.meta?.content_type || '').toLowerCase();
    if (type.startsWith('image/')) {
      wx.previewImage({ urls: [filePath], current: filePath });
      return;
    }
    if (type.startsWith('video/')) {
      this.setData({
        showVideoPreview: true,
        videoPreviewPath: filePath,
        videoPreviewName: item.name
      });
      return;
    }
    wx.openDocument({
      filePath,
      showMenu: true,
      fail: () => {
        wx.showToast({ title: '当前格式无法直接预览', icon: 'none' });
      }
    });
  },

  closeVideoPreview() {
    const path = this.data.videoPreviewPath;
    this.setData({ showVideoPreview: false, videoPreviewPath: '', videoPreviewName: '' });
    unlinkFile(path);
    this._plainTempFiles = (this._plainTempFiles || []).filter((item) => item !== path);
  },

  cleanupPlainTemps() {
    (this._plainTempFiles || []).forEach((filePath) => unlinkFile(filePath));
    this._plainTempFiles = [];
  },

  deleteFile(e) {
    const id = e.currentTarget.dataset.id;
    const file = (this.data.files || []).find((item) => Number(item.id) === Number(id));
    wx.showModal({
      title: '删除保密文件',
      content: `确认删除「${file?.name || '该文件'}」？`,
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return;
        const userId = this.data.userId || wx.getStorageSync('openid') || '';
        this.request({
          url: `${BASE_URL}/api/vault/files/${id}`,
          method: 'DELETE',
          data: { user_id: userId }
        }).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadFiles();
        }).catch((err) => {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        });
      }
    });
  }
});
