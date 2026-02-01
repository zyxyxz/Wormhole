Component({
  options: {
    multipleSlots: true // 在组件定义时的选项中启用多slot支持
  },
  /**
   * 组件的属性列表
   */
  properties: {
    extClass: {
      type: String,
      value: ''
    },
    title: {
      type: String,
      value: ''
    },
    background: {
      type: String,
      value: ''
    },
    color: {
      type: String,
      value: ''
    },
    back: {
      type: Boolean,
      value: true
    },
    loading: {
      type: Boolean,
      value: false
    },
    homeButton: {
      type: Boolean,
      value: false,
    },
    animated: {
      // 显示隐藏的时候opacity动画效果
      type: Boolean,
      value: true
    },
    show: {
      // 显示隐藏导航，隐藏的时候navigation-bar的高度占位还在
      type: Boolean,
      value: true,
      observer: '_showChange'
    },
    // back为true的时候，返回的页面深度
    delta: {
      type: Number,
      value: 1
    },
  },
  /**
   * 组件的初始数据
   */
  data: {
    displayStyle: ''
  },
  lifetimes: {
    attached() {
      const rect = wx.getMenuButtonBoundingClientRect()
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : {}
      const deviceInfo = wx.getDeviceInfo ? wx.getDeviceInfo() : {}
      const appBase = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {}
      const platform = deviceInfo.platform || ''
      const windowWidth = windowInfo.windowWidth || windowInfo.screenWidth || rect.right || 375
      const safeTop = windowInfo.safeArea?.top || 0
      let isDevtools = false
      if (typeof appBase.host === 'string') {
        isDevtools = appBase.host.toLowerCase().includes('devtools')
      } else if (appBase.host && typeof appBase.host.env === 'string') {
        isDevtools = appBase.host.env === 'devtools'
      } else if (typeof appBase.hostEnv === 'string') {
        isDevtools = appBase.hostEnv === 'devtools'
      }
      const isAndroid = platform === 'android'
      this.setData({
        ios: !isAndroid,
        innerPaddingRight: `padding-right: ${windowWidth - rect.left}px`,
        leftWidth: `width: ${windowWidth - rect.left }px`,
        safeAreaTop: (isDevtools || isAndroid) && safeTop ? `height: calc(var(--height) + ${safeTop}px); padding-top: ${safeTop}px` : ``
      })
    },
  },
  /**
   * 组件的方法列表
   */
  methods: {
    _showChange(show) {
      const animated = this.data.animated
      let displayStyle = ''
      if (animated) {
        displayStyle = `opacity: ${
          show ? '1' : '0'
        };transition:opacity 0.5s;`
      } else {
        displayStyle = `display: ${show ? '' : 'none'}`
      }
      this.setData({
        displayStyle
      })
    },
    back() {
      const data = this.data
      if (data.delta) {
        wx.navigateBack({
          delta: data.delta
        })
      }
      this.triggerEvent('back', { delta: data.delta }, {})
    },
    home() {
      this.triggerEvent('home', {}, {})
      wx.reLaunch({ url: '/pages/index/index' })
    }
  },
})
