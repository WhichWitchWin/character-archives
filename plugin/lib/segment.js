// 中文分词：正向最大匹配（FMM）+ 用户词典
//
// 为什么需要：匹配层原来是纯字串包含 `text.includes(name)`。中文没有空格，
// 「周」会在「周末」里命中、「阿明」会在「阿明白了」里命中。有了词边界才判得准。
//
// **关键前提**：人名通常不在通用词表里（「老陈」「周老板」都不是标准词），
// 所以必须把已建档的姓名/别名注册进用户词典，否则「老陈」会被切成「老/陈」，
// 反而更容易误命中。
//
// 词表来源：jieba 0.42.1 `extra_dict/dict.txt.small`（MIT，见 `assets/dict/LICENSE-jieba.txt`），
// 去掉词性只留「词 词频」：10.9 万词、1.34 MB、最长 15 字。
//
// 纯逻辑模块：不读文件、不依赖酒馆接口，词表文本由调用方传进来，方便单测。
//
// 已知局限（不要指望它）：
//   · 「今日小满」里如果有人叫「小满」，照样会命中——分词只解决"词内包含"，不解决同形异义；
//   · 代称（「那老家伙」）不含名字，分词也无解。

/**
 * 用户词典（人名）的词频。
 *
 * **不能给 MAX_SAFE_INTEGER**：那样「周末」会被拆成「周|末」，因为一个词的分数
 * 比两个词还高。给一个"很高但有限"的值（100 万），既能让「老陈」整体成词压过
 * 「老+陈」，又不会压过真正的复合词。
 */
const USER_WORD_FREQ = 1_000_000

/** 连续字母／数字整体当一个词（HP50、abc123 不该被切开）。 */
const ASCII_RUN = /[A-Za-z0-9_]+/y

/** 会被跳过、不进 token 的字符（标点空白等）。 */
const SKIPPABLE = /[\s\p{P}\p{S}]/u

/**
 * 解析词表文本。格式：每行「词 词频」，空行和只有词的行也认。
 * @param {string} text
 * @returns {{size:number, maxLen:number, has:(w:string)=>boolean, freq:(w:string)=>number}}
 */
export function parseDict(text) {
  const words = new Map()
  let maxLen = 1
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [word, freqText] = trimmed.split(/\s+/)
    if (!word) continue
    const freq = Number(freqText) || 0
    words.set(word, freq)
    const length = [...word].length
    if (length > maxLen) maxLen = length
  }
  return {
    size: words.size,
    maxLen,
    has: (word) => words.has(word),
    freq: (word) => words.get(word) ?? 0,
  }
}

/**
 * 建一个分词器。
 * @param {{dictText?:string, extraWords?:string[]}} input
 *   extraWords：用户词典（已建档的姓名/别名），**优先级高于通用词表**
 */
export function createSegmenter({ dictText = '', extraWords = [] } = {}) {
  const words = new Map()
  let maxLen = 1

  for (const line of String(dictText ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [word, freqText] = trimmed.split(/\s+/)
    if (!word) continue
    words.set(word, Number(freqText) || 0)
    const length = [...word].length
    if (length > maxLen) maxLen = length
  }


  // 基础词表的规模，用来做「每多切一个词就多罚一次」的归一化
  let baseTotal = 0
  for (const freq of words.values()) baseTotal += freq
  const logTotal = Math.log(baseTotal > 0 ? baseTotal : 1)
  const baseMaxLen = maxLen

  // 用户词典单独一层，**可以随时刷新**（每轮把当前人物的姓名/别名注册进来）
  let extra = new Map()
  function setExtraWords(list) {
    extra = new Map()
    for (const raw of Array.isArray(list) ? list : []) {
      const word = String(raw ?? '').trim()
      if (word) extra.set(word, USER_WORD_FREQ)
    }
    let limit = baseMaxLen
    for (const word of extra.keys()) {
      const length = [...word].length
      if (length > limit) limit = length
    }
    maxLen = limit
    return extra.size
  }
  setExtraWords(extraWords)

  /** 查词频：用户词典优先（给最高分，保证人名永远成词）。 */
  function lookup(word) {
    if (extra.has(word)) return extra.get(word)
    return words.get(word)
  }

  /** 未登录单字的基础分：比任何真词都低，但不会被丢掉。 */
  const UNKNOWN_SCORE = Math.log(0.5)

  /** 把一个中文块切成 token（按词频动态规划，不是贪心）。 */
  function splitChunk(chunk) {
    const chars = [...chunk]
    const size = chars.length
    if (!size) return []
    // route[i] = 从 i 开始的最优解：{ score, end }
    const route = new Array(size + 1)
    route[size] = { score: 0, end: size }

    for (let i = size - 1; i >= 0; i -= 1) {
      let best = null
      const limit = Math.min(maxLen, size - i)
      for (let length = 1; length <= limit; length += 1) {
        const word = chars.slice(i, i + length).join('')
        const freq = lookup(word)
        if (freq === undefined) {
          // 词表里没有：只有单字可以"硬切"，多字候选直接跳过
          if (length !== 1) continue
          const score = UNKNOWN_SCORE - logTotal + route[i + 1].score
          if (!best || score > best.score) best = { score, end: i + 1 }
          continue
        }
        const score = Math.log(freq + 1) - logTotal + route[i + length].score
        if (!best || score > best.score) best = { score, end: i + length }
      }
      route[i] = best ?? { score: 0, end: i + 1 }
    }

    const tokens = []
    let cursor = 0
    while (cursor < size) {
      const step = route[cursor]
      tokens.push(chars.slice(cursor, step.end).join(''))
      cursor = step.end
    }
    return tokens
  }

  /**
   * 切词。返回 token 数组；标点与空白被跳过（内容不丢，只是不成词）。
   *
   * 为什么不是贪心最大匹配：贪心遇到「阿明白了」会切「阿明/白/了」，
   * 按词频算分则会选「阿/明白/了」——后者才是人话。
   * @param {string} text
   * @returns {string[]}
   */
  function tokenize(text) {
    const source = String(text ?? '')
    const tokens = []
    let buffer = ''

    const flush = () => {
      if (!buffer) return
      tokens.push(...splitChunk(buffer))
      buffer = ''
    }

    let index = 0
    const chars = [...source]
    while (index < chars.length) {
      const rest = chars.slice(index).join('')

      // 字母数字串整体切
      ASCII_RUN.lastIndex = 0
      const ascii = ASCII_RUN.exec(rest)
      if (ascii) {
        flush()
        tokens.push(ascii[0])
        index += [...ascii[0]].length
        continue
      }

      if (SKIPPABLE.test(chars[index])) {
        flush()
        index += 1
        continue
      }

      buffer += chars[index]
      index += 1
    }
    flush()
    return tokens
  }
  /**
   * 这个词在文本里**按词边界**出现了吗？
   *
   * 注意：这是"边界判断"，不是"消歧"。同一个词出现在不相干语境里照样算命中。
   * @param {string} text
   * @param {string} word
   */
  function hasWord(text, word) {
    const target = String(word ?? '').trim()
    if (!target) return false
    const want = target.toLowerCase()
    for (const token of tokenize(text)) {
      if (token.toLowerCase() === want) return true
    }
    return false
  }

  return {
    tokenize,
    hasWord,
    setExtraWords,
    get size() { return words.size + extra.size },
    get maxLen() { return maxLen },
  }
}
