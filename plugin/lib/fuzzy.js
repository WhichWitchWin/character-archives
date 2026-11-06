// 模糊离场（ADR 0030）与「最后确认轮次」（ADR 0039）。
//
// 为什么由程序数、不问模型：一个人既然「连续 N 轮没出现」，本轮正文里也不会有他——
// 问了也是空手。程序数轮次最准。
//
// 顺带救活面板的「冷档」（沉降）：它和模糊离场用的是**同一份** `flags.seen`——
// 以前这份数据从来没被写过，两个功能一起装死；这里一写，两个都活。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { STATUS } from './snapshot.js'

/**
 * 刷新「最后确认轮次」：本轮在场上、或被正文提到的人，都记成当前轮。
 * @param {Record<string, number>} seen
 * @param {Iterable<string>} ids
 * @param {number} turn
 * @returns {Record<string, number>} 新对象（不改入参）
 */
export function markSeen(seen, ids, turn) {
  const next = { ...(seen ?? {}) }
  if (!Number.isInteger(turn) || turn < 0) return next
  for (const id of ids ?? []) {
    const key = String(id ?? '')
    if (key) next[key] = turn
  }
  return next
}

/**
 * 哪些人该判「模糊离场」：现在标着在场、这轮又不在场上、而且连续 N 轮没出现。
 *
 * 边界：**没有 `seen` 基准的人不判**——刚建档还没被记过轮次，贸然判离场会误伤。
 *
 * @param {any[][]} persons
 * @param {{seen?:object, presentIds?:Set<string>, turn?:number, turns?:number}} options
 * @returns {string[]} 要改判离场的人物编号
 */
export function fuzzyLeaveIds(persons, { seen = {}, presentIds = new Set(), turn = 0, turns = 3 } = {}) {
  const gapTurns = Number.isInteger(turns) && turns > 0 ? turns : 0
  if (!gapTurns) return []
  if (!Number.isInteger(turn)) return []

  const list = Array.isArray(persons) ? persons : []
  const ids = []
  for (const person of list) {
    if (!Array.isArray(person)) continue
    const id = String(person[0] ?? '')
    if (!id) continue
    if (person[1] !== STATUS.PRESENT) continue      // 只看现在还标着在场的
    if (presentIds.has(id)) continue                // 这轮在场上，当然不算
    const last = Number.isInteger(seen?.[id]) ? seen[id] : null
    if (last === null) continue                     // 没有基准，先不判
    if (turn - last >= gapTurns) ids.push(id)
  }
  return ids
}
