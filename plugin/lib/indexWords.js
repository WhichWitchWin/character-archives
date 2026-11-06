// 索引词（ADR 0021、ADR 0076、ADR 0081）
//
// 写入时由模型顺带抽出 0～2 个索引词（必须是那条内容的原文片段，程序做子串校验）。
// 存在命题第 6 位：`[id, 人物, 栏目, 内容, 起始轮, 索引词]`。
//
// 索引词跟着**命题**走而不是跟着指针走：一条命题被十个人知道也只抽一次词。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx，数据进数据出。

/** 索引词在**命题**里的位置（ADR 0081「存储结构」）。 */
export const CLAIM_WORDS_INDEX = 5

/** 索引词的类别（ADR 0077）。只有「人」不进全局专名词库。 */
export const WORD_KINDS = Object.freeze(['人', '地', '组织', '物件'])

/** 单个索引词最多几个字（ADR 0069）。 */
export const WORD_MAX_CHARS = 10

// ── 程序自动抽词（2026-11-06）──
//
// 为什么不再让模型全包：模型抽索引词要先判断"该不该抽"，既费 token 又会漏——
// 「通用职业不抽」把"收银员"挡在外面，正文聊到收银员时那条命题就召不回来。
// 程序自己分词不费力、不会漏，专门兜**通用词**；模型只负责**新专名**（分词切不准那种）。
//
// 拿不到分词器（没接、或测试环境）时返回空，行为跟以前完全一样。
let wordSegmenter = null

/** 装分词器（由 index.mjs 启动时注入；和 match.js 的 configureSegmenter 同一个套路）。 */
export function configureWordSegmenter(next) {
  wordSegmenter = next && typeof next.tokenize === 'function' ? next : null
  return wordSegmenter
}

/**
 * 泛词表：这些词在正文里到处都是，命中它们说明不了任何事。
 *
 * 为什么要这份表：真实验证发现分词会给出「提出／来到／回来／看看／主动／一圈」这类词，
 * 几乎每条命题都有，一律给分等于把打分拉平、排序失效。只挡**高频功能词与空泛动作**，
 * 不挡名词——「收银员」「超市」「药铺」这类有信息量的词必须能命中。
 */
const STOP_WORDS = new Set([
  // 高频动词／动作
  '来到', '回来', '回去', '出去', '进来', '起来', '过来', '过去', '下来', '上去',
  '看看', '想想', '说说', '试试', '提出', '提议', '决定', '开始', '继续', '准备', '打算',
  '觉得', '认为', '知道', '明白', '发现', '注意', '记得', '忘记', '觉得', '需要', '希望',
  '进行', '作为', '成为', '出现', '发生', '保持', '表示', '认为', '感觉',
  // 副词／形容词性
  '主动', '贴身', '随身', '一直', '总是', '有时', '已经', '正在', '马上', '刚才',
  '突然', '立刻', '立即', '终于', '仍然', '依然', '当然', '其实', '可能', '应该',
  '非常', '特别', '有些', '有点', '比较', '十分', '相当', '足够', '差不多',
  // 时间
  '上午', '下午', '中午', '晚上', '早晨', '清晨', '半夜', '今天', '明天', '昨天',
  '现在', '当时', '以后', '之前', '之后', '后来', '最近', '刚才', '一会', '片刻',
  // 量词／指代
  '一圈', '一次', '一下', '一点', '一些', '一种', '一个', '这个', '那个', '这些', '那些',
  '什么', '怎么', '这样', '那样', '这里', '那里', '自己', '别人', '大家', '事情', '东西',
  // 状态描述（谁都会有的，不算身份特征）
  '受伤', '生病', '死亡', '活着', '安全', '危险', '高兴', '生气', '害怕', '担心',
])

/**
 * 从一条值里自动取出「可以被正文命中的词」。
 *
 * 规则：只留 **2 字以上**的纯中文/数字词——虚词（在、的、了、他、但、当）在分词里
 * 基本都是单字，一刀切掉，连停用词表都不用建；再挡掉泛词表里的高频词。
 *
 * @param {string} text 命题的值
 * @param {Array<{词?:string}|string>} [exclude] 已有的索引词：**同一个词不重复算**
 *   （打分是「索引词命中 || 自动词命中」，本来就只加一次分；去重是为了面板不重复显示，
 *    也防止以后有人把这里改成累加。见 ADR 0107 补充）
 */
export function autoWordsOf(text, exclude = undefined) {
  const raw = String(text ?? '')
  if (!wordSegmenter || !raw) return []
  const skip = new Set()
  for (const item of Array.isArray(exclude) ? exclude : []) {
    const word = String(typeof item === 'string' ? item : item?.词 ?? '').trim()
    if (word) skip.add(word)
  }
  const out = []
  const seen = new Set()
  for (const token of wordSegmenter.tokenize(raw) ?? []) {
    const word = String(token ?? '').trim()
    if ([...word].length < 2) continue
    if ([...word].length > WORD_MAX_CHARS) continue
    if (/^\d+$/.test(word)) continue
    if (STOP_WORDS.has(word)) continue
    if (skip.has(word)) continue
    if (seen.has(word)) continue
    seen.add(word)
    out.push(word)
  }
  return out
}

/** 把一条原始索引词规整成 `{词, 类}`；不合法返回 null。 */
function normalizeWord(item) {
  const raw = typeof item === 'string' ? item : item?.词
  const word = String(raw ?? '').trim()
  if (!word) return null
  const kind = typeof item === 'object' && item !== null && WORD_KINDS.includes(item?.类) ? item.类 : null
  return { 词: word, 类: kind }
}

function wordsAt(record, index) {
  const raw = Array.isArray(record) ? record[index] : null
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const one = normalizeWord(item)
    if (!one || seen.has(one.词)) continue
    seen.add(one.词)
    out.push(one)
  }
  return out
}

/** 取一条命题自带的索引词。 */
export function wordsOfClaim(claim) {
  return wordsAt(claim, CLAIM_WORDS_INDEX)
}

function withWordsAt(record, index, words) {
  const list = Array.isArray(words) ? words.filter((item) => item?.词) : []
  const base = Array.isArray(record) ? [...record] : []

  if (!list.length) {
    if (base.length > index) {
      base[index] = undefined
      // 尾部全是空位才截断（命题的索引词是最后一格）
      while (base.length > 0 && base[base.length - 1] === undefined) base.length -= 1
    }
    return base
  }

  // 补齐前面的空洞，别让索引词落错地方
  while (base.length < index) base.push(undefined)
  base[index] = list.map((item) => ({ 词: item.词, 类: item.类 ?? null }))
  return base
}

/** 把索引词挂到一条命题上：返回**新命题**（不改原命题）。 */
export function withClaimWords(claim, words) {
  return withWordsAt(claim, CLAIM_WORDS_INDEX, words)
}

/**
 * 子串校验：索引词必须是**这条内容里出现过的原文片段**（ADR 0021，防模型幻觉）。
 * 不合格的直接丢掉；去重；超长的丢掉。
 *
 * 模型可以给纯字符串（老写法），也可以给 `{词, 类}`；字符串一律当"未分类"。
 * @param {string} valueText
 * @param {any[]} words
 * @returns {Array<{词:string, 类:string|null}>}
 */
export function filterIndexWords(valueText, words) {
  const text = String(valueText ?? '')
  if (!text) return []
  const seen = new Set()
  const kept = []
  for (const item of Array.isArray(words) ? words : []) {
    const one = normalizeWord(item)
    if (!one || seen.has(one.词)) continue
    if (!text.includes(one.词)) continue
    if ([...one.词].length > WORD_MAX_CHARS) continue
    seen.add(one.词)
    kept.push(one)
  }
  return kept
}

/**
 * 汇总**某个人知道的命题**的索引词（ADR 0082：召回一致性改成「命中他知道的事」）。
 * 只收勾选栏目。
 * @param {{claims?:any[][], personId?:string, checkedCodes?:Set<string>}} input
 * @returns {Set<string>}
 */
export function collectWordsFromClaims({ claims = [], personId, checkedCodes = undefined } = {}) {
  const words = new Set()
  for (const claim of claims ?? []) {
    if (!Array.isArray(claim)) continue
    if (claim[1] !== personId) continue
    if (checkedCodes && !checkedCodes.has(claim[2])) continue
    for (const item of wordsOfClaim(claim)) words.add(item.词)
  }
  return words
}

/**
 * 挑出**专名**：有类别、且不是「人」。
 *
 * 只有这些进全局专名词库（ADR 0077）——人名已经由姓名/别名覆盖，
 * 再进一遍是重复占地。
 * @param {Array<{词:string, 类:string|null}>} words
 * @returns {string[]}
 */
export function properNounsOf(words) {
  const out = []
  for (const item of Array.isArray(words) ? words : []) {
    if (!item?.词 || !item?.类) continue
    if (item.类 === '人') continue
    out.push(item.词)
  }
  return out
}
