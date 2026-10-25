const PROMPTS = [
  '今天过得怎么样？',
  '有句一直没说出口的话？',
  '最近在为什么事犹豫？',
  '这周最想被问的一件事？',
  '如果只能问一个问题，你会问自己什么？',
  '有什么一直想认真回答、却很少被问到的？'
]

function randomPrompt() {
  return PROMPTS[Math.floor(Math.random() * PROMPTS.length)]
}

module.exports = { PROMPTS, randomPrompt }
