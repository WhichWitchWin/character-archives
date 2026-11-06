// 人物冷存档 · 字典（设计稿 §4.3 收录规则、§4.5 存储与索引、§4.6 滚动回收）
//
// 用整数下标代替号码：字典就是两个并行数组，下标即号码。
// 值位置靠 JSON 类型区分：字符串＝原文，数字＝字典下标（§4.3）。
//
// 收录规则（ADR 0006 按「暂定 B」+「首次就收」定稿）：
//   - 超过 8 个汉字 → 一律收，含数字也收（长句收益最大，别被一个「一」误杀）；
//   - 4～8 个汉字 → 含数字的不收（时间/数量短语），其余首次出现就收；
//   - 少于 4 个汉字、纯英文、纯标点、空白 → 不收；
//   - 人名、地名、MVU 值 → 永不收录（姓名按原文存快照，§4.1）。
//
// 读存档的铁律：**下标就是号码，号码绝不能挪**。坏槽位保留占位（解出 null），
// 绝不压缩数组 —— 压缩会让后面每个下标换一个内容，历史快照会解出语法正常、
// 语义完全无关的句子（§4.6 亲口警告过的失效）。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

export const TYPE = Object.freeze({
  PERSON: 1, // 人名 —— 不收录
  PLACE: 2,  // 地名 —— 不收录
  MVU: 3,    // MVU 值 —— 不收录
  COMMON: 4, // 常用词 —— 只有这一类会进字典
})

export const DICTIONARY_VERSION = 1

const NEVER_COLLECT_TYPES = new Set([TYPE.PERSON, TYPE.PLACE, TYPE.MVU])

// 设计稿点名的常见虚词短句。少于 4 个汉字本来就被长度规则拦住，这里只防更长的。
const STOPWORDS = new Set(['什么', '可以', '不是'])

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff]/g
// 「含数字的混合串」里的数字，中文数字也算（设计稿的例子就有「三天后」）
const DIGIT_CHAR = /[0-9０-９零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾]/

/**
 * 这个词值不值得进字典。
 * @returns {'now' 首次出现就收 | 'never' 永不收录}
 */
export function classify(text, type = TYPE.COMMON) {
  if (NEVER_COLLECT_TYPES.has(type)) return 'never'

  const value = String(text ?? '').trim()
  if (!value) return 'never'

  // 纯英文、纯标点、纯符号：一个汉字都没有
  const chinese = value.match(CJK_CHAR)?.length ?? 0
  if (chinese === 0) return 'never'
  if (chinese < 4) return 'never'
  if (STOPWORDS.has(value)) return 'never'

  // 长句一律收：为一两个数字字符放弃整句，不划算
  if (chinese > 8) return 'now'

  // 4～8 个汉字的短句里，含数字的多半是时间/数量短语，不收
  if (DIGIT_CHAR.test(value)) return 'never'
  return 'now'
}

/** 空字典的落盘形状。 */
export function createDictionary() {
  return { v: DICTIONARY_VERSION, d: [], t: [] }
}

/**
 * 从落盘数据打开字典，同时重建反向索引（不落盘，加载时临时构造，§4.5）。
 * 坏槽位保留占位，**绝不压缩**（压缩 = 让后面所有下标错位）。
 * 整份结构不可用时才退回空字典。字典自带 v，高于当前时转为只读（§4.8）。
 */
export function openDictionary(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.d) ? raw : null
  const words = source ? source.d.map((word) => (typeof word === 'string' && word ? word : null)) : []
  const sourceTypes = source && Array.isArray(source.t) ? source.t : []
  const types = words.map((_, index) => (typeof sourceTypes[index] === 'number' ? sourceTypes[index] : TYPE.COMMON))
  const version = source && Number.isInteger(source.v) ? source.v : DICTIONARY_VERSION
  return new Dictionary(words, types, version > DICTIONARY_VERSION)
}

class Dictionary {
  #words
  #types
  #readOnly
  #index = new Map()   // 文字 → 号码，重建后可 O(1) 查找

  constructor(words, types, readOnly = false) {
    this.#words = words
    this.#types = types
    this.#readOnly = readOnly
    words.forEach((word, index) => {
      if (word && !this.#index.has(word)) this.#index.set(word, index)
    })
  }

  get size() {
    return this.#words.length
  }

  /** 字典版本高于插件：只读，不再收录新词（§4.8「拒绝参与写入」）。 */
  get readOnly() {
    return this.#readOnly
  }

  /** 已收录词条的号码；没有则 -1。 */
  indexOf(text) {
    const found = this.#index.get(String(text ?? '').trim())
    return found === undefined ? -1 : found
  }

  /**
   * 把一句话编码成快照里的「值位置」：
   * 数字＝字典下标，字符串＝原文。不值得收的词、只读字典，都返回原文。
   */
  encode(text, type = TYPE.COMMON) {
    const value = String(text ?? '')
    const key = value.trim()

    const existing = this.#index.get(key)
    if (existing !== undefined) return existing

    if (classify(value, type) !== 'now') return value
    if (this.#readOnly) return value

    const index = this.#words.push(key) - 1
    this.#types[index] = type
    this.#index.set(key, index)
    return index
  }

  /** 把快照里的「值位置」还原成文字。坏槽位、越界、类型不对都返回 null，由调用方兜底。 */
  decode(value) {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) return null
      return this.#words[value] ?? null
    }
    if (typeof value === 'string') return value
    return null
  }

  /** 落盘形状（深拷贝，改它不影响字典本身）。坏槽位以 null 占位，长度不变。 */
  snapshot() {
    return { v: DICTIONARY_VERSION, d: [...this.#words], t: [...this.#types] }
  }

  /**
   * 可以回收的下标：任何现存快照都没引用它（§4.6）。
   * 升序返回 —— 因为新增即 push，排在前面的就是最早收录的。
   * 引用集只来自命题内容里的数字（原文存字典下标时才是数字）。
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
   * 只读字典直接拒绝写入。
   */
  replaceAt(index, text, type = TYPE.COMMON) {
    if (this.#readOnly) throw new Error('字典版本高于插件，已转为只读')
    const old = this.#words[index]
    if (old === undefined) throw new RangeError(`字典下标越界：${index}`)

    if (this.#index.get(old) === index) this.#index.delete(old)

    const key = String(text ?? '').trim()
    this.#words[index] = key
    this.#types[index] = type
    this.#index.set(key, index)
  }
}
