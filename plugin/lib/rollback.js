// 回退清理（B1）：整局数据里的 flags 带轮次的记录，回退后可能指向「未来的轮次」。
//
// 为什么会有未来轮次：flags（seen／left／draft／fuzzyLeft／playerBack）存在整局数据里，
// 而剧情回退只动酒馆的正文与按轮快照，不会动插件自己写的那份整局数据。
// 回退到第 3 轮后，第 5 轮记下的「某人第 5 轮露过面」就成了未来记录——
// 面板候选表会显示回退后才出现的人，冷档和模糊离场也会算错。
//
// 读数据时按当前轮次清掉即可（不写盘也不影响：每次读都会清，下次落盘自然干净）。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/**
 * 清掉 flags 里轮次大于当前轮的记录。
 *
 * @param {{flags?:object, turn?:number|null}} input
 * @returns {object} 新对象（不改原 flags）
 */
export function pruneFutureFlags({ flags = {}, turn = null } = {}) {
  const source = flags && typeof flags === 'object' ? flags : {}
  if (!Number.isInteger(turn) || turn < 1) return source
  const next = { ...source }

  for (const key of ['seen', 'draft', 'fuzzyLeft']) {
    const table = source[key]
    if (!table || typeof table !== 'object') continue
    const kept = {}
    for (const [name, at] of Object.entries(table)) {
      if (typeof at !== 'number' || at <= turn) kept[name] = at
    }
    next[key] = kept
  }

  const left = source.left
  if (left && typeof left === 'object') {
    const kept = {}
    for (const [id, record] of Object.entries(left)) {
      if (!record || typeof record.turn !== 'number' || record.turn <= turn) kept[id] = record
    }
    next.left = kept
  }

  const back = source.playerBack
  if (back && typeof back === 'object' && Number.isInteger(back.turn) && back.turn > turn) {
    delete next.playerBack
  }

  return next
}
