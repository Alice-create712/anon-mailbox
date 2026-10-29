Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home', text: '信封', icon: '✉' },
      { pagePath: '/pages/inbox/inbox', text: '来信', icon: '▤' },
      { pagePath: '/pages/everyone/everyone', text: '友人', icon: '☰' }
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
