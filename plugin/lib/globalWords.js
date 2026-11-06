// 全局专名词库（ADR 0077）
//
// 目的：**跨局**记住地名、店名、组织名这类专名，喂给分词器，让它别把
// 「香格里拉酒吧」切成「香格里拉 / 酒吧」。
//
// 为什么人名不进来：姓名和别名每轮已经单独灌进用户词典，再进一遍是重复占地。
//
// 为什么放自持区、不放插件数据：插件数据总共 256 KB，索引词/设置/提示词都在挤；
// 而且它是**跨局**数据，跟"这一局"无关，放 `<数据根>/global-words.json` 更干净。
//
// 淘汰：滚动 LRU —— 超过上限就按「最后命中轮次」从旧往新删。命中一次就刷成当前轮，
// 所以常用词永远活着，冷门词自然沉下去。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/** 上限：2000 条。一条约 20～30 字节（词 + 轮次），总体约 50 KB。 */
export const GLOBAL_WORDS_MAX = 2000

/** 单个词的字符上限：太长会把分词的最大词长顶大，拖慢每轮分词。 */
export const GLOBAL_WORD_MAX_CHARS = 10

export function createGlobalWords() {
  return { v: 1, map: {} }
}

/** 把一份存过的数据读成规范结构；坏的、老的都当空库。 */
export function normalizeGlobalWords(data) {
  const map = data?.map
  if (!map || typeof map !== 'object' || Array.isArray(map)) return createGlobalWords()
  const out = {}
  for (const [raw, at] of Object.entries(map)) {
    const word = String(raw ?? '').trim()
    if (!word) continue
    if ([...word].length > GLOBAL_WORD_MAX_CHARS) continue
    out[word] = Number.isInteger(at) ? at : 0
  }
  return { v: 1, map: out }
}

/**
 * 把一批专名收进词库（纯函数，返回新对象）。
 *
 * @param {object} store `createGlobalWords()` 的结构
 * @param {string[]} words 专名（只该放地名/组织/物件）
 * @param {number} turn 当前轮次，记成"最后命中"
 * @param {{max?:number}} [options]
 * @returns {{store:object, added:string[], touched:string[]}}
 */
export function addGlobalWords(store, words, turn, { max = GLOBAL_WORDS_MAX } = {}) {
  const base = normalizeGlobalWords(store).map
  const now = Number.isInteger(turn) ? turn : 0
  const limit = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : GLOBAL_WORDS_MAX

  const added = []
  const touched = []
  const next = { ...base }
  for (const raw of Array.isArray(words) ? words : []) {
    const word = String(raw ?? '').trim()
    if (!word) continue
    if ([...word].length > GLOBAL_WORD_MAX_CHARS) continue
    // 先删再插：让它回到「最新」的位置（对象键顺序就是淘汰顺序）
    delete next[word]
    next[word] = now
    if (Object.hasOwn(base, word)) touched.push(word)
    else added.push(word)
  }

  let result = next
  while (Object.keys(result).length > limit) {
    const oldest = Object.keys(result)[0]
    const trimmed = { ...result }
    delete trimmed[oldest]
    result = trimmed
  }
  return { store: { v: 1, map: result }, added, touched }
}

/**
 * 词库里的全部词，按「旧 → 新」排（喂分词时不关心顺序，只是给个稳定结果）。
 * @returns {string[]}
 */
export function globalWordList(store) {
  return Object.keys(normalizeGlobalWords(store).map)
}

/** 词库有多少条。 */
export function globalWordCount(store) {
  return globalWordList(store).length
}
