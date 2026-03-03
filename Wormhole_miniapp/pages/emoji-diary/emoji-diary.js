const { BASE_URL } = require('../../utils/config.js');
const { ensureDiaryMode } = require('../../utils/review.js');

function pad2(num) {
  return String(num).padStart(2, '0');
}

function parseDateKey(dateKey) {
  const m = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3])
  };
}

function formatDateKey(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function inMonth(dateKey, year, month) {
  const parsed = parseDateKey(dateKey);
  return !!parsed && parsed.year === year && parsed.month === month;
}

Page({
  data: {
    spaceId: '',
    userId: '',
    year: 0,
    month: 0,
    monthLabel: '',
    weekHeaders: ['日', '一', '二', '三', '四', '五', '六'],
    calendarDays: [],
    entriesMap: {},
    selectedDate: '',
    selectedDayLabel: '',
    selectedEmoji: '',
    selectedNote: '',
    loading: false,
    saving: false,
    emojiOptions: ['🙂', '😄', '😍', '🤩', '😌', '🤔', '😴', '🥱', '😭', '😡', '🤒', '😎', '🥳', '😮', '🤯']
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  onLoad() {
    if (ensureDiaryMode('pages/emoji-diary/emoji-diary')) return;
    this.bootstrap();
  },

  onShow() {
    if (ensureDiaryMode('pages/emoji-diary/emoji-diary')) return;
  },

  bootstrap() {
    const spaceId = wx.getStorageSync('currentSpaceId');
    if (!spaceId) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    this.setData({
      spaceId,
      year,
      month,
      monthLabel: this.formatMonthLabel(year, month)
    });
    this.ensureIdentity().then((userId) => {
      if (!userId) {
        wx.showToast({ title: '缺少用户身份', icon: 'none' });
        return;
      }
      this.fetchMonthEntries({ keepSelection: false });
    });
  },

  ensureIdentity() {
    const existed = this.data.userId || wx.getStorageSync('openid') || '';
    if (existed) {
      if (this.data.userId !== existed) {
        this.setData({ userId: existed });
      }
      return Promise.resolve(existed);
    }
    const app = typeof getApp === 'function' ? getApp() : null;
    const ensure = app && typeof app.ensureOpenId === 'function'
      ? app.ensureOpenId()
      : Promise.resolve('');
    return ensure.then((uid) => {
      const userId = uid || wx.getStorageSync('openid') || '';
      if (userId) {
        this.setData({ userId });
      }
      return userId;
    });
  },

  formatMonthLabel(year, month) {
    return `${year}年${pad2(month)}月`;
  },

  formatDayLabel(dateKey) {
    const parsed = parseDateKey(dateKey);
    if (!parsed) return '';
    return `${parsed.year}年${pad2(parsed.month)}月${pad2(parsed.day)}日`;
  },

  buildEntriesMap(entries) {
    const map = {};
    (entries || []).forEach((item) => {
      if (!item || !item.entry_date) return;
      map[item.entry_date] = {
        id: item.id,
        emoji: item.emoji || '',
        note: item.note || ''
      };
    });
    return map;
  },

  buildCalendar(entriesMap, selectedDate) {
    const year = this.data.year;
    const month = this.data.month;
    const firstWeekDay = new Date(year, month - 1, 1).getDay();
    const totalDays = new Date(year, month, 0).getDate();
    const prevMonthTotalDays = new Date(year, month - 1, 0).getDate();
    const today = new Date();
    const todayKey = formatDateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());

    const days = [];

    for (let i = 0; i < firstWeekDay; i += 1) {
      const dayNumber = prevMonthTotalDays - firstWeekDay + i + 1;
      const dt = new Date(year, month - 2, dayNumber);
      const dateKey = formatDateKey(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
      const entry = entriesMap[dateKey] || {};
      days.push({
        dateKey,
        dayNumber,
        inMonth: false,
        isToday: dateKey === todayKey,
        selected: dateKey === selectedDate,
        emoji: entry.emoji || '',
        hasNote: !!entry.note
      });
    }

    for (let d = 1; d <= totalDays; d += 1) {
      const dateKey = formatDateKey(year, month, d);
      const entry = entriesMap[dateKey] || {};
      days.push({
        dateKey,
        dayNumber: d,
        inMonth: true,
        isToday: dateKey === todayKey,
        selected: dateKey === selectedDate,
        emoji: entry.emoji || '',
        hasNote: !!entry.note
      });
    }

    while (days.length < 42) {
      const idx = days.length - (firstWeekDay + totalDays) + 1;
      const dt = new Date(year, month, idx);
      const dateKey = formatDateKey(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
      const entry = entriesMap[dateKey] || {};
      days.push({
        dateKey,
        dayNumber: dt.getDate(),
        inMonth: false,
        isToday: dateKey === todayKey,
        selected: dateKey === selectedDate,
        emoji: entry.emoji || '',
        hasNote: !!entry.note
      });
    }

    return days;
  },

  applyMonthData(entriesMap, keepSelection = true) {
    const year = this.data.year;
    const month = this.data.month;
    const today = new Date();
    const todayKey = formatDateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());

    let selectedDate = '';
    if (this._pendingSelectDate && inMonth(this._pendingSelectDate, year, month)) {
      selectedDate = this._pendingSelectDate;
    } else if (keepSelection && inMonth(this.data.selectedDate, year, month)) {
      selectedDate = this.data.selectedDate;
    } else if (inMonth(todayKey, year, month)) {
      selectedDate = todayKey;
    } else {
      selectedDate = formatDateKey(year, month, 1);
    }
    this._pendingSelectDate = '';

    const selectedEntry = entriesMap[selectedDate] || {};
    this.setData({
      entriesMap,
      selectedDate,
      selectedDayLabel: this.formatDayLabel(selectedDate),
      selectedEmoji: selectedEntry.emoji || '',
      selectedNote: selectedEntry.note || '',
      calendarDays: this.buildCalendar(entriesMap, selectedDate),
      monthLabel: this.formatMonthLabel(year, month)
    });
  },

  fetchMonthEntries({ keepSelection = true } = {}) {
    const { spaceId, userId, year, month } = this.data;
    if (!spaceId || !userId || !year || !month) return;

    this.setData({ loading: true });
    wx.request({
      url: `${BASE_URL}/api/emoji-diary/month`,
      data: {
        space_id: spaceId,
        year,
        month,
        user_id: userId
      },
      success: (res) => {
        if (res.statusCode !== 200) {
          wx.showToast({ title: res.data?.detail || '加载失败', icon: 'none' });
          return;
        }
        const entriesMap = this.buildEntriesMap(res.data?.entries || []);
        this.applyMonthData(entriesMap, keepSelection);
      },
      fail: () => {
        wx.showToast({ title: '加载失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ loading: false });
      }
    });
  },

  changeMonth(targetYear, targetMonth) {
    let year = Number(targetYear);
    let month = Number(targetMonth);
    if (month <= 0) {
      year -= 1;
      month = 12;
    } else if (month >= 13) {
      year += 1;
      month = 1;
    }
    this.setData({
      year,
      month,
      monthLabel: this.formatMonthLabel(year, month)
    });
    this.fetchMonthEntries({ keepSelection: false });
  },

  prevMonth() {
    this.changeMonth(this.data.year, this.data.month - 1);
  },

  nextMonth() {
    this.changeMonth(this.data.year, this.data.month + 1);
  },

  goToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    this._pendingSelectDate = formatDateKey(year, month, now.getDate());
    this.setData({
      year,
      month,
      monthLabel: this.formatMonthLabel(year, month)
    });
    this.fetchMonthEntries({ keepSelection: false });
  },

  onTapDay(e) {
    const dateKey = e.currentTarget.dataset.date;
    const isInMonth = !!e.currentTarget.dataset.inMonth;
    if (!dateKey) return;

    if (!isInMonth) {
      const parsed = parseDateKey(dateKey);
      if (!parsed) return;
      this._pendingSelectDate = dateKey;
      this.setData({
        year: parsed.year,
        month: parsed.month,
        monthLabel: this.formatMonthLabel(parsed.year, parsed.month)
      });
      this.fetchMonthEntries({ keepSelection: false });
      return;
    }

    const selectedEntry = this.data.entriesMap[dateKey] || {};
    this.setData({
      selectedDate: dateKey,
      selectedDayLabel: this.formatDayLabel(dateKey),
      selectedEmoji: selectedEntry.emoji || '',
      selectedNote: selectedEntry.note || '',
      calendarDays: this.buildCalendar(this.data.entriesMap, dateKey)
    });
  },

  pickEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji || '';
    this.setData({ selectedEmoji: emoji });
  },

  onNoteInput(e) {
    this.setData({ selectedNote: e.detail.value || '' });
  },

  saveEntry() {
    if (this.data.saving) return;
    const { spaceId, userId, selectedDate, selectedEmoji, selectedNote } = this.data;
    if (!spaceId || !userId || !selectedDate) {
      wx.showToast({ title: '缺少必要信息', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.request({
      url: `${BASE_URL}/api/emoji-diary/upsert`,
      method: 'POST',
      data: {
        space_id: spaceId,
        user_id: userId,
        entry_date: selectedDate,
        emoji: selectedEmoji,
        note: selectedNote
      },
      success: (res) => {
        if (res.statusCode !== 200) {
          wx.showToast({ title: res.data?.detail || '保存失败', icon: 'none' });
          return;
        }

        const result = res.data || {};
        const nextEntries = Object.assign({}, this.data.entriesMap);
        if (result.removed) {
          delete nextEntries[selectedDate];
        } else if (result.entry) {
          nextEntries[selectedDate] = {
            id: result.entry.id,
            emoji: result.entry.emoji || '',
            note: result.entry.note || ''
          };
        }
        this.setData({
          entriesMap: nextEntries,
          calendarDays: this.buildCalendar(nextEntries, selectedDate)
        });
        wx.showToast({ title: result.removed ? '已清空' : '已保存', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '保存失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ saving: false });
      }
    });
  },

  clearEntry() {
    this.setData({ selectedEmoji: '', selectedNote: '' });
    this.saveEntry();
  }
});
