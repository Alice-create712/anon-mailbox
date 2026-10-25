const { call } = require('../../utils/api')

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    agreeing: false,
    loading: false
  },

  onNickname(e) {
    this.setData({ nickname: (e.detail.value || '').slice(0, 20) })
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl || '' })
  },

  toggleAgree() {
    this.setData({ agreeing: !this.data.agreeing })
  },

  openLegal(e) {
    const type = e.currentTarget.dataset.type
    wx.navigateTo({ url: `/pages/legal/legal?type=${type}` })
  },

  async login() {
    if (this.data.loading) return
    if (!this.data.agreeing) {
      wx.showToast({ title: '请先阅读并同意协议', icon: 'none' })
      return
    }
    const nickname = this.data.nickname.trim() || '匿名箱用户'
    this.setData({ loading: true })
    try {
      const res = await call('login', {
        nickname,
        avatarUrl: this.data.avatarUrl
      })
      getApp().globalData.user = res.user
      this.enterApp()
    } catch (err) {
      wx.showToast({ title: err.message || '登录失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  enterApp() {
    const code = getApp().globalData.pendingMailboxCode
    wx.switchTab({
      url: '/pages/home/home',
      success: () => {
        if (!code) return
        getApp().globalData.pendingMailboxCode = null
        wx.navigateTo({ url: `/pages/mailbox/mailbox?code=${code}` })
      }
    })
  },

  async onLoad() {
    try {
      const res = await call('getSession')
      if (res.user) {
        getApp().globalData.user = res.user
        this.enterApp()
      }
    } catch (e) {
      /* stay on login */
    }
  }
})
