const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
  const owner = await getUser(mailbox.ownerOpenid)
  return {
    code: mailbox.code,
    title: mailbox.title,
    intro: mailbox.intro,
    createdAt: mailbox.createdAt,
    messageCount: mailbox.messageCount || 0,
    ownerName: owner ? owner.nickname : '信箱主人'
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
        messageCount: 0
      }
      await db.collection('mailboxes').add({ data: mailbox })
      await db.collection('users').doc(user._id).update({ data: { mailboxCode: next } })
      return { mailbox: { ...mailbox, ownerName: user.nickname } }
    }
    case 'getHome': {
      const user = await ensureUser(openid)
      const mine = user.mailboxCode ? await getMailboxByCode(user.mailboxCode) : null
      const latestRes = await db.collection('mailboxes').orderBy('code', 'desc').limit(8).get()
      const latest = []
      for (const m of latestRes.data) latest.push(await decorateMailbox(m))
      return {
        user: publicUser(user, true),
        mailbox: mine ? await decorateMailbox(mine) : null,
        latest
      }
    }
    case 'searchMailbox':
    case 'getMailbox': {
      const box = await getMailboxByCode(event.code)
      if (!box) throw new Error('没有找到这个信箱')
      if (action === 'searchMailbox') return { mailbox: await decorateMailbox(box) }
      const isOwner = box.ownerOpenid === openid
      const msgRes = await db.collection('messages').where({ mailboxCode: Number(box.code) }).orderBy('createdAt', 'desc').get()
      const messages = []
      for (const m of msgRes.data) {
        const item = await serializeMessage(m, openid, isOwner)
        if (isOwner || item.reply) messages.push(item)
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
      await db.collection('messages').add({
        data: {
          mailboxCode: Number(box.code),
          fromOpenid: openid,
          isAnonymous: event.isAnonymous !== false,
          content: text,
          createdAt: Date.now(),
          reply: null
        }
      })
      await db.collection('mailboxes').doc(box._id).update({ data: { messageCount: _.inc(1) } })
      return {}
    }
    case 'getInbox': {
      const user = await ensureUser(openid)
      const receivedRes = user.mailboxCode
        ? await db.collection('messages').where({ mailboxCode: Number(user.mailboxCode) }).orderBy('createdAt', 'desc').get()
        : { data: [] }
      const sentRes = await db.collection('messages').where({ fromOpenid: openid }).orderBy('createdAt', 'desc').get()
      const received = []
      for (const m of receivedRes.data) received.push(await serializeMessage(m, openid, true))
      const sent = []
      for (const m of sentRes.data) {
        const item = await serializeMessage(m, openid, false)
        const box = await getMailboxByCode(m.mailboxCode)
        item.mailbox = box ? await decorateMailbox(box) : null
        sent.push(item)
      }
      return { received, sent, mailboxCode: user.mailboxCode }
    }
    case 'getThread': {
      const msg = await db.collection('messages').doc(event.messageId).get()
      const message = msg.data
      const box = await getMailboxByCode(message.mailboxCode)
      const isOwner = box.ownerOpenid === openid
      if (!isOwner && message.fromOpenid !== openid) throw new Error('无权查看')
      return {
        mailbox: await decorateMailbox(box),
        isOwner,
        message: await serializeMessage(message, openid, isOwner)
      }
    }
    case 'replyMessage': {
      const text = String(event.content || '').trim()
      if (!text) throw new Error('请填写回复')
      await secCheck(openid, text)
      const msg = (await db.collection('messages').doc(event.messageId).get()).data
      const box = await getMailboxByCode(msg.mailboxCode)
      if (box.ownerOpenid !== openid) throw new Error('只能回复自己信箱里的留言')
      const reply = { content: text, createdAt: Date.now(), public: !!event.makePublic }
      await db.collection('messages').doc(event.messageId).update({ data: { reply } })
      if (event.makePublic) {
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
      const postRes = await db.collection('posts').orderBy('createdAt', 'desc').limit(50).get()
      const posts = []
      for (const p of postRes.data) posts.push(await serializePost(p, openid))
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
    default:
      throw new Error('未知操作')
  }
}

async function serializeMessage(message, viewerOpenid, isOwner) {
  const from = await getUser(message.fromOpenid)
  const reveal = !message.isAnonymous
  return {
    id: message._id,
    mailboxCode: message.mailboxCode,
    content: message.content,
    createdAt: message.createdAt,
    isAnonymous: message.isAnonymous,
    from: publicUser(from, reveal || message.fromOpenid === viewerOpenid),
    isMine: message.fromOpenid === viewerOpenid,
    reply: message.reply || null
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
