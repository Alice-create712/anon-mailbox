const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const TMPL_NEW_LETTER = ''
const TMPL_NEW_REPLY = ''

function hashPhone(phone) {
  const raw = String(phone || '').replace(/\s+/g, '')
  let h = 5381
  for (let i = 0; i < raw.length; i += 1) {
    h = ((h << 5) + h) + raw.charCodeAt(i)
    h &= 0x7fffffff
  }
  return `p_${h.toString(16)}`
}

function publicUser(user, reveal) {
  if (!user) return null
  if (!reveal) {
    return { id: user._openid, nickname: '匿名用户', avatarUrl: '', mailboxCode: user.mailboxCode || null }
  }
  return {
    id: user._openid,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    mailboxCode: user.mailboxCode || null
  }
}

function replyVisibility(reply) {
  if (!reply) return null
  if (reply.visibility) return reply.visibility
  return reply.public ? 'everyone' : 'private'
}

async function getUser(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get()
  return res.data[0] || null
}

async function ensureUser(openid, patch) {
  const exist = await getUser(openid)
  if (!exist) {
    const doc = {
      nickname: (patch && patch.nickname) || '新用户',
      avatarUrl: (patch && patch.avatarUrl) || '',
      phoneHash: '',
      mailboxCode: null,
      recentCodes: [],
      notifyLetter: false,
      notifyReply: false,
      createdAt: Date.now()
    }
    await db.collection('users').add({ data: doc })
    return getUser(openid)
  }
  if (patch && (patch.nickname || patch.avatarUrl)) {
    const data = {}
    if (patch.nickname) data.nickname = patch.nickname
    if (patch.avatarUrl) data.avatarUrl = patch.avatarUrl
    await db.collection('users').doc(exist._id).update({ data })
    return getUser(openid)
  }
  return exist
}

async function secCheck(openid, content) {
  if (!content) return
  try {
    await cloud.openapi.security.msgSecCheck({
      openid,
      scene: 2,
      version: 2,
      content: String(content)
    })
  } catch (e) {
    if (e.errCode && e.errCode !== 0) {
      throw new Error('内容未通过审核，请修改后再发送')
    }
  }
}

async function getMailboxByCode(code) {
  const res = await db.collection('mailboxes').where({ code: Number(code) }).limit(1).get()
  return res.data[0] || null
}

async function decorateMailbox(mailbox) {
  if (!mailbox) return null
  const owner = await getUser(mailbox.ownerOpenid)
  return {
    code: mailbox.code,
    title: mailbox.title,
    intro: mailbox.intro,
    createdAt: mailbox.createdAt,
    messageCount: mailbox.messageCount || 0,
    paused: !!mailbox.paused,
    mutedWords: mailbox.mutedWords || [],
    topic: mailbox.topic || '',
    ownerName: owner ? owner.nickname : '信箱主人'
  }
}

async function rememberMailbox(user, code) {
  const n = Number(code)
  if (!user || !n) return
  const recent = [n, ...(user.recentCodes || []).filter((c) => Number(c) !== n)].slice(0, 8)
  await db.collection('users').doc(user._id).update({ data: { recentCodes: recent } })
}

async function sendSubscribe(openid, templateId, page, phrase, extra) {
  if (!openid || !templateId) return
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId,
      page,
      data: {
        thing1: { value: phrase.slice(0, 20) },
        thing2: { value: String(extra || '打开信封查看').slice(0, 20) }
      }
    })
  } catch (e) {
    /* 模板字段需在公众平台与此处对齐 */
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action
  try {
    const result = await handle(action, event, OPENID)
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: err.message || '服务异常' }
  }
}

async function handle(action, event, openid) {
  switch (action) {
    case 'login':
    case 'updateProfile': {
      const user = await ensureUser(openid, event)
      return { user: publicUser(user, true) }
    }
    case 'getSession': {
      const user = await getUser(openid)
      return { user: user ? publicUser(user, true) : null }
    }
    case 'createMailbox': {
      const user = await ensureUser(openid)
      if (user.mailboxCode) {
        const box = await getMailboxByCode(user.mailboxCode)
        return { mailbox: await decorateMailbox(box) }
      }
      await secCheck(openid, `${event.title || ''} ${event.intro || ''}`)
      let next = 1
      try {
        next = await db.runTransaction(async (transaction) => {
          const ref = db.collection('counters').doc('mailbox')
          const snap = await transaction.get(ref)
          if (!snap.data) {
            transaction.set(ref, { seq: 1 })
            return 1
          }
          const seq = Number(snap.data.seq || 0) + 1
          transaction.update(ref, { seq })
          return seq
        })
      } catch (e) {
        await db.collection('counters').doc('mailbox').set({ data: { seq: 1 } })
        next = 1
      }
      const mailbox = {
        code: next,
        ownerOpenid: openid,
        title: (event.title || `${user.nickname}的信箱`).slice(0, 20),
        intro: (event.intro || '欢迎匿名提问，我会认真看。').slice(0, 80),
        createdAt: Date.now(),
        messageCount: 0,
        paused: false,
        mutedWords: [],
        topic: ''
      }
      await db.collection('mailboxes').add({ data: mailbox })
      await db.collection('users').doc(user._id).update({ data: { mailboxCode: next } })
      return { mailbox: { ...mailbox, ownerName: user.nickname } }
    }
    case 'getHome': {
      const user = await ensureUser(openid)
      const mine = user.mailboxCode ? await getMailboxByCode(user.mailboxCode) : null
      const recent = []
      for (const code of user.recentCodes || []) {
        const box = await getMailboxByCode(code)
        if (box && box.ownerOpenid !== openid) recent.push(await decorateMailbox(box))
      }
      let unreadCount = 0
      if (mine) {
        const unreadRes = await db.collection('messages').where({
          mailboxCode: Number(mine.code),
          read: false
        }).count()
        unreadCount = unreadRes.total || 0
      }
      return {
        user: publicUser(user, true),
        mailbox: mine ? await decorateMailbox(mine) : null,
        recent,
        unreadCount,
        replyNotice: 0,
        notifyLetter: !!user.notifyLetter
      }
    }
    case 'searchMailbox': {
      const box = await getMailboxByCode(event.code)
      if (!box) throw new Error('没有找到这个信箱')
      return { mailbox: await decorateMailbox(box) }
    }
    case 'getMailbox': {
      const box = await getMailboxByCode(event.code)
      if (!box) throw new Error('没有找到这个信箱')
      const user = await ensureUser(openid)
      await rememberMailbox(user, box.code)
      const isOwner = box.ownerOpenid === openid
      const msgRes = await db.collection('messages').where({ mailboxCode: Number(box.code) }).orderBy('createdAt', 'desc').get()
      const messages = []
      for (const m of msgRes.data) {
        if (m.archived) continue
        const item = await serializeMessage(m, openid, isOwner)
        if (!item.reply) continue
        const vis = item.reply.visibility
        if (vis === 'mailbox' || vis === 'everyone' || (item.isMine && vis === 'private')) {
          messages.push(item)
        }
      }
      return { mailbox: await decorateMailbox(box), isOwner, messages }
    }
    case 'sendMessage': {
      const text = String(event.content || '').trim()
      if (!text) throw new Error('请写下你的留言')
      await secCheck(openid, text)
      const box = await getMailboxByCode(event.mailboxCode)
      if (!box) throw new Error('信箱不存在')
      if (box.ownerOpenid === openid) throw new Error('不能给自己的信箱留言')
      if (box.paused) throw new Error('这个信箱暂时不接收新留言')
      const muted = box.mutedWords || []
      if (muted.some((w) => text.includes(w))) throw new Error('这句话里有信箱主人不想看到的词')
      await db.collection('messages').add({
        data: {
          mailboxCode: Number(box.code),
          fromOpenid: openid,
          isAnonymous: event.isAnonymous !== false,
          content: text,
          createdAt: Date.now(),
          archived: false,
          later: false,
          read: false,
          reply: null
        }
      })
      await db.collection('mailboxes').doc(box._id).update({ data: { messageCount: _.inc(1) } })
      const owner = await getUser(box.ownerOpenid)
      if (owner && owner.notifyLetter) {
        await sendSubscribe(box.ownerOpenid, TMPL_NEW_LETTER, 'pages/inbox/inbox', '信封里有新来信', `#${box.code}`)
      }
      return {}
    }
    case 'getInbox': {
      const user = await ensureUser(openid)
      const receivedRes = user.mailboxCode
        ? await db.collection('messages').where({ mailboxCode: Number(user.mailboxCode) }).orderBy('createdAt', 'desc').get()
        : { data: [] }
      const sentRes = await db.collection('messages').where({ fromOpenid: openid }).orderBy('createdAt', 'desc').get()
      const received = []
      for (const m of receivedRes.data) {
        if (m.archived) continue
        received.push(await serializeMessage(m, openid, true))
      }
      const unanswered = received.filter((m) => !m.reply && !m.later)
      const later = received.filter((m) => !m.reply && m.later)
      const sent = []
      for (const m of sentRes.data) {
        const item = await serializeMessage(m, openid, false)
        const box = await getMailboxByCode(m.mailboxCode)
        item.mailbox = box ? await decorateMailbox(box) : null
        sent.push(item)
      }
      const box = user.mailboxCode ? await getMailboxByCode(user.mailboxCode) : null
      return {
        received,
        unanswered,
        later,
        sent,
        unreadCount: unanswered.filter((m) => !m.read).length,
        mailboxCode: user.mailboxCode,
        paused: !!(box && box.paused)
      }
    }
    case 'getThread': {
      const msg = (await db.collection('messages').doc(event.messageId).get()).data
      const box = await getMailboxByCode(msg.mailboxCode)
      const isOwner = box.ownerOpenid === openid
      if (!isOwner && msg.fromOpenid !== openid) throw new Error('无权查看')
      return {
        mailbox: await decorateMailbox(box),
        isOwner,
        message: await serializeMessage(msg, openid, isOwner)
      }
    }
    case 'replyMessage': {
      const text = String(event.content || '').trim()
      if (!text) throw new Error('请填写回复')
      await secCheck(openid, text)
      const msg = (await db.collection('messages').doc(event.messageId).get()).data
      const box = await getMailboxByCode(msg.mailboxCode)
      if (box.ownerOpenid !== openid) throw new Error('只能回复自己信箱里的留言')
      const vis = ['private', 'mailbox', 'everyone'].includes(event.visibility) ? event.visibility : 'private'
      const reply = { content: text, createdAt: Date.now(), visibility: vis }
      await db.collection('messages').doc(event.messageId).update({ data: { reply, read: true, later: false } })
      if (vis === 'everyone') {
        await db.collection('posts').add({
          data: {
            authorOpenid: openid,
            mailboxCode: box.code,
            isAnonymous: false,
            content: `有人问：${msg.content}\n\n我的回复：${text}`,
            createdAt: Date.now()
          }
        })
      }
      const asker = await getUser(msg.fromOpenid)
      if (asker && asker.notifyReply) {
        await sendSubscribe(msg.fromOpenid, TMPL_NEW_REPLY, `pages/detail/detail?id=${event.messageId}`, '有人回复了你', `#${box.code}`)
      }
      return {}
    }
    case 'publishPost': {
      const text = String(event.content || '').trim()
      if (!text) throw new Error('请写下想说的话')
      await secCheck(openid, text)
      const user = await ensureUser(openid)
      await db.collection('posts').add({
        data: {
          authorOpenid: openid,
          mailboxCode: user.mailboxCode || null,
          isAnonymous: event.isAnonymous !== false,
          content: text,
          createdAt: Date.now()
        }
      })
      return {}
    }
    case 'getFeed': {
      const user = await ensureUser(openid)
      const followRes = await db.collection('follows').where({ userOpenid: openid }).get()
      const codes = new Set(followRes.data.map((f) => Number(f.mailboxCode)))
      if (user.mailboxCode) codes.add(Number(user.mailboxCode))
      const msgRes = await db.collection('messages').orderBy('createdAt', 'desc').limit(80).get()
      const posts = []
      for (const m of msgRes.data) {
        if (!m.reply || m.archived) continue
        const vis = replyVisibility(m.reply)
        if (vis !== 'mailbox' && vis !== 'everyone') continue
        if (!codes.has(Number(m.mailboxCode))) continue
        const box = await getMailboxByCode(m.mailboxCode)
        posts.push({
          id: m._id,
          type: 'qna',
          mailboxCode: m.mailboxCode,
          mailboxTitle: box ? box.title : '',
          question: m.content,
          answer: m.reply.content,
          createdAt: m.reply.createdAt,
          visibility: vis
        })
      }
      return { posts }
    }
    case 'addComment': {
      const text = String(event.content || '').trim()
      if (!text) throw new Error('请填写留言')
      await secCheck(openid, text)
      await db.collection('comments').add({
        data: {
          postId: event.postId,
          fromOpenid: openid,
          isAnonymous: event.isAnonymous !== false,
          content: text,
          createdAt: Date.now()
        }
      })
      return {}
    }
    case 'bindPhone': {
      const raw = String(event.phone || '').replace(/\D/g, '')
      if (raw.length < 11) throw new Error('手机号无效')
      const user = await ensureUser(openid)
      await db.collection('users').doc(user._id).update({ data: { phoneHash: hashPhone(raw) } })
      return { phoneHash: hashPhone(raw) }
    }
    case 'addContact': {
      const raw = String(event.phone || '').replace(/\D/g, '')
      if (!raw) throw new Error('未获取到号码')
      await db.collection('contacts').add({
        data: {
          userOpenid: openid,
          phoneHash: hashPhone(raw),
          name: event.name || '通讯录好友',
          createdAt: Date.now()
        }
      })
      return handle('getFriends', event, openid)
    }
    case 'getFriends': {
      const user = await ensureUser(openid)
      const mine = await db.collection('contacts').where({ userOpenid: openid }).get()
      const hashes = mine.data.map((c) => c.phoneHash)
      const usersRes = hashes.length
        ? await db.collection('users').where({ phoneHash: _.in(hashes) }).get()
        : { data: [] }
      const friends = []
      for (const u of usersRes.data) {
        if (u._openid === openid) continue
        const mailbox = u.mailboxCode ? await getMailboxByCode(u.mailboxCode) : null
        friends.push({
          ...publicUser(u, true),
          mailbox: mailbox ? await decorateMailbox(mailbox) : null
        })
      }
      const pending = mine.data.filter((c) => !usersRes.data.some((u) => u.phoneHash === c.phoneHash && u._openid !== openid))
      return {
        friends,
        pending: pending.map((c) => ({ name: c.name, waiting: true })),
        bound: !!user.phoneHash
      }
    }
    case 'updateMailbox': {
      const user = await ensureUser(openid)
      if (!user.mailboxCode) throw new Error('还没有信箱')
      const box = await getMailboxByCode(user.mailboxCode)
      const data = {}
      if (typeof event.paused === 'boolean') data.paused = event.paused
      if (Array.isArray(event.mutedWords)) {
        data.mutedWords = event.mutedWords.map((w) => String(w).trim()).filter(Boolean).slice(0, 20)
      }
      if (typeof event.topic === 'string') data.topic = event.topic.slice(0, 40)
      if (Object.keys(data).length) await db.collection('mailboxes').doc(box._id).update({ data })
      return { mailbox: await decorateMailbox(await getMailboxByCode(user.mailboxCode)) }
    }
    case 'archiveMessage':
    case 'markRead':
    case 'markLater': {
      const msg = (await db.collection('messages').doc(event.messageId).get()).data
      const box = await getMailboxByCode(msg.mailboxCode)
      if (!box || box.ownerOpenid !== openid) throw new Error('只能整理自己信箱里的留言')
      const data = {}
      if (action === 'archiveMessage') data.archived = true
      if (action === 'markRead') data.read = true
      if (action === 'markLater') {
        data.later = event.later !== false
        if (data.later) data.read = true
      }
      await db.collection('messages').doc(event.messageId).update({ data })
      return {}
    }
    case 'reportMessage': {
      await db.collection('reports').add({
        data: { messageId: event.messageId, fromOpenid: openid, createdAt: Date.now() }
      })
      return {}
    }
    case 'followMailbox': {
      const box = await getMailboxByCode(event.code)
      if (!box) throw new Error('信箱不存在')
      const exists = await db.collection('follows').where({
        userOpenid: openid,
        mailboxCode: Number(event.code)
      }).count()
      if (!exists.total) {
        await db.collection('follows').add({
          data: { userOpenid: openid, mailboxCode: Number(event.code), createdAt: Date.now() }
        })
      }
      return handle('getFriends', event, openid)
    }
    case 'enableNotify': {
      const user = await ensureUser(openid)
      const data = {}
      if (event.letter) data.notifyLetter = true
      if (event.reply) data.notifyReply = true
      if (Object.keys(data).length) await db.collection('users').doc(user._id).update({ data })
      return {}
    }
    case 'getNotices':
      return { notices: [] }
    default:
      throw new Error('未知操作')
  }
}

async function serializeMessage(message, viewerOpenid, isOwner) {
  const from = await getUser(message.fromOpenid)
  const reveal = !message.isAnonymous
  const reply = message.reply
    ? { ...message.reply, visibility: replyVisibility(message.reply) }
    : null
  return {
    id: message._id,
    mailboxCode: message.mailboxCode,
    content: message.content,
    createdAt: message.createdAt,
    isAnonymous: message.isAnonymous,
    from: publicUser(from, reveal || message.fromOpenid === viewerOpenid),
    isMine: message.fromOpenid === viewerOpenid,
    archived: !!message.archived,
    later: !!message.later,
    read: !!message.read,
    statusText: reply ? '对方已回复' : (message.read ? '对方已读' : '已送达'),
    reply
  }
}

async function serializePost(post, viewerOpenid) {
  const author = await getUser(post.authorOpenid)
  const cmtRes = await db.collection('comments').where({ postId: post._id }).orderBy('createdAt', 'asc').get()
  const comments = []
  for (const c of cmtRes.data) {
    const from = await getUser(c.fromOpenid)
    comments.push({
      id: c._id,
      content: c.content,
      createdAt: c.createdAt,
      isAnonymous: c.isAnonymous,
      from: publicUser(from, !c.isAnonymous || c.fromOpenid === viewerOpenid),
      isMine: c.fromOpenid === viewerOpenid
    })
  }
  return {
    id: post._id,
    content: post.content,
    createdAt: post.createdAt,
    isAnonymous: post.isAnonymous,
    mailboxCode: post.mailboxCode,
    author: publicUser(author, !post.isAnonymous || post.authorOpenid === viewerOpenid),
    isMine: post.authorOpenid === viewerOpenid,
    comments
  }
}
