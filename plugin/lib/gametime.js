// 人物冷存档 · 游戏时间的两块账簿（ADR 0005）
//
// 只记录，不解析：这里的 gt 一律是**原文**（"三年五月十二日"），
// 程序不比较大小、不换算天数、不判断到期 —— 判断交给模型。
//
// 两块东西都存整局数据（不随回退变、分叉自动复制、删局自动清空）：
//
//   anchors  在场名单：人物编号 → 最后一次出现的轮次与该轮的 gt
//            每人约 30 字节。之所以每轮都要更新：**「最后一次是哪一轮」只有事后才知道**，
//            不能等到判定离场时再记。
//            ⚠️ 临时结构：将来「在场人物也进快照」时必须删掉（ADR 0005 末尾）。
//
//   pending  暂存批：资料源正在消失、必须立刻保住内容时（MVU 容灾）用。
//            同一轮的所有值**共享一条 gt**；gt 在捕获那一刻锁定，之后等多久都不变。
//            写入成功 / 作废 → 删掉该条；写入一直失败 → 满 7 轮丢弃并记提示。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx，数据进数据出。

/** 写入失败重试的硬上限（ADR 0005）。 */
export const PENDING_MAX_FAILS = 7

// ---------- 在场名单 ----------

export function createAnchors() {
  return {}
}

/** 记下某人最后一次出现的轮次与当时的 gt（覆盖旧值）。 */
export function setAnchor(anchors, personId, turn, gt) {
  return { ...(anchors ?? {}), [personId]: { turn, gt } }
}

/** 取某人的时间锚；没有返回 null。 */
export function getAnchor(anchors, personId) {
  const found = anchors?.[personId]
  if (!found || typeof found !== 'object') return null
  return { turn: found.turn, gt: found.gt }
}

export function dropAnchor(anchors, personId) {
  const next = { ...(anchors ?? {}) }
  delete next[personId]
  return next
}

// ---------- 暂存批 ----------

export function createPending() {
  return []
}

/**
 * 追加一批待写入的内容。同一轮的所有值共享这里的 gt。
 * @param {{turn:number, gt:string, reason:string, values:any[]}} batch
 */
export function addPendingBatch(pending, { turn, gt = '', reason = '', values = [] }) {
  return [...(pending ?? []), { turn, gt, reason, values, fails: 0 }]
}

/** 写入失败一次：累加重试次数。 */
export function markPendingFailed(batch) {
  return { ...batch, fails: (batch?.fails ?? 0) + 1 }
}

/** 重试次数到顶没有（默认 7 轮）。 */
export function isPendingExhausted(batch, maxFails = PENDING_MAX_FAILS) {
  return (batch?.fails ?? 0) >= maxFails
}

/** 写入成功或作废后，按轮次删掉那一批。 */
export function dropPending(pending, turn) {
  return (pending ?? []).filter((batch) => batch.turn !== turn)
}
