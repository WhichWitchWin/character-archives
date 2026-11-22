// 召回冷却（ADR 0086）
//
// **粒度是指针级**：一条指针 = 某人 × 某条命题 × 一条认知。键是 `pt:人物id:命题id`。
//
// 判"这条现在能不能给"**只看召回/查询盖章**：冷却表里 `until > 当前轮` → 冷却中。
//
// 2026-11-22 起不再按「建立/修改」盖章（ADR 0115）：新建或刚改过的指针**立刻可见**，
// 等它真被注入过一次才进冷却。旧口径的副作用是"玩家手动加的内容 10 轮内既召不回来也查不到"，
// 而模型查过一次没看到新东西就不肯再查——新内容等于被静默吞掉。
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
 * 这条指针现在能不能给（ADR 0086，2026-11-22 改了盖章口径）。
 *
 * **只认「召回/查询盖章」**：新建或刚改过的指针**立刻可见**，等它真被注入过一次
 * （召回、或模型/面板查档）才进冷却。
 *
 * 为什么砍掉「建立/修改」那一格：玩家在面板手动加一条内容，本来是想让它尽快生效，
 * 但旧口径按「最后变动轮」算，接下来 N 轮（默认 10）自动召回不念、详细档也查不到——
 * 表现为「我明明写了，模型就是不知道」，而且模型自己查过一次没看到新东西，就不肯再查。
 * 代价是"刚写进去的内容下一轮可能被念回来"（略显啰嗦），换来"写了立刻能看到"。
 *
 * @param {object} cooldowns 冷却表
 * @param {any[]} pointer 指针 `[人物id, 命题id, 来源组, 最后变动轮]`
 * @param {number} turn 当前轮
 * @param {number} turns 冷却轮数（0＝关）
 * @returns {boolean}
 */
export function isPointerCoolingDown(cooldowns, pointer, turn, turns = DEFAULT_COOLDOWN_TURNS) {
  if (!(turns > 0)) return false
  if (!Array.isArray(pointer)) return false
  if (!Number.isInteger(turn)) return false

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

/**
 * 清掉某条命题的所有冷却记录（删命题时调用）。
 *
 * 为什么需要：命题 id 是「现有最大 +1」（`claims.js` 的 `nextClaimId`），所以删掉最高号命题后，
 * 下一个新命题会**拿到同一个号**。冷却键 `pt:人物:命题id` 只按到期时间清，不认命题换过没有——
 * 新命题恰好复用旧号、又被同一个人知道，那条新指针就会被上一世的冷却无故压住最多 N 轮。
 * 表现为「数据看着都对，召回却少了一条」，很难查。
 *
 * @param {object} cooldowns 冷却表
 * @param {number} claimId 要清掉的命题 id
 */
export function dropClaimCooldowns(cooldowns, claimId) {
  const id = Number(claimId)
  const next = {}
  if (!Number.isInteger(id)) return { ...(cooldowns ?? {}) }
  const suffix = `:${id}`
  for (const [key, record] of Object.entries(cooldowns ?? {})) {
    if (key.endsWith(suffix)) continue
    next[key] = record
  }
  return next
}
