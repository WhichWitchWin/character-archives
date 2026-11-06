// 召回冷却（ADR 0086）
//
// **粒度是指针级**：一条指针 = 某人 × 某条命题 × 一条认知。键是 `pt:人物id:命题id`。
//
// 判"这条现在能不能给"要三个盖章时机合起来看：
//   ① **建立**：指针第 4 格（最后变动轮）——`当前轮 − 它 < N` → 冷却中；
//   ② **修改**：同上，改一次就刷新；
//   ③ **召回**：冷却表里 `until > 当前轮` → 冷却中。
//
// 轮数 <= 0 表示关掉冷却，一律放行。
//
// **清理**：`pruneExpired` 到期即删——它的使命已经结束，留着只会让整局数据越积越多。
// 这样回退也安全：未到期的记录还在（冷却仍生效）；已到期的早删了（本来也该允许召回）。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx，数据进数据出。

export const DEFAULT_COOLDOWN_TURNS = 10

/** 指针级键（ADR 0086）：一个人对一条命题的一条认知。 */
export function pointerKey(personId, claimId) {
  return `pt:${personId}:${claimId}`
}

/**
 * 这条指针现在能不能给（ADR 0086）。
 *
 * @param {object} cooldowns 冷却表
 * @param {any[]} pointer 指针 `[人物id, 命题id, 来源组, 最后变动轮]`
 * @param {number} turn 当前轮
 * @param {number} turns 冷却轮数
 * @returns {boolean}
 */
export function isPointerCoolingDown(cooldowns, pointer, turn, turns = DEFAULT_COOLDOWN_TURNS) {
  if (!(turns > 0)) return false
  if (!Array.isArray(pointer)) return false
  if (!Number.isInteger(turn)) return false

  const lastTurn = Number.isInteger(pointer[3]) ? pointer[3] : 0
  if (turn - lastTurn < turns) return true

  const record = cooldowns?.[pointerKey(pointer[0], pointer[1])]
  return Boolean(record && Number.isInteger(record.until) && turn < record.until)
}

/** 删掉已经到期的记录（当前轮 ≥ 截止轮）。 */
export function pruneExpired(cooldowns, turn) {
  const next = {}
  for (const [key, record] of Object.entries(cooldowns ?? {})) {
    if (record.until > turn) next[key] = record
  }
  return next
}
