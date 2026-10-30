const { call } = require('./api')

function subscribeConfig() {
  const app = getApp()
  return (app && app.globalData && app.globalData.subscribe) || {}
}

function tmplId(key) {
  const id = subscribeConfig()[key]
  return id && String(id).trim() && !String(id).startsWith('YOUR') ? String(id) : ''
}

function requestSubscribe(keys) {
  const ids = (keys || []).map(tmplId).filter(Boolean)
  return new Promise((resolve) => {
    if (!ids.length || typeof wx.requestSubscribeMessage !== 'function') {
      resolve({ skipped: true, granted: true })
      return
    }
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: (res) => resolve({ granted: ids.some((id) => res[id] === 'accept') }),
      fail: () => resolve({ granted: false })
    })
  })
}

async function enableLetterNotify() {
  const res = await requestSubscribe(['newLetter'])
  if (!res.granted && !res.skipped) {
    throw new Error('没有打开提醒')
  }
  await call('enableNotify', { letter: true })
  return res
}

async function enableReplyNotify() {
  const res = await requestSubscribe(['newReply'])
  if (res.granted || res.skipped) {
    await call('enableNotify', { reply: true })
  }
  return res
}

module.exports = {
  requestSubscribe,
  enableLetterNotify,
  enableReplyNotify
}
