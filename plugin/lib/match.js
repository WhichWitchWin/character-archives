// 文本匹配：用**中文分词**判断词边界（取代原来的「称谓表 + 边界启发式」）
//
// 为什么换：原来靠一张称谓表（老周／小周／周老板…）去猜「这个单字是不是在叫人」，
// 漏得比挡的多——「周掌柜」不在表里就认不出。分词直接给词边界，不用猜。
//
// 规则：
//   1. **命中 = 这个词在文本里按词边界出现**（分词结果里有一个 token 等于它）。
//      分词器由接线处注入（`configureSegmenter`）；没注入时退回字串包含，
//      这样纯逻辑测试和不装词表的场景仍能跑。
//   2. **单字一律只算弱证据**（singleName），永不置 name／alias ——
//      「陈老板」里的「陈」照样是独立词，单字天然不可靠。
//   3. 强证据和弱证据同时命中时 singleName 置 false：它表示「只剩弱证据」。
//   4. 索引词按词去重，子串合并（「旧港」与「旧港码头」算同一条）。
//   5. 单字索引词直接丢掉（「酒／刀／雨」到处都有，等于白送分）。
//
// **注意**：人名的词边界准确度依赖用户词典 —— 接线处每轮把当前人物的姓名/别名
// 灌进 `segmenter.setExtraWords()`，否则「老陈」会被切成「老/陈」。
//

import { splitAliases } from './names.js'
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/** 当前分词器（由接线处注入）。 */
let segmenter = null

/**
 * 注入分词器。传 null 退回字串包含。
 * @param {{hasWord:(text:string, word:string)=>boolean}|null} next
 */
export function configureSegmenter(next) {
  segmenter = next && typeof next.hasWord === 'function' ? next : null
  return segmenter
}

/** 当前有没有分词器（测试/诊断用）。 */
export function hasSegmenter() {
  return Boolean(segmenter)
}

/** 大小写折叠：英文名不该因为大小写漏掉；中文一个字都不变。 */
function fold(text) {
  return String(text ?? '').toLowerCase()
}

/**
 * 别名、索引词既能传数组，也能传快照里那种逗号串（召回词串形如 "陈先生,老陈头"）。
 * 顺手丢掉空片段 —— 空串会让判定恒真，等于把所有人都算成命中。
 */
function toTerms(value) {
  return splitAliases(value)
}

/**
 * 一个词条在文本里出现了吗。
 *
 * 有分词器 → 按词边界；没有 → 退回字串包含（旧行为，只作兜底）。
 */
function hit(text, term) {
  const target = String(term ?? '').trim()
  if (!target) return false
  if (segmenter) return segmenter.hasWord(text, target)
  return fold(text).includes(fold(target))
}

/**
 * 索引词在文本里出现了吗：**保持字串包含**。
 *
 * 索引词是自由短语（「旧港码头」「那场雨」），不在任何词表里；
 * 走分词会把它们切碎、反而全漏。它们不是"名字"，不需要词边界。
 */
function hitClue(text, term) {
  const target = String(term ?? '').trim()
  if (!target) return false
  return fold(text).includes(fold(target))
}

/** 按码位算长度：一个汉字、一个表情都算一个字。 */
function isSingleChar(name) {
  return [...String(name ?? '')].length === 1
}

/** 索引词至少两个字：单字的「酒／刀／雨」到处都有，留着只会把索引词分白送出去。 */
function isUsableClue(word) {
  return [...word].length >= 2
}

/** 索引词去重：大小写不同、或一条是另一条的子串（旧港 vs 旧港码头），都算同一条证据。 */
function dedupeClues(words) {
  const unique = [...new Map(words.map((word) => [fold(word), word])).values()]
  return unique.filter(
    (word) => !unique.some((other) => other !== word && fold(other).includes(fold(word))),
  )
}

/**
 * 合并多路命中的索引词并去重。**后传的列表在冲突时覆盖前面的**（所以把"实时"的放后面）。
 *
 * 召回时有两路来源：上一轮正文的缓存（`flags.lastHits[编号].words`）与本轮玩家输入的实时扫描。
 * 同一条词两边都提到只能算一条，否则一致性会被虚增（ADR 0042）。
 * @param {...string[]} lists
 * @returns {string[]}
 */
export function mergeClueWords(...lists) {
  const flat = []
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const word of list) {
      if (typeof word === 'string' && word.trim()) flat.push(word.trim())
    }
  }
  return dedupeClues(flat)
}

/**
 * 扫一段文本。clueHits 返回命中的索引词本身，好让上层跨段去重。
 * @param {string} text
 * @param {{name?:string, aliases?:string|string[], clueWords?:string|string[]}} person
 */
function scan(text, person = {}) {
  const subject = person ?? {}
  const name = typeof subject.name === 'string' ? subject.name.trim() : ''
  const aliases = toTerms(subject.aliases)
  const clueWords = toTerms(subject.clueWords).filter(isUsableClue)
  const singleCharName = Boolean(name) && isSingleChar(name)

  // 单字别名只算弱证据；两字以上才当真正的别名
  const weakAliases = aliases.filter(isSingleChar)
  const strongAliases = aliases.filter((alias) => !isSingleChar(alias))

  // 单字一律只算弱证据：不冒充姓名，也不冒充别名
  const singleHit = (singleCharName && hit(text, name))
    || weakAliases.some((alias) => hit(text, alias))
  const nameHit = Boolean(name) && !singleCharName && hit(text, name)
  const aliasHit = strongAliases.some((alias) => hit(text, alias))

  return {
    name: nameHit,
    alias: aliasHit,
    // 只表示「只剩弱证据」：上层照 weakOnly: result.singleName 写才不会把强命中降级
    singleName: Boolean(singleHit) && !nameHit && !aliasHit,
    clueHits: clueWords.filter((word) => hitClue(text, word)),
  }
}

/**
 * 匹配一段文本（一段正文，或玩家输入）。
 * clueWords 带命中的索引词原文——召回时要靠它挑「该给他哪几条值」（ADR 0042）。
 * @returns {{name:boolean, alias:boolean, singleName:boolean, clues:number, clueWords:string[]}}
 */
export function matchText(text, person = {}) {
  const { name, alias, singleName, clueHits } = scan(text, person)
  const clueWords = dedupeClues(clueHits)
  return { name, alias, singleName, clues: clueWords.length, clueWords }
}

/**
 * 匹配本轮的全部文本：玩家输入 + 最近几轮正文。
 * 现在两边**同一个口径**（都按词边界），不再区分「输入」与「正文」两套规则。
 * 两路命中的索引词在这里合并去重，上层不必再处理重复。
 * @returns {{name:boolean, alias:boolean, singleName:boolean, clues:number, clueWords:string[]}}
 */
export function matchPerson(person = {}, options = {}) {
  // 解构的默认值只兜 undefined，兜不住 null；接线处写 `?? null` 很常见，这里必须自己兜
  const { input = '', texts = [] } = options ?? {}
  const list = Array.isArray(texts) ? texts : [texts]
  const scans = [
    ...(input ? [scan(input, person)] : []),
    ...list.map((text) => scan(text, person)),
  ]
  const name = scans.some((item) => item.name)
  const alias = scans.some((item) => item.alias)
  const clueWords = dedupeClues(scans.flatMap((item) => item.clueHits))

  return {
    name,
    alias,
    singleName: scans.some((item) => item.singleName) && !name && !alias,
    clues: clueWords.length,
    clueWords,
  }
}
