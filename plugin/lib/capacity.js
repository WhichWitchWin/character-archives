// 人物冷存档 · 容量（设计稿 §3.2 上限、§3.3 写入策略、§3.4 快照价值与删除顺序、§3.5 兜底）
//
// 两套上限别混：
//   - 单条快照 64 KB（按 UTF-8 字节，见 snapshot.js 的 byteSize）
//   - 每插件每局 8 MB、2000 条
//
// 删旧快照只看「变化率」的**相对**大小，不设绝对阈值：永远从最低的开始删，删够为止。
// 最低的那份也高于 20% 时停手 —— 再删就要毁掉里程碑了（§3.4 的 20% 安全线）。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

export const CAPACITY = Object.freeze({
  SNAPSHOT_BYTES: 64 * 1024,          // 单条快照上限
  GAME_TOTAL_BYTES: 8 * 1024 * 1024,  // 每插件每局总量
  RECORD_LIMIT: 2000,                 // 每局条数上限
  RECORD_WARN: 1800,                  // 接近上限的提示线

  NOTICE_PERCENT: 60,                 // 记一条「已用 60%」
  CLEAN_PERCENT: 80,                  // 开始清空最久未更新人物的条目
  CLEAN_TARGET_PERCENT: 75,           // 清到回落到这个水位以下
  REJECT_PERCENT: 95,                 // 拒绝一切新增内容

  SAFE_RATE: 0.2,                     // 20% 安全线
  FREE_HEADROOM: 0.05,                // 腾空间时多留 5%
})

/**
 * 单条快照的水位。
 * @returns {'ok' | 'notice' | 'clean' | 'reject'}
 */
export function pressure(bytes, limit = CAPACITY.SNAPSHOT_BYTES) {
  const percent = limit > 0 ? (bytes / limit) * 100 : 0
  if (percent >= CAPACITY.REJECT_PERCENT) return 'reject'
  if (percent >= CAPACITY.CLEAN_PERCENT) return 'clean'
  if (percent >= CAPACITY.NOTICE_PERCENT) return 'notice'
  return 'ok'
}

/**
 * 每份快照的变化率：|本轮字节 − 上一份字节| ÷ 上一份字节（§3.4）。
 * 「上一份」指该轮之前最近一份**实际存在**的快照。起点没有前一版，记 null。
 * @param {{turn:number, bytes:number}[]} index
 * @returns {Map<number, number|null>} 轮次 → 变化率
 */
export function snapshotRates(index) {
  const sorted = [...index].sort((a, b) => a.turn - b.turn)
  const rates = new Map()
  sorted.forEach((item, position) => {
    if (position === 0) {
      rates.set(item.turn, null)
      return
    }
    const previous = sorted[position - 1]
    // 上一份是 0 字节时无从算比例，当成「完全变了」，免得除零
    const rate = previous.bytes > 0 ? Math.abs(item.bytes - previous.bytes) / previous.bytes : 1
    rates.set(item.turn, rate)
  })
  return rates
}

/**
 * 挑出该删哪几份，腾够 needBytes。每删一份都重算剩下快照的变化率（§3.4）。
 * 起点不参与删除；变化率相近时轮次更早的先删。
 *
 * @returns {{victims:number[], freed:number, stopped:string|null, minRate:number|null}}
 *   stopped 为 'safe-line' 表示最低变化率也高于安全线，已停手，victims 是停手前删掉的。
 */
export function pickVictims(index, needBytes = 0, { safeRate = CAPACITY.SAFE_RATE } = {}) {
  let remaining = [...index].sort((a, b) => a.turn - b.turn).map((item) => ({ ...item }))
  const victims = []
  let freed = 0

  while (freed < needBytes && remaining.length > 1) {
    const rates = snapshotRates(remaining)

    // 起点（remaining[0]）永远不删
    let best = null
    for (const item of remaining.slice(1)) {
      const rate = rates.get(item.turn)
      if (!best || rate < best.rate || (rate === best.rate && item.turn < best.turn)) {
        best = { turn: item.turn, rate }
      }
    }
    if (!best) break
    if (best.rate > safeRate) return { victims, freed, stopped: 'safe-line', minRate: best.rate }

    victims.push(best.turn)
    freed += remaining.find((item) => item.turn === best.turn).bytes
    remaining = remaining.filter((item) => item.turn !== best.turn)
  }

  return { victims, freed, stopped: null, minRate: null }
}

/** 想写一份 size 字节的新快照，需要先腾出多少空间（§3.3：本次大小 + 5%）。 */
export function targetFreeBytes(size) {
  return Math.ceil(size * (1 + CAPACITY.FREE_HEADROOM))
}
