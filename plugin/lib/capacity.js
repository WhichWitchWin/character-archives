// 人物冷存档 · 容量（设计稿 §3.2 上限、§3.3 写入策略、§3.4 每局总量删除规则、§3.5 容量兜底）
//
// 新版口径（用户 2026-10-31 改稿）：
//   - 8 MB 总量：**不再看变化率**，一律按最早轮次删；95% 提示、98% 自动删最早 10 份
//   - 单条 64 KB：**没有 80% 自动清理**；95% 提示、97% 着重提示 + 一键清理（清到 90% 以下）、99% 拒绝写入
//   - 整局数据 256 KB：>90% 触发一次全量扫描回收、95% 着重提示；**不停止收录**
//   - 快照条数 2000：1900 提示、1999 删最早 100 份
//
// 水位统一返回对象而不是单个字符串档位：高档位同时带着低档位的动作 ——
// 99% 既该拒写、也该清理，只回一个 'reject' 会让调用方漏掉清理。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

export const CAPACITY = Object.freeze({
  SNAPSHOT_BYTES: 64 * 1024,          // 单条快照上限
  GAME_TOTAL_BYTES: 8 * 1024 * 1024,  // 每插件每局总量
  GAME_DATA_BYTES: 256 * 1024,        // 整局数据上限（字典、锁、索引、anchors、pending 都在里面）
  RECORD_LIMIT: 2000,                 // 每局快照条数上限

  SNAPSHOT_WARN_PERCENT: 95,          // 提示板记「人物册即将溢出」
  SNAPSHOT_CLEAN_PERCENT: 97,         // 着重提示 + 一键自动清理
  SNAPSHOT_CLEAN_TARGET_PERCENT: 90,  // 清到 90% 以下才停
  SNAPSHOT_REJECT_PERCENT: 99,        // 拒绝一切新增

  GAME_TOTAL_NOTICE_PERCENT: 95,      // 提示可用「压缩人物册历史」
  GAME_TOTAL_PRUNE_PERCENT: 98,       // 自动删最早 N 份
  GAME_TOTAL_PRUNE_COUNT: 10,

  GAME_DATA_SCAN_PERCENT: 90,         // 严格大于这个数才扫描
  GAME_DATA_URGENT_PERCENT: 95,       // 着重提示，等冷存储

  RECORD_WARN: 1900,                  // 提示「快照数量接近上限」
  RECORD_PRUNE_AT: 1999,              // 删最早 N 份
  RECORD_PRUNE_COUNT: 100,
})

/**
 * 单条快照水位。
 * @returns {{level:'ok'|'notice'|'urgent'|'reject', warn:boolean, needsClean:boolean, rejectWrites:boolean}}
 */
export function snapshotPressure(bytes, limit = CAPACITY.SNAPSHOT_BYTES) {
  const rejectWrites = atLeast(bytes, limit, CAPACITY.SNAPSHOT_REJECT_PERCENT)
  const needsClean = rejectWrites || atLeast(bytes, limit, CAPACITY.SNAPSHOT_CLEAN_PERCENT)
  const warn = needsClean || atLeast(bytes, limit, CAPACITY.SNAPSHOT_WARN_PERCENT)
  const level = rejectWrites ? 'reject' : needsClean ? 'urgent' : warn ? 'notice' : 'ok'
  return { level, warn, needsClean, rejectWrites }
}

/**
 * 每局总量水位。
 * @returns {{level:'ok'|'notice'|'prune', suggestCompact:boolean, autoPrune:boolean}}
 */
export function gameTotalPressure(bytes, limit = CAPACITY.GAME_TOTAL_BYTES) {
  const autoPrune = atLeast(bytes, limit, CAPACITY.GAME_TOTAL_PRUNE_PERCENT)
  const suggestCompact = autoPrune || atLeast(bytes, limit, CAPACITY.GAME_TOTAL_NOTICE_PERCENT)
  const level = autoPrune ? 'prune' : suggestCompact ? 'notice' : 'ok'
  return { level, suggestCompact, autoPrune }
}

/**
 * 整局数据水位（严格大于 90% 才扫描）。
 * @returns {{level:'ok'|'scan'|'urgent', scan:boolean, urgent:boolean}}
 */
export function gameDataPressure(bytes, limit = CAPACITY.GAME_DATA_BYTES) {
  const urgent = atLeast(bytes, limit, CAPACITY.GAME_DATA_URGENT_PERCENT)
  const scan = urgent || bytes * 100 > limit * CAPACITY.GAME_DATA_SCAN_PERCENT
  const level = urgent ? 'urgent' : scan ? 'scan' : 'ok'
  return { level, scan, urgent }
}

/**
 * 快照条数水位。
 * @returns {{level:'ok'|'warn'|'prune', warn:boolean, prune:boolean}}
 */
export function recordPressure(count) {
  const prune = count >= CAPACITY.RECORD_PRUNE_AT
  const warn = prune || count >= CAPACITY.RECORD_WARN
  const level = prune ? 'prune' : warn ? 'warn' : 'ok'
  return { level, warn, prune }
}

/**
 * 挑出最早轮次的若干份快照（§3.4）。
 * **起点不特殊对待** —— 它和别的快照一样按轮次最早优先被删。
 * @param {{turn:number, bytes:number}[]} index 轻量快照索引
 * @returns {number[]} 要删除的轮次，从早到晚
 */
export function pruneOldest(index, count) {
  const wanted = Math.max(0, Math.trunc(count))
  return [...index]
    .sort((a, b) => a.turn - b.turn)
    .slice(0, wanted)
    .map((item) => item.turn)
}

// 用整数交叉相乘比较百分比，避免 0.95 这类浮点数在边界上抖。
function atLeast(bytes, limit, percent) {
  return bytes * 100 >= limit * percent
}
