// 模糊建档表：程序扫 + 清理（ADR 0036、ADR 0075）
//
// ADR 0036 定的是：**程序扫是主路径**，模型报只是兜底。
// 这个模块负责主路径，以及两件卫生工作：建档之后把人从表里摘掉（`pruneDraft`）、
// 太久没露面的人清出去（`expireDraft`，否则这张表只进不出、越攒越大）。
//
// 为什么扫的时候要复用 `matchText`：名字匹配有一套既有规则（单字名只认称谓、
// 归一化全半角、跳过标点），模糊建档没理由另写一套——另写就会两边不一致。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { matchText } from './match.js'

/**
 * 扫本轮正文，挑出**真的出现了**的模糊建档人物。
 *
 * 为什么要过滤：整张表可能有几百个名字，全塞进判定素材会让模型"看谁都像"
 * （ADR 0033 的同一个毛病）。只列本轮出现的。
 *
 * @param {Record<string, number>} draft `{姓名: 最后一次露面的轮次}`
 * @param {string} text 本轮正文
 * @returns {string[]} 命中的名字（保持表里的顺序）
 */
export function scanDraft(draft, text) {
  const body = typeof text === 'string' ? text : ''
  if (!body.trim()) return []
  if (!draft || typeof draft !== 'object') return []

  const hits = []
  for (const name of Object.keys(draft)) {
    const trimmed = String(name ?? '').trim()
    if (!trimmed) continue
    // 用和召回完全一样的口径：正文里单字名只认称谓（「周老板」算，「周末」不算）
    // ⚠️ 单字名的命中落在 `singleName` 里，`name` 恒为 false（ADR 0010），两个都要看
    const result = matchText(body, { name: trimmed })
    if (result.name || result.singleName) hits.push(name)
  }
  return hits
}

/**
 * 把已经建档的人从模糊建档表里摘掉。
 *
 * 不摘的后果：同一个人会同时出现在【本轮提到的人】和【模糊建档】两段素材里，
 * 模型会当成两个人，反复给你报「建档」。
 *
 * @param {Record<string, number>} draft
 * @param {any[][]} persons 快照里的人物数组
 * @returns {{draft: Record<string, number>, removed: string[]}}
 */
export function pruneDraft(draft, persons) {
  const source = draft && typeof draft === 'object' ? draft : {}
  const known = new Set()
  for (const person of Array.isArray(persons) ? persons : []) {
    const name = String(person?.[2] ?? '').trim()
    if (name) known.add(name)
    for (const alias of String(person?.[3] ?? '').split(',').map((item) => item.trim()).filter(Boolean)) {
      known.add(alias)
    }
  }

  const next = {}
  const removed = []
  for (const [name, turn] of Object.entries(source)) {
    if (known.has(String(name).trim())) removed.push(name)
    else next[name] = turn
  }
  return { draft: removed.length ? next : { ...source }, removed }
}

/** 上限默认值：连续 3 轮没露面就清掉（ADR 0075）。设置项在 `draft.maxIdleTurns`。 */
export const DEFAULT_MAX_IDLE = 3

/**
 * 按「多久没露面」清理模糊建档表（ADR 0075）。
 *
 * 值的含义从「入表轮次」改成了「**最后一次露面的轮次**」：
 * 入表时＝当前轮，之后每轮命中正文就刷成当前轮。一个整数同时回答两件事：
 *   · 面板要显示的「已经几轮没露面」＝ now − 值；
 *   · 该不该清掉＝ now − 值 ≥ 上限。
 * 不另开计数字段，是因为这张表要尽量小，而一个整数够用了。
 *
 * @param {Record<string, number>} draft
 * @param {{hits?: string[], turn?: number, maxIdle?: number}} options
 *   hits：本轮正文里命中的名字（`scanDraft` 的产物）
 *   turn：当前轮次
 *   maxIdle：连续多少轮没露面就清掉（最小 1，默认 5）
 * @returns {{draft: Record<string, number>, removed: string[], touched: string[]}}
 */
export function expireDraft(draft, { hits = [], turn = 0, maxIdle = DEFAULT_MAX_IDLE } = {}) {
  const source = draft && typeof draft === 'object' ? draft : {}
  const hitSet = new Set(
    (Array.isArray(hits) ? hits : []).map((item) => String(item ?? '').trim()).filter(Boolean),
  )
  const now = Number.isInteger(turn) ? turn : 0
  // 上限至少按 1 算：设成 0 会把刚入表的人当轮就删掉，那不是清理是失控
  const idle = Number.isFinite(maxIdle) ? Math.max(1, Math.floor(maxIdle)) : DEFAULT_MAX_IDLE

  const next = {}
  const removed = []
  const touched = []
  for (const [name, at] of Object.entries(source)) {
    // 露过面就把时间戳推到现在
    const stamp = hitSet.has(String(name).trim()) ? now : at
    if (stamp !== at) touched.push(name)
    // 轮次不是整数的（老数据、手动写坏的）一律放过：清理不该误伤来历不明的东西
    if (Number.isInteger(stamp) && now - stamp >= idle) {
      removed.push(name)
      continue
    }
    next[name] = stamp
  }
  return { draft: next, removed, touched }
}
