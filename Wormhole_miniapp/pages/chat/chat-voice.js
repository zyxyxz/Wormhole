exports.methods = {
  handleRecordStart() {
    if (!this.recorder) {
      wx.showToast({ title: '录音不可用', icon: 'none' });
      return;
    }
    this._recordCancelled = false;
    this.setData({ recording: true });
    try {
      this.recorder.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3'
      });
    } catch (e) {
      this.setData({ recording: false });
      wx.showToast({ title: '开启录音失败', icon: 'none' });
    }
  },

  handleRecordEnd() {
    if (!this.recorder) return;
    this.setData({ recording: false });
    this.recorder.stop();
  },

  handleRecordCancel() {
    if (!this.recorder) return;
    this._recordCancelled = true;
    this.setData({ recording: false });
    try { this.recorder.stop(); } catch (e) {}
  },

  normalizeAudioPlayId(rawId) {
    if (rawId === undefined || rawId === null) return '';
    return String(rawId);
  },

  resetAudioPlaybackState() {
    if (!this.data.audioPlayingId) return;
    this.setData({ audioPlayingId: '' });
  },

  stopAudioPlayback({ keepState = false } = {}) {
    if (!this.audioCtx) return;
    if (keepState) {
      this._ignoreNextAudioStop = true;
    }
    try {
      this.audioCtx.stop();
    } catch (e) {
      this._ignoreNextAudioStop = false;
    }
    if (!keepState) {
      this.resetAudioPlaybackState();
    }
  },

  playAudio(e) {
    const url = e.currentTarget.dataset.url;
    const playId = this.normalizeAudioPlayId(e.currentTarget.dataset.playId || e.currentTarget.dataset.id);
    if (!url || !this.audioCtx || !playId) return;
    if (this.data.audioPlayingId === playId) {
      this.stopAudioPlayback();
      return;
    }
    if (this.data.audioPlayingId) {
      this.stopAudioPlayback({ keepState: true });
    }
    try {
      this.audioCtx.src = url;
      this.audioCtx.play();
      this.setData({ audioPlayingId: playId });
    } catch (e) {
      this.resetAudioPlaybackState();
      wx.showToast({ title: '语音播放失败', icon: 'none' });
    }
  },
};
