function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function now() {
  return Date.now()
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const min = pad(d.getMinutes())
  return `${y}-${m}-${day} ${h}:${min}`
}

function formatRelative(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}天前`
  return formatTime(ts).slice(0, 10)
}

function hashPhone(phone) {
  const raw = String(phone || '').replace(/\s+/g, '')
  let h = 5381
  for (let i = 0; i < raw.length; i += 1) {
    h = ((h << 5) + h) + raw.charCodeAt(i)
    h &= 0x7fffffff
  }
  return `p_${h.toString(16)}`
}

function displayName(user, isAnonymous) {
  if (isAnonymous || !user) return '匿名用户'
  return user.nickname || '署名用户'
}

function hasSensitive(text) {
  const blocked = ['微信官方', '加微', '加我vx', '博彩', '色情']
  const t = String(text || '')
  return blocked.some((w) => t.includes(w))
}

module.exports = {
  uid,
  now,
  formatTime,
  formatRelative,
  hashPhone,
  displayName,
  hasSensitive
}
