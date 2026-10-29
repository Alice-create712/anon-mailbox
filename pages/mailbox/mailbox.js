const { call } = require('../../utils/api')
const { formatRelative } = require('../../utils/util')
const { PROMPTS, randomPrompt } = require('../../utils/prompts')

Page({
  data: {
    code: 0,
    mailbox: null,
    isOwner: false,
    messages: [],
    content: '',
    isAnonymous: true,
    sending: false,
    prompt: '',
    slips: PROMPTS,
    showSettings: false,
    muteInput: ''
  },

  onLoad(query) {
    const code = Number(query.code || 0)
    this.setData({ code, prompt: randomPrompt() })
    if (code) getApp().globalData.pendingMailboxCode = code
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    try {
      await getApp().requireLogin()
      const res = await call('getMailbox', { code: this.data.code })
      wx.setNavigationBarTitle({ title: `#${res.mailbox.code} ${res.mailbox.title}` })
      this.setData({
        mailbox: res.mailbox,
        isOwner: res.isOwner,
        messages: (res.messages || []).map((m) => ({
          ...m,
          timeText: formatRelative(m.createdAt),
          replyTime: m.reply ? formatRelative(m.reply.createdAt) : ''
        }))
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  setAnon() {
    this.setData({ isAnonymous: true })
  },

  setNamed() {
    this.setData({ isAnonymous: false })
  },

  pickSlip(e) {
    this.setData({ content: e.currentTarget.dataset.text })
  },

  toggleSettings() {
    this.setData({ showSettings: !this.data.showSettings })
  },

  onContent(e) {
    this.setData({ content: e.detail.value })
  },

  async send() {
    if (this.data.sending) return
    this.setData({ sending: true })
    try {
      await call('sendMessage', {
        mailboxCode: this.data.code,
        content: this.data.content,
        isAnonymous: this.data.isAnonymous
      })
      this.setData({ content: '' })
      wx.showToast({ title: this.data.isAnonymous ? '已匿名送达' : '已署名送达' })
      this.refresh()
    } catch (err) {
      wx.showToast({ title: err.message || '发送失败', icon: 'none' })
    } finally {
      this.setData({ sending: false })
    }
  },

  async togglePause() {
    try {
      const next = !this.data.mailbox.paused
      const res = await call('updateMailbox', { paused: next })
      this.setData({ mailbox: res.mailbox })
      wx.showToast({ title: next ? '已暂停接收' : '已重新打开' })
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' })
    }
  },

  onMute(e) {
    this.setData({ muteInput: e.detail.value })
  },

  async addMute() {
    const word = this.data.muteInput.trim()
    if (!word) return
    const mutedWords = [...(this.data.mailbox.mutedWords || []), word]
    try {
      const res = await call('updateMailbox', { mutedWords })
      this.setData({ mailbox: res.mailbox, muteInput: '' })
    } catch (err) {
      wx.showToast({ title: err.message || '添加失败', icon: 'none' })
    }
  },

  async follow() {
    try {
      await call('followMailbox', { code: this.data.code })
      wx.showToast({ title: '已放入好友动态' })
    } catch (err) {
      wx.showToast({ title: err.message || '关注失败', icon: 'none' })
    }
  },

  openThread(e) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${e.currentTarget.dataset.id}` })
  },

  onShareAppMessage() {
    const box = this.data.mailbox || {}
    return {
      title: `来#${box.code}信箱匿名提问`,
      path: `/pages/mailbox/mailbox?code=${box.code}`
    }
  }
})
