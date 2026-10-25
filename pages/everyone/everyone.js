const { call } = require('../../utils/api')
const { formatRelative } = require('../../utils/util')

Page({
  data: {
    tab: 'feed',
    posts: [],
    friends: [],
    pending: [],
    bound: false,
    followCode: ''
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    try {
      await getApp().requireLogin()
      const [feed, friends] = await Promise.all([call('getFeed'), call('getFriends')])
      this.setData({
        posts: (feed.posts || []).map((p) => ({
          ...p,
          timeText: formatRelative(p.createdAt)
        })),
        friends: friends.friends || [],
        pending: friends.pending || [],
        bound: friends.bound
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

  goBox(e) {
    const code = e.currentTarget.dataset.code
    if (!code) {
      wx.showToast({ title: '对方还没有信箱', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/mailbox/mailbox?code=${code}` })
  },

  onFollowCode(e) {
    this.setData({ followCode: e.detail.value })
  },

  async followByCode() {
    try {
      await call('followMailbox', { code: this.data.followCode })
      this.setData({ followCode: '' })
      wx.showToast({ title: '已加入好友动态' })
      this.refresh()
    } catch (err) {
      wx.showToast({ title: err.message || '添加失败', icon: 'none' })
    }
  },

  onGetPhoneNumber(e) {
    if (!e.detail || e.detail.errMsg !== 'getPhoneNumber:ok') {
      this.bindPhone()
    }
  },

  async bindPhone() {
    wx.showModal({
      title: '绑定手机号',
      content: '用于匹配同样在用的朋友。预览可填演示号。',
      editable: true,
      placeholderText: '11 位手机号',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await call('bindPhone', { phone: res.content })
          wx.showToast({ title: '已绑定' })
          this.refresh()
        } catch (err) {
          wx.showToast({ title: err.message || '绑定失败', icon: 'none' })
        }
      }
    })
  },

  addContact() {
    wx.chooseContact({
      success: async (res) => {
        try {
          await call('addContact', {
            phone: res.phoneNumber || res.displayName,
            name: res.displayName
          })
          this.refresh()
        } catch (err) {
          this.manualContact()
        }
      },
      fail: () => this.manualContact()
    })
  },

  manualContact() {
    wx.showModal({
      title: '添加朋友号码',
      editable: true,
      placeholderText: '可填 13800000001',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await call('addContact', { phone: res.content, name: '通讯录好友' })
          this.refresh()
        } catch (err) {
          wx.showToast({ title: err.message || '添加失败', icon: 'none' })
        }
      }
    })
  }
})
