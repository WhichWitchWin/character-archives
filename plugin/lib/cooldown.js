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

// ── 手动改过：豁免一次（ADR 0118）──
//
// 玩家手动加/改的东西，下一轮就该能被念到，不该被冷却压 10 轮。做法**不是**去改指针第 4 格
// （最后变动轮）——那一格还兼着「召回同分排序」与「面板人物排序」两个职责，往前拨会让它
// 反而排到后面，和"想让它快点被念"正好相反。这里另挂一张侧表 `flags.manualFree`
// （键与冷却表同格式），判定时跳过两道闸；标记**失效即删**。

/**
 * 冷却闸：这条指针这次放不放行，以及「豁免标记」该怎么处理。
 *
 * 返回三个信号，调用方按它决定删不删标记：
 *   - `pass`    这次放不放行
 *   - `drop`    标记已经没用了（本来就不冷却／冷却被关掉）→ 删掉，别留着占地方
 *   - `consume` 标记这次生效了 → 真念进提示词之后再删
 *
 * @param {object} cooldowns 冷却表
 * @param {object} manualFree 豁免标记桶（键 `pt:人物id:命题id`）
 * @param {any[]} pointer 指针
 * @param {number} turn 当前轮
 * @param {number} turns 冷却轮数
 * @returns {{pass:boolean, drop:boolean, consume:boolean}}
 */
export function cooldownGate(cooldowns, manualFree, pointer, turn, turns = DEFAULT_COOLDOWN_TURNS) {
  const cooling = isPointerCoolingDown(cooldowns, pointer, turn, turns)
  if (!Array.isArray(pointer)) return { pass: !cooling, drop: false, consume: false }
  if (!manualFree?.[pointerKey(pointer[0], pointer[1])]) return { pass: !cooling, drop: false, consume: false }
  // 本来就能念（冷却到期了／冷却被关掉）→ 标记白挂，该删
  if (!cooling) return { pass: true, drop: true, consume: false }
  // 正被冷却压着 → 这次破例
  return { pass: true, drop: false, consume: true }
}

/**
 * 把一批指针记进「手动改过、放行一次」的桶。
 *
 * 键与冷却表同格式，这样两边的清理逻辑长得一样。脏指针（不是数组、命题号不是整数）跳过。
 *
 * 值存「打标记时的轮次」（给得出 turn 时）：回退之后 `pruneFutureFlags` 要靠它清掉未来的标记。
 * 给不出轮次就存 `true`（老语义，回退清不掉但也不会误删）。
 *
 * @param {object} bucket 现有标记桶
 * @param {any[][]} pointers 受影响的那几条指针
 * @param {number} [turn] 打标记时的轮次
 */
export function markManualFree(bucket, pointers, turn = undefined) {
  const next = { ...(bucket ?? {}) }
  const stamp = Number.isInteger(turn) ? turn : true
  for (const pointer of pointers ?? []) {
    if (!Array.isArray(pointer)) continue
    if (!Number.isInteger(pointer[1])) continue
    next[pointerKey(pointer[0], pointer[1])] = stamp
  }
  return next
}

/** 删命题时清标记（所有指向它的）：命题 id 会被复用，不清会误伤新命题。 */
export function dropClaimManualFree(bucket, claimId) {
  const id = Number(claimId)
  if (!Number.isInteger(id)) return { ...(bucket ?? {}) }
  const suffix = `:${id}`
  const next = {}
  for (const [key, value] of Object.entries(bucket ?? {})) {
    if (key.endsWith(suffix)) continue
    next[key] = value
  }
  return next
}

/** 删人时清标记：这个人的所有指针一起没。 */
export function dropPersonManualFree(bucket, personId) {
  const prefix = `pt:${String(personId)}:`
  const next = {}
  for (const [key, value] of Object.entries(bucket ?? {})) {
    if (key.startsWith(prefix)) continue
    next[key] = value
  }
  return next
}

/** 删一条认知（指针）时清标记：只清那一个键。 */
export function dropPointerManualFree(bucket, personId, claimId) {
  const next = { ...(bucket ?? {}) }
  delete next[pointerKey(personId, claimId)]
  return next
}

/**
 * 删**一批**认知时清标记。
 *
 * `claimIds` 是**数字数组**——`lib/batchDelete.js` 的 `dropCognitions` 返回的就是这个形状
 * （`removed.push(id)`）。曾经按 `item.claimId` 清，键变成 `pt:p1:undefined`，
 * 一个真标记都删不掉，而且长度没变化连盘都不写（评审 2026-11-22 抓到的空转）。
 */
export function dropPointersManualFree(bucket, personId, claimIds) {
  const next = { ...(bucket ?? {}) }
  for (const claimId of claimIds ?? []) {
    const id = Number(claimId)
    if (!Number.isInteger(id)) continue
    delete next[pointerKey(personId, id)]
  }
  return next
}
