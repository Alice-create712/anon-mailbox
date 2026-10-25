Page({
  data: {
    type: 'privacy',
    title: '隐私政策'
  },
  onLoad(query) {
    const type = query.type === 'user' ? 'user' : 'privacy'
    const title = type === 'user' ? '用户协议' : '隐私政策'
    wx.setNavigationBarTitle({ title })
    this.setData({ type, title })
  }
})
