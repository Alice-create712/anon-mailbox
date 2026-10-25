Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home', text: '首页', icon: '⌂' },
      { pagePath: '/pages/inbox/inbox', text: '收件箱', icon: '✉' },
      { pagePath: '/pages/everyone/everyone', text: 'Everyone', icon: '◎' }
    ]
  },
  methods: {
    switchTab(e) {
      const { path, index } = e.currentTarget.dataset
      wx.switchTab({ url: path })
      this.setData({ selected: index })
    }
  }
})
