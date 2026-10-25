const { load, save, currentUserId, setCurrentUserId } = require('./store')
const { uid, now, hashPhone, hasSensitive } = require('./util')

function useCloud() {
  const app = getApp()
  return !!(app && app.globalData && app.globalData.useCloud && wx.cloud)
}

async function call(action, data = {}) {
  if (useCloud()) {
    const res = await wx.cloud.callFunction({
      name: 'anonbox',
      data: { action, ...data }
    })
    if (!res.result || res.result.ok === false) {
      throw new Error((res.result && res.result.error) || '服务暂时不可用')
    }
    return res.result
  }
  return localCall(action, data)
}

function userById(db, id) {
  return db.users.find((u) => u.id === id) || null
}

function publicUser(user, reveal) {
  if (!user) return null
  if (!reveal) {
    return { id: user.id, nickname: '匿名用户', avatarUrl: '', mailboxCode: user.mailboxCode || null }
  }
  return {
    id: user.id,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    mailboxCode: user.mailboxCode || null
  }
}

function requireUser() {
  const id = currentUserId()
  if (!id) {
    const err = new Error('请先登录')
    err.code = 'UNAUTH'
    throw err
  }
  return id
}

function localCall(action, data) {
  const map = {
    login,
    getSession,
    updateProfile,
    createMailbox,
    getHome,
    searchMailbox,
    getMailbox,
    sendMessage,
    getInbox,
    replyMessage,
    getThread,
    publishPost,
    getFeed,
    addComment,
    bindPhone,
    addContact,
    getFriends,
    updateMailbox,
    archiveMessage,
    reportMessage,
    followMailbox,
    markRead
  }
  const fn = map[action]
  if (!fn) throw new Error(`未知操作 ${action}`)
  return fn(data)
}

function login({ nickname, avatarUrl }) {
  const db = load()
  let id = currentUserId()
  let user = id ? userById(db, id) : null
  if (!user) {
    id = uid('u')
    user = {
      id,
      nickname: nickname || '新用户',
      avatarUrl: avatarUrl || '',
      phoneHash: '',
      mailboxCode: null,
      createdAt: now()
    }
    save((d) => {
      d.users.push(user)
      return d
    })
    setCurrentUserId(id)
  } else if (nickname || avatarUrl) {
    save((d) => {
      const u = userById(d, id)
      if (nickname) u.nickname = nickname
      if (avatarUrl) u.avatarUrl = avatarUrl
      return d
    })
    user = userById(load(), id)
  }
  return { ok: true, user: publicUser(user, true) }
}

function getSession() {
  const id = currentUserId()
  if (!id) return { ok: true, user: null }
  const user = userById(load(), id)
  return { ok: true, user: user ? publicUser(user, true) : null }
}

function updateProfile({ nickname, avatarUrl }) {
  const id = requireUser()
  const db = save((d) => {
    const u = userById(d, id)
    if (nickname) u.nickname = nickname
    if (avatarUrl) u.avatarUrl = avatarUrl
    return d
  })
  return { ok: true, user: publicUser(userById(db, id), true) }
}

function createMailbox({ title, intro }) {
  const id = requireUser()
  if (hasSensitive(title) || hasSensitive(intro)) {
    throw new Error('内容未通过审核，请修改后再发布')
  }
  const db = load()
  const me = userById(db, id)
  if (me.mailboxCode) {
    return { ok: true, mailbox: db.mailboxes.find((m) => m.code === me.mailboxCode) }
  }
  const next = save((d) => {
    d.seq += 1
    const mailbox = {
      code: d.seq,
      ownerId: id,
      title: (title || `${me.nickname}的信箱`).slice(0, 20),
      intro: (intro || '欢迎匿名提问，我会认真看。').slice(0, 80),
      createdAt: now(),
      messageCount: 0,
      paused: false,
      mutedWords: [],
      topic: ''
    }
    d.mailboxes.push(mailbox)
    const u = userById(d, id)
    u.mailboxCode = mailbox.code
    return d
  })
  const mailbox = dbMailbox(next, userById(next, id).mailboxCode)
  return { ok: true, mailbox }
}

function dbMailbox(db, code) {
  return db.mailboxes.find((m) => Number(m.code) === Number(code)) || null
}

function getHome() {
  const id = requireUser()
  const db = load()
  const me = userById(db, id)
  const mine = me.mailboxCode ? dbMailbox(db, me.mailboxCode) : null
  const latest = [...db.mailboxes].sort((a, b) => b.code - a.code).slice(0, 8).map((m) => decorateMailbox(db, m))
  const unreadCount = mine
    ? db.messages.filter((m) => Number(m.mailboxCode) === Number(mine.code) && !m.reply && !m.archived && !m.read).length
    : 0
  return {
    ok: true,
    user: publicUser(me, true),
    mailbox: mine ? decorateMailbox(db, mine) : null,
    latest,
    unreadCount
  }
}

function replyVisibility(reply) {
  if (!reply) return null
  if (reply.visibility) return reply.visibility
  return reply.public ? 'everyone' : 'private'
}

function decorateMailbox(db, mailbox) {
  const owner = userById(db, mailbox.ownerId)
  return {
    ...mailbox,
    paused: !!mailbox.paused,
    mutedWords: mailbox.mutedWords || [],
    topic: mailbox.topic || '',
    ownerName: owner ? owner.nickname : '信箱主人'
  }
}

function searchMailbox({ code }) {
  const n = Number(String(code || '').replace(/[^\d]/g, ''))
  if (!n) throw new Error('请输入信箱编号')
  const db = load()
  const mailbox = dbMailbox(db, n)
  if (!mailbox) throw new Error('没有找到这个信箱')
  return { ok: true, mailbox: decorateMailbox(db, mailbox) }
}

function getMailbox({ code }) {
  const id = requireUser()
  const db = load()
  const mailbox = dbMailbox(db, code)
  if (!mailbox) throw new Error('信箱不存在')
  const isOwner = mailbox.ownerId === id
  const messages = db.messages
    .filter((m) => Number(m.mailboxCode) === Number(mailbox.code) && !m.archived)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => serializeMessage(db, m, id, isOwner))
    .filter((m) => {
      if (!m.reply) return false
      const vis = m.reply.visibility
      if (vis === 'mailbox' || vis === 'everyone') return true
      return m.isMine && vis === 'private'
    })
  return {
    ok: true,
    mailbox: decorateMailbox(db, mailbox),
    isOwner,
    messages
  }
}

function serializeMessage(db, message, viewerId, isOwner) {
  const reveal = !message.isAnonymous
  const from = userById(db, message.fromId)
  const canSeeSender = reveal || message.fromId === viewerId || isOwner && reveal
  return {
    id: message.id,
    mailboxCode: message.mailboxCode,
    content: message.content,
    createdAt: message.createdAt,
    isAnonymous: message.isAnonymous,
    from: publicUser(from, canSeeSender || message.fromId === viewerId),
    isMine: message.fromId === viewerId,
    archived: !!message.archived,
    read: !!message.read,
    reply: message.reply
      ? { ...message.reply, visibility: replyVisibility(message.reply) }
      : null
  }
}

function sendMessage({ mailboxCode, content, isAnonymous }) {
  const id = requireUser()
  const text = String(content || '').trim()
  if (!text) throw new Error('请写下你的留言')
  if (text.length > 500) throw new Error('留言请控制在 500 字以内')
  if (hasSensitive(text)) throw new Error('内容未通过审核，请修改后再发送')
  const db = load()
  const mailbox = dbMailbox(db, mailboxCode)
  if (!mailbox) throw new Error('信箱不存在')
  if (mailbox.ownerId === id) throw new Error('不能给自己的信箱留言，去收件箱查看提问吧')
  if (mailbox.paused) throw new Error('这个信箱暂时不接收新留言')
  const muted = (mailbox.mutedWords || []).filter(Boolean)
  if (muted.some((w) => text.includes(w))) throw new Error('这句话里有信箱主人不想看到的词')
  const anonymous = isAnonymous !== false
  save((d) => {
    d.messages.push({
      id: uid('msg'),
      mailboxCode: Number(mailbox.code),
      fromId: id,
      isAnonymous: anonymous,
      content: text,
      createdAt: now(),
      archived: false,
      read: false,
      reply: null
    })
    const box = dbMailbox(d, mailbox.code)
    box.messageCount = (box.messageCount || 0) + 1
    return d
  })
  return { ok: true }
}

function getInbox() {
  const id = requireUser()
  const db = load()
  const me = userById(db, id)
  const received = db.messages
    .filter((m) => me.mailboxCode && Number(m.mailboxCode) === Number(me.mailboxCode) && !m.archived)
    .sort((a, b) => Number(!!a.reply) - Number(!!b.reply) || b.createdAt - a.createdAt)
    .map((m) => serializeMessage(db, m, id, true))
  const unreadCount = received.filter((m) => !m.reply && !m.read).length
  const unanswered = received.filter((m) => !m.reply)
  const sent = db.messages
    .filter((m) => m.fromId === id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => {
      const item = serializeMessage(db, m, id, false)
      const box = dbMailbox(db, m.mailboxCode)
      item.mailbox = box ? decorateMailbox(db, box) : null
      return item
    })
  const box = me.mailboxCode ? dbMailbox(db, me.mailboxCode) : null
  return {
    ok: true,
    received,
    unanswered,
    sent,
    unreadCount,
    mailboxCode: me.mailboxCode,
    paused: !!(box && box.paused)
  }
}

function replyMessage({ messageId, content, visibility }) {
  const id = requireUser()
  const text = String(content || '').trim()
  if (!text) throw new Error('请填写回复')
  if (hasSensitive(text)) throw new Error('内容未通过审核，请修改后再发送')
  const vis = ['private', 'mailbox', 'everyone'].includes(visibility) ? visibility : 'private'
  const db = load()
  const me = userById(db, id)
  const message = db.messages.find((m) => m.id === messageId)
  if (!message) throw new Error('留言不存在')
  const box = dbMailbox(db, message.mailboxCode)
  if (!box || box.ownerId !== id) throw new Error('只能回复自己信箱里的留言')
  save((d) => {
    const msg = d.messages.find((m) => m.id === messageId)
    msg.read = true
    msg.reply = {
      content: text,
      createdAt: now(),
      visibility: vis
    }
    if (vis === 'everyone') {
      d.posts.unshift({
        id: uid('post'),
        authorId: id,
        mailboxCode: me.mailboxCode,
        isAnonymous: false,
        fromQna: true,
        content: `有人问：${msg.content}\n\n我的回复：${text}`,
        createdAt: now()
      })
    }
    return d
  })
  return { ok: true }
}

function getThread({ messageId }) {
  const id = requireUser()
  const db = load()
  const message = db.messages.find((m) => m.id === messageId)
  if (!message) throw new Error('留言不存在')
  const box = dbMailbox(db, message.mailboxCode)
  const isOwner = box && box.ownerId === id
  if (!isOwner && message.fromId !== id) throw new Error('无权查看')
  return {
    ok: true,
    mailbox: decorateMailbox(db, box),
    isOwner,
    message: serializeMessage(db, message, id, isOwner)
  }
}

function publishPost({ content, isAnonymous }) {
  const id = requireUser()
  const text = String(content || '').trim()
  if (!text) throw new Error('请写下想说的话')
  if (hasSensitive(text)) throw new Error('内容未通过审核，请修改后再发送')
  const db = load()
  const me = userById(db, id)
  save((d) => {
    d.posts.unshift({
      id: uid('post'),
      authorId: id,
      mailboxCode: me.mailboxCode || null,
      isAnonymous: isAnonymous !== false,
      content: text,
      createdAt: now()
    })
    return d
  })
  return { ok: true }
}

function friendCodesOf(db, id) {
  const me = userById(db, id)
  const hashes = new Set(db.contacts.filter((c) => c.userId === id).map((c) => c.phoneHash))
  const codes = new Set()
  db.users.forEach((u) => {
    if (u.id !== id && u.mailboxCode && u.phoneHash && hashes.has(u.phoneHash)) {
      codes.add(Number(u.mailboxCode))
    }
  })
  ;(db.follows || []).forEach((f) => {
    if (f.userId === id) codes.add(Number(f.mailboxCode))
  })
  if (me && me.mailboxCode) codes.add(Number(me.mailboxCode))
  return codes
}

function getFeed() {
  const id = requireUser()
  const db = load()
  const codes = friendCodesOf(db, id)
  const qna = db.messages
    .filter((m) => m.reply && !m.archived && (replyVisibility(m.reply) === 'mailbox' || replyVisibility(m.reply) === 'everyone'))
    .filter((m) => codes.has(Number(m.mailboxCode)))
    .sort((a, b) => b.reply.createdAt - a.reply.createdAt)
    .map((m) => {
      const box = dbMailbox(db, m.mailboxCode)
      return {
        id: m.id,
        type: 'qna',
        mailboxCode: m.mailboxCode,
        mailboxTitle: box ? box.title : '',
        question: m.content,
        answer: m.reply.content,
        createdAt: m.reply.createdAt,
        visibility: replyVisibility(m.reply)
      }
    })
  return { ok: true, posts: qna }
}

function serializePost(db, post, viewerId) {
  const author = userById(db, post.authorId)
  const reveal = !post.isAnonymous
  const comments = db.comments
    .filter((c) => c.postId === post.id)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((c) => {
      const from = userById(db, c.fromId)
      return {
        id: c.id,
        content: c.content,
        createdAt: c.createdAt,
        isAnonymous: c.isAnonymous,
        from: publicUser(from, !c.isAnonymous || c.fromId === viewerId),
        isMine: c.fromId === viewerId
      }
    })
  return {
    id: post.id,
    content: post.content,
    createdAt: post.createdAt,
    isAnonymous: post.isAnonymous,
    mailboxCode: post.mailboxCode,
    author: publicUser(author, reveal || post.authorId === viewerId),
    isMine: post.authorId === viewerId,
    comments
  }
}

function addComment({ postId, content, isAnonymous }) {
  const id = requireUser()
  const text = String(content || '').trim()
  if (!text) throw new Error('请填写留言')
  if (hasSensitive(text)) throw new Error('内容未通过审核，请修改后再发送')
  save((d) => {
    const post = d.posts.find((p) => p.id === postId)
    if (!post) throw new Error('动态不存在')
    d.comments.push({
      id: uid('cmt'),
      postId,
      fromId: id,
      isAnonymous: isAnonymous !== false,
      content: text,
      createdAt: now()
    })
    return d
  })
  return { ok: true }
}

function bindPhone({ phone }) {
  const id = requireUser()
  const raw = String(phone || '').replace(/\D/g, '')
  if (raw.length < 11) throw new Error('手机号无效')
  const phoneHash = hashPhone(raw)
  save((d) => {
    const u = userById(d, id)
    u.phoneHash = phoneHash
    return d
  })
  return { ok: true, phoneHash }
}

function addContact({ phone, name }) {
  const id = requireUser()
  const raw = String(phone || '').replace(/\D/g, '')
  if (!raw) throw new Error('未获取到号码')
  const phoneHash = hashPhone(raw)
  save((d) => {
    const exists = d.contacts.find((c) => c.userId === id && c.phoneHash === phoneHash)
    if (!exists) {
      d.contacts.push({
        id: uid('ct'),
        userId: id,
        phoneHash,
        name: name || '通讯录好友',
        createdAt: now()
      })
    }
    return d
  })
  return getFriends()
}

function getFriends() {
  const id = requireUser()
  const db = load()
  const mine = db.contacts.filter((c) => c.userId === id)
  const hashes = new Set(mine.map((c) => c.phoneHash))
  const me = userById(db, id)
  const friends = db.users
    .filter((u) => u.id !== id && u.phoneHash && (hashes.has(u.phoneHash) || (me.phoneHash && u.phoneHash === me.phoneHash)))
    .map((u) => ({
      ...publicUser(u, true),
      mailbox: u.mailboxCode ? decorateMailbox(db, dbMailbox(db, u.mailboxCode)) : null
    }))
  const pending = mine
    .filter((c) => !db.users.some((u) => u.phoneHash === c.phoneHash && u.id !== id))
    .map((c) => ({ name: c.name, waiting: true }))
  return { ok: true, friends, pending, bound: !!(me && me.phoneHash) }
}

function updateMailbox({ paused, mutedWords, topic }) {
  const id = requireUser()
  const db = load()
  const me = userById(db, id)
  if (!me.mailboxCode) throw new Error('还没有信箱')
  save((d) => {
    const box = dbMailbox(d, me.mailboxCode)
    if (typeof paused === 'boolean') box.paused = paused
    if (Array.isArray(mutedWords)) box.mutedWords = mutedWords.map((w) => String(w).trim()).filter(Boolean).slice(0, 20)
    if (typeof topic === 'string') box.topic = topic.slice(0, 30)
    return d
  })
  const fresh = load()
  return { ok: true, mailbox: decorateMailbox(fresh, dbMailbox(fresh, me.mailboxCode)) }
}

function archiveMessage({ messageId }) {
  const id = requireUser()
  save((d) => {
    const msg = d.messages.find((m) => m.id === messageId)
    if (!msg) throw new Error('留言不存在')
    const box = dbMailbox(d, msg.mailboxCode)
    if (!box || box.ownerId !== id) throw new Error('只能整理自己信箱里的留言')
    msg.archived = true
    return d
  })
  return { ok: true }
}

function reportMessage({ messageId }) {
  const id = requireUser()
  save((d) => {
    d.reports = d.reports || []
    d.reports.push({ id: uid('rp'), messageId, fromId: id, createdAt: now() })
    return d
  })
  return { ok: true }
}

function followMailbox({ code }) {
  const id = requireUser()
  const n = Number(code)
  const db = load()
  const box = dbMailbox(db, n)
  if (!box) throw new Error('信箱不存在')
  save((d) => {
    d.follows = d.follows || []
    const exists = d.follows.find((f) => f.userId === id && Number(f.mailboxCode) === n)
    if (!exists) d.follows.push({ userId: id, mailboxCode: n, createdAt: now() })
    return d
  })
  return getFriends()
}

function markRead({ messageId }) {
  const id = requireUser()
  save((d) => {
    const msg = d.messages.find((m) => m.id === messageId)
    if (!msg) return d
    const box = dbMailbox(d, msg.mailboxCode)
    if (box && box.ownerId === id) msg.read = true
    return d
  })
  return { ok: true }
}

module.exports = {
  call,
  useCloud
}
