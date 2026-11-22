// 条目锁 / 值锁（ROADMAP M5-6、ADR 0037 / 0038）
//
// 三层：人物 → 条目（栏目）→ 值（命题）。锁只管**写入**，召回照常注入。
//
// **不允许「子比父宽」**：人物锁上时，他下面的条目与值一律算锁住。
// 为什么：否则面板会出现「人物锁着、某个条目显示未锁」，玩家以为能改、实际不能，
// 是比"少一个自由度"更糟的困惑。想单独解锁某条，先解人物锁。
//
// 存储（都在整局数据里：不回退、不写快照）：
//   flags.lock        = { p7: true }        人物锁（已有）
//   flags.lockEntries = { "p7:a": true }    条目锁（人物 × 栏目码）
//   flags.lockClaims  = { "12": true }      值锁（命题 id——命题全局唯一一份，
//                                           改它就是改所有人看到的内容，锁它才是真保护）
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

const SEP = ':'

/** 条目锁的键：`p7:a`。 */
export function entryLockKey(personId, code) {
  return `${String(personId)}${SEP}${String(code)}`
}

/** 这个人的整本档案是不是锁了。 */
export function isPersonLocked(locks, personId) {
  return locks?.lock?.[personId] === true
}

/** 这一栏（某人的某栏目）是不是锁了——人物锁上时整栏都算锁。 */
export function isEntryLocked(locks, { personId, code } = {}) {
  if (isPersonLocked(locks, personId)) return true
  return locks?.lockEntries?.[entryLockKey(personId, code)] === true
}

/** 这条命题是不是锁了。ownerId 给它所属的人：那个人锁上时，他的命题也算锁。 */
export function isClaimLocked(locks, { claimId, ownerId } = {}) {
  if (ownerId && isPersonLocked(locks, ownerId)) return true
  return locks?.lockClaims?.[String(claimId)] === true
}

/**
 * 谁锁的：`'person'` / `'entry'` / `'claim'` / `null`。
 * 按最上层报——面板据此显示「随人物锁」「随栏目锁」这类提示。
 */
export function lockReasonFor(locks, { personId, code, claimId } = {}) {
  if (!locks) return null
  if (personId && isPersonLocked(locks, personId)) return 'person'
  if (personId && code && locks?.lockEntries?.[entryLockKey(personId, code)] === true) return 'entry'
  if (claimId !== undefined && claimId !== null && locks?.lockClaims?.[String(claimId)] === true) return 'claim'
  return null
}

/** 切换一把锁：没有就加、有就删。返回切换后的状态（true＝已锁）。 */
export function toggleFlag(bucket, key) {
  if (bucket[key] === true) {
    delete bucket[key]
    return false
  }
  bucket[key] = true
  return true
}

/**
 * 命题被**真正删掉**时，把它号的锁一并清掉。
 *
 * 为什么必须清：`nextClaimId` 是「当前最大值 + 1」，删掉最大号之后新命题会拿到同一个号。
 * 留着旧号的锁，玩家会看到一条从没锁过的值莫名其妙显示 🔒、模型也写不进去。
 * 回退**不走这里**（回退时会话回到旧轮，那个号在那条时间线上还存在），
 * 靠调用方按当前快照过滤锁桶即可——这样回到那条线时锁会自动恢复。
 *
 * @returns {{bucket:object, dropped:number}}
 */
export function dropClaimLocks(bucket, claimIds) {
  const ids = new Set((Array.isArray(claimIds) ? claimIds : [claimIds]).map((id) => String(id)))
  const next = {}
  let dropped = 0
  for (const [key, value] of Object.entries(bucket ?? {})) {
    if (ids.has(String(key))) {
      dropped += 1
      continue
    }
    next[key] = value
  }
  return { bucket: next, dropped }
}
