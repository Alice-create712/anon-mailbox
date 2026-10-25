const { call } = require('../../utils/api')
const { formatRelative } = require('../../utils/util')

Page({
  data: {
    tab: 'unanswered',
    unanswered: [],
    received: [],
    sent: [],
    mailboxCode: null,
    paused: false,
    unreadCount: 0
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    try {
      await getApp().requireLogin()
      const res = await call('getInbox')
      const stamp = (list) => list.map((m) => ({
        ...m,
        timeText: formatRelative(m.createdAt),
        statusText: m.reply ? '已回复' : '待回复'
      }))
      this.setData({
        unanswered: stamp(res.unanswered || []),
        received: stamp((res.received || []).filter((m) => m.reply)),
        sent: stamp(res.sent || []),
        mailboxCode: res.mailboxCode,
        paused: res.paused,
        unreadCount: res.unreadCount || 0
      })
    } catch (err) {
      if (err.message !== '请先登录') {
        wx.showToast({ title: err.message || '加载失败', icon: 'none' })
      }
    }
  },

  setTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab })
  },

  open(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` })
  },

  async togglePause() {
    try {
      await call('updateMailbox', { paused: !this.data.paused })
      this.refresh()
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/create/create' })
  }
})
