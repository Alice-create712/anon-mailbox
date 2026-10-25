const { call } = require('../../utils/api')
const { formatRelative } = require('../../utils/util')

Page({
  data: {
    id: '',
    mailbox: null,
    message: null,
    isOwner: false,
    reply: '',
    visibility: 'private'
  },

  onLoad(query) {
    this.setData({ id: query.id || '' })
    this.refresh()
  },

  async refresh() {
    try {
      const res = await call('getThread', { messageId: this.data.id })
      if (res.isOwner && !res.message.read) {
        call('markRead', { messageId: this.data.id }).catch(() => {})
      }
      const visLabel = {
        private: '仅对方可见',
        mailbox: '公开到我的信箱墙',
        everyone: '公开到好友动态'
      }
      const message = {
        ...res.message,
        timeText: formatRelative(res.message.createdAt),
        replyTime: res.message.reply ? formatRelative(res.message.reply.createdAt) : '',
        visText: res.message.reply ? visLabel[res.message.reply.visibility] || '' : ''
      }
      this.setData({
        mailbox: res.mailbox,
        message,
        isOwner: res.isOwner
      })
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    }
  },

  onReply(e) {
    this.setData({ reply: e.detail.value })
  },

  setVis(e) {
    this.setData({ visibility: e.currentTarget.dataset.vis })
  },

  async sendReply() {
    try {
      await call('replyMessage', {
        messageId: this.data.id,
        content: this.data.reply,
        visibility: this.data.visibility
      })
      wx.showToast({ title: '已回复' })
      this.setData({ reply: '' })
      this.refresh()
    } catch (err) {
      wx.showToast({ title: err.message || '回复失败', icon: 'none' })
    }
  },

  async archive() {
    try {
      await call('archiveMessage', { messageId: this.data.id })
      wx.showToast({ title: '已归档' })
      setTimeout(() => wx.navigateBack(), 400)
    } catch (err) {
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  },

  async report() {
    try {
      await call('reportMessage', { messageId: this.data.id })
      wx.showToast({ title: '已记录举报' })
    } catch (err) {
      wx.showToast({ title: err.message || '失败', icon: 'none' })
    }
  },

  shareReply() {
    const m = this.data.message
    if (!m || !m.reply) return
    wx.setClipboardData({
      data: `问：${m.content}\n答：${m.reply.content}\n来自信箱 #${this.data.mailbox.code}`,
      success: () => wx.showToast({ title: '问答已复制，可发到微信' })
    })
  }
})
