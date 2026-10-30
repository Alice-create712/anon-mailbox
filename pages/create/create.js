const { call } = require('../../utils/api')
const { enableLetterNotify } = require('../../utils/notify')

Page({
  data: {
    title: '',
    intro: '欢迎匿名提问。署名可选，但匿名是默认。'
  },

  onTitle(e) {
    this.setData({ title: e.detail.value })
  },

  onIntro(e) {
    this.setData({ intro: e.detail.value })
  },

  async submit() {
    wx.showLoading({ title: '发布中' })
    try {
      const res = await call('createMailbox', {
        title: this.data.title.trim(),
        intro: this.data.intro.trim()
      })
      wx.hideLoading()
      enableLetterNotify().catch(() => {})
      wx.showToast({ title: `你的编号是 ${res.mailbox.code}` })
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: '/pages/home/home' })
        })
      }, 600)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '发布失败', icon: 'none' })
    }
  }
})
