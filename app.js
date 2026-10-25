const { call } = require('./utils/api')

App({
  globalData: {
    user: null,
    useCloud: false,
    cloudEnv: '',
    pendingMailboxCode: null
  },

  onLaunch() {
    const env = this.globalData.cloudEnv
    if (wx.cloud && env) {
      wx.cloud.init({ env, traceUser: true })
      this.globalData.useCloud = true
    }
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
