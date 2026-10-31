// 人物冷存档 · 字典（设计稿 §4.3 收录规则、§4.5 存储与索引、§4.6 滚动回收）
//
// 用整数下标代替号码：字典就是两个并行数组，下标即号码。
// 值位置靠 JSON 类型区分：字符串＝原文，数字＝字典下标（§4.3）。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx，数据进数据出，本地可单测。

export const TYPE = Object.freeze({
  PERSON: 1, // 人名 —— 不收录（人工只出现一次，收益小、麻烦多，§4.3）
  PLACE: 2,  // 地名 —— 不收录
  MVU: 3,    // MVU 值 —— 不收录
  COMMON: 4, // 常用词 —— 只有这一类会进字典
})

const NEVER_COLLECT_TYPES = new Set([TYPE.PERSON, TYPE.PLACE, TYPE.MVU])

// 设计稿点名的常见虚词短句。少于 4 个汉字本来就被长度规则拦住，这里只防更长的。
const STOPWORDS = new Set(['什么', '可以', '不是'])

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff]/g
// 「含数字的混合串」里的数字，中文数字也算（设计稿的例子就有「三天后」）
const DIGIT_CHAR = /[0-9０-９零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾]/

/**
 * 这个词值不值得进字典。
 * @returns {'now' 首次出现就收 | 'second' 第二次出现才收 | 'never' 永不收录}
 */
export function classify(text, type = TYPE.COMMON) {
  if (NEVER_COLLECT_TYPES.has(type)) return 'never'

  const value = String(text ?? '').trim()
  if (!value) return 'never'

  // 纯英文、纯标点、纯符号：一个汉字都没有
  const chinese = value.match(CJK_CHAR)?.length ?? 0
  if (chinese === 0) return 'never'

  if (DIGIT_CHAR.test(value)) return 'never'
  if (STOPWORDS.has(value)) return 'never'

  if (chinese > 8) return 'now'
  if (chinese >= 4) return 'second'
  return 'never'
}

/** 空字典的落盘形状。 */
export function createDictionary() {
  return { v: 1, d: [], t: [] }
}

/**
 * 从落盘数据打开字典，同时重建反向索引（不落盘，加载时临时构造，§4.5）。
 * 坏数据一律退回空字典，不抛错 —— 存档坏了也不该让插件崩。
 */
export function openDictionary(raw) {
  const words = []
  const types = []
  if (raw && typeof raw === 'object' && Array.isArray(raw.d)) {
    const sourceTypes = Array.isArray(raw.t) ? raw.t : []
    raw.d.forEach((word, index) => {
      if (typeof word !== 'string' || !word) return
      words.push(word)
      types.push(typeof sourceTypes[index] === 'number' ? sourceTypes[index] : TYPE.COMMON)
    })
  }
  return new Dictionary(words, types)
}

class Dictionary {
  #words
  #types
  #index = new Map()   // 文字 → 号码，重建后可 O(1) 查找
  #seen = new Map()    // 还没收录的词出现过几次（内存态，不落盘）

  constructor(words, types) {
    this.#words = words
    this.#types = types
    words.forEach((word, index) => {
      if (!this.#index.has(word)) this.#index.set(word, index)
    })
  }

  get size() {
    return this.#words.length
  }

  /** 已收录词条的号码；没有则 -1。 */
  indexOf(text) {
    const found = this.#index.get(String(text ?? '').trim())
    return found === undefined ? -1 : found
  }

  /**
   * 把一句话编码成快照里的「值位置」：
   * 数字＝字典下标，字符串＝原文。不值得收的词永远返回原文。
   */
  encode(text, type = TYPE.COMMON) {
    const value = String(text ?? '')
    const key = value.trim()
    const mode = classify(value, type)
    if (mode === 'never') return value

    const existing = this.#index.get(key)
    if (existing !== undefined) return existing

    if (mode === 'second') {
      const times = (this.#seen.get(key) ?? 0) + 1
      this.#seen.set(key, times)
      if (times < 2) return value
    }

    const index = this.#words.push(key) - 1
    this.#types[index] = type
    this.#index.set(key, index)
    return index
  }

  /** 把快照里的「值位置」还原成文字。越界或类型不对返回 null，由调用方兜底。 */
  decode(value) {
    if (typeof value === 'number') return this.#words[value] ?? null
    if (typeof value === 'string') return value
    return null
  }

  /** 落盘形状（深拷贝，改它不影响字典本身）。 */
  snapshot() {
    return { v: 1, d: [...this.#words], t: [...this.#types] }
  }

  /**
   * 可以回收的下标：任何现存快照都没引用它（§4.6）。
   * 升序返回 —— 因为新增即 push，排在前面的就是最早收录的。
   */
  unusedSlots(referenced = new Set()) {
    const used = referenced instanceof Set ? referenced : new Set(referenced)
    const slots = []
    for (let index = 0; index < this.#words.length; index += 1) {
      if (!used.has(index)) slots.push(index)
    }
    return slots
  }

  /**
   * 原地替换一个下标的内容（§4.6）。
   * 下标不变，所以不会让任何快照解码错位 —— 前提是调用方已确认该下标无人引用。
   */
  replaceAt(index, text, type = TYPE.COMMON) {
    const old = this.#words[index]
    if (old === undefined) throw new RangeError(`字典下标越界：${index}`)

    if (this.#index.get(old) === index) this.#index.delete(old)

    const key = String(text ?? '').trim()
    this.#words[index] = key
    this.#types[index] = type
    this.#index.set(key, index)
  }
}
