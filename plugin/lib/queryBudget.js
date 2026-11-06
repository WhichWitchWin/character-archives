// 正文模型查档案的次数账本（2026-11-06）
//
// 为什么要有：`archive_query` 不限次数的话，模型一轮能连查十几次，
// 把上下文预算全吃掉，反而挤掉正文。定死每轮最多 2 次。
//
// 账按「局 + 轮」记：轮次一变就自动清零，不需要任何清理逻辑——
// 每局只留最后一条记录，内存不会涨。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/** 每轮最多查几次（改这里同时改提示词与工具描述里的文案）。 */
export const MAX_QUERY_PER_TURN = 2

/**
 * 造一个计数器：`take(gameId, turn)` 拿到名额返回 true，超了返回 false。
 * @param {number} [max] 每轮上限，默认 2
 */
export function createQueryCounter(max = MAX_QUERY_PER_TURN) {
  const limit = Number.isInteger(max) && max > 0 ? max : MAX_QUERY_PER_TURN
  const book = new Map()

  return {
    limit,
    /**
     * 取一个名额。
     * @param {string} gameId
     * @param {number} turn 当前轮（结算轮次）；认不出就按 0 算
     * @returns {boolean} 还能查就是 true
     */
    take(gameId, turn) {
      const key = String(gameId ?? '')
      if (!key) return false
      const now = Number.isInteger(turn) ? turn : 0
      const prev = book.get(key)
      if (!prev || prev.turn !== now) {
        book.set(key, { turn: now, count: 1 })
        return true
      }
      if (prev.count >= limit) return false
      prev.count += 1
      return true
    },
    /** 这一局这一轮已经查了几次（调试/测试用）。 */
    used(gameId, turn) {
      const prev = book.get(String(gameId ?? ''))
      if (!prev) return 0
      return prev.turn === (Number.isInteger(turn) ? turn : 0) ? prev.count : 0
    },
  }
}
