const { call } = require('../../utils/api')
const { PROMPTS } = require('../../utils/prompts')
const { enableLetterNotify } = require('../../utils/notify')

Page({
  data: {
    user: null,
    mailbox: null,
    recent: [],
    keyword: '',
    unreadCount: 0,
    replyNotice: 0,
    notifyLetter: false,
    slips: PROMPTS
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    try {
      await getApp().requireLogin()
      const res = await call('getHome')
      this.setData({
        user: res.user,
        mailbox: res.mailbox,
        recent: res.recent || [],
        unreadCount: res.unreadCount || 0,
        replyNotice: res.replyNotice || 0,
        notifyLetter: !!res.notifyLetter
      })
      if (res.replyNotice) {
        call('getNotices').catch(() => {})
      }
    } catch (err) {
      if (err.code !== 'UNAUTH' && err.message !== '请先登录') {
        wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      }
    }
  },

  copySlip(e) {
    const text = e.currentTarget.dataset.text
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已抄下这句，去别人信封里问', icon: 'none' })
    })
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value })
  },

  async search() {
    const code = this.data.keyword.trim()
    if (!code) {
      wx.showToast({ title: '请输入信箱编号，例如 1', icon: 'none' })
      return
    }
    wx.showLoading({ title: '查找中' })
    try {
      const res = await call('searchMailbox', { code })
      wx.hideLoading()
      wx.navigateTo({ url: `/pages/mailbox/mailbox?code=${res.mailbox.code}` })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '没找到', icon: 'none' })
    }
  },

  async askNotify() {
    try {
      await enableLetterNotify()
      this.setData({ notifyLetter: true })
      wx.showToast({ title: '来信时会提醒你', icon: 'none' })
    } catch (err) {
      wx.showToast({ title: err.message || '先在微信里允许提醒', icon: 'none' })
    }
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' })
  },

  goMine() {
    if (!this.data.mailbox) return
    wx.navigateTo({ url: `/pages/mailbox/mailbox?code=${this.data.mailbox.code}` })
  },

  goBox(e) {
    const code = e.currentTarget.dataset.code
    wx.navigateTo({ url: `/pages/mailbox/mailbox?code=${code}` })
  },

  copyCode() {
    if (!this.data.mailbox) return
    wx.setClipboardData({
      data: String(this.data.mailbox.code),
      success: () => wx.showToast({ title: '已复制编号' })
    })
  },

  onShareAppMessage() {
    const box = this.data.mailbox
    if (box) {
      return {
        title: box.topic
          ? `这周想被问：${box.topic} · 信箱 #${box.code}`
          : `来我的信箱 #${box.code} 匿名提问`,
        path: `/pages/mailbox/mailbox?code=${box.code}`
      }
    }
    return {
      title: '匿名问答箱',
      path: '/pages/login/login'
    }
  }
})
