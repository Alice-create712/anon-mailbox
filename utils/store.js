const { uid, now, hashPhone } = require('./util')

const KEY = 'anonbox_v2'

function blank() {
  return {
    seq: 0,
    users: [],
    mailboxes: [],
    messages: [],
    posts: [],
    comments: [],
    contacts: [],
    follows: [],
    reports: [],
    notices: [],
    seeded: false
  }
}

function read() {
  const data = wx.getStorageSync(KEY)
  if (data && typeof data === 'object') return data
  return blank()
}

function write(data) {
  wx.setStorageSync(KEY, data)
}

function ensureSeed(db) {
  if (db.seeded) return db
  db.seeded = true
  const demoA = {
    id: 'demo_forest',
    nickname: '林间信箱',
    avatarUrl: '',
    phoneHash: hashPhone('13800000001'),
    mailboxCode: 1,
    recentCodes: [1],
    notifyLetter: false,
    notifyReply: false,
    createdAt: now() - 86400000 * 6
  }
  const demoB = {
    id: 'demo_night',
    nickname: '夜航者',
    avatarUrl: '',
    phoneHash: hashPhone('13800000002'),
    mailboxCode: 2,
    recentCodes: [2],
    notifyLetter: false,
    notifyReply: false,
    createdAt: now() - 86400000 * 4
  }
  db.users.push(demoA, demoB)
  db.seq = 2
  db.mailboxes.push(
    {
      code: 1,
      ownerId: demoA.id,
      title: '林间信箱',
      intro: '把想说又不好意思说的话，放进这里。',
      createdAt: demoA.createdAt,
      messageCount: 1,
      paused: false,
      mutedWords: [],
      topic: '最近有没有一直没说出口的话'
    },
    {
      code: 2,
      ownerId: demoB.id,
      title: '夜航者的提问箱',
      intro: '匿名提问、认真回复。',
      createdAt: demoB.createdAt,
      messageCount: 1,
      paused: false,
      mutedWords: [],
      topic: ''
    }
  )
  db.messages.push(
    {
      id: uid('msg'),
      mailboxCode: 1,
      fromId: demoB.id,
      isAnonymous: true,
      content: '最近有没有一件事，你很想对谁说，却一直没开口？',
      createdAt: now() - 86400000 * 2,
      archived: false,
      later: false,
      read: true,
      reply: {
        content: '有。所以才做了这个信箱。',
        createdAt: now() - 86400000 * 1,
        visibility: 'mailbox'
      }
    },
    {
      id: uid('msg'),
      mailboxCode: 2,
      fromId: demoA.id,
      isAnonymous: true,
      content: '如果今天只能问一个问题，你会问自己什么？',
      createdAt: now() - 86400000,
      archived: false,
      later: false,
      read: false,
      reply: null
    }
  )
  db.posts.push(
    {
      id: uid('post'),
      authorId: demoA.id,
      mailboxCode: 1,
      isAnonymous: true,
      content: '有人愿意听一句没头没尾的话：其实我今天过得还不错。',
      createdAt: now() - 3600000 * 8
    },
    {
      id: uid('post'),
      authorId: demoB.id,
      mailboxCode: 2,
      isAnonymous: true,
      content: '匿名不是躲避，只是想把问题问得更诚实一点。',
      createdAt: now() - 3600000 * 3
    }
  )
  db.comments.push({
    id: uid('cmt'),
    postId: db.posts[0].id,
    fromId: demoB.id,
    isAnonymous: true,
    content: '那这句也算被接到了。',
    createdAt: now() - 3600000 * 6
  })
  return db
}

function load() {
  const db = ensureSeed(read())
  write(db)
  return db
}

function save(mutator) {
  const db = load()
  const next = mutator(db) || db
  write(next)
  return next
}

function currentUserId() {
  return wx.getStorageSync('anonbox_uid') || ''
}

function setCurrentUserId(id) {
  wx.setStorageSync('anonbox_uid', id)
}

module.exports = {
  load,
  save,
  currentUserId,
  setCurrentUserId,
  hashPhone,
  uid,
  now
}
