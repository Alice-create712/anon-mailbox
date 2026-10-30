const { call } = require('./utils/api')

App({
  globalData: {
    user: null,
    useCloud: false,
    cloudEnv: '',
    pendingMailboxCode: null,
    subscribe: {
      newLetter: '',
      newReply: ''
    }
  },

  onLaunch(options) {
    const env = this.globalData.cloudEnv
    if (wx.cloud && env) {
      wx.cloud.init({ env, traceUser: true })
      this.globalData.useCloud = true
    }
    const code = options && options.query && options.query.code
    if (code) this.globalData.pendingMailboxCode = Number(code)
    this.restoreSession()
  },

  async restoreSession() {
    try {
      const res = await call('getSession')
      this.globalData.user = res.user
    } catch (e) {
      this.globalData.user = null
    }
  },

  async requireLogin() {
    if (this.globalData.user) return this.globalData.user
    await this.restoreSession()
    if (!this.globalData.user) {
      wx.reLaunch({ url: '/pages/login/login' })
      throw new Error('请先登录')
    }
    return this.globalData.user
  }
})
