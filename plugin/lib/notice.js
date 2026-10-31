// 人物冷存档 · 提示记录（设计稿 §3.5「提示详细程度」「每轮动作日志」「必记事件」）
//
// 容量事件与每轮动作都记在这里，供侧栏角标与面板里的「记录」区展示。
// 分三档记录范围（§3.5）：
//   简洁：只记异常与容量事件
//   标准（默认）：简洁 + 归档 / 离场 / 回场 / 容灾等关键动作
//   详细：标准 + 每轮的召回、写入、跳过与无变化
//
// 记录存在整局数据里，有上限（默认 200 条），超了丢最旧的。
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

export const DETAIL = Object.freeze({
  brief: 'brief',       // 简洁
  standard: 'standard', // 标准（默认）
  detail: 'detail',     // 详细
})

const RANK = { brief: 0, standard: 1, detail: 2 }

export function createNoticeLog() {
  return { v: 1, items: [] }
}

/** 当前详细程度下，这条事件（min 为它所需的最低档）要不要记。 */
export function shouldRecord(settingDetail, minDetail) {
  const setting = RANK[settingDetail] ?? RANK.standard
  const needed = RANK[minDetail] ?? RANK.brief
  return setting >= needed
}

/**
 * 记一条。返回是否记上了。
 * @param {{turn:number, code:string, detail:string, min:string}} entry
 * @returns {boolean}
 */
export function addNotice(log, entry, { settingDetail = DETAIL.standard, max = 200 } = {}) {
  if (!shouldRecord(settingDetail, entry.min)) return false

  log.items.push({ turn: entry.turn, code: entry.code, detail: entry.detail })
  while (log.items.length > max) log.items.shift()
  return true
}

/** 最近几条，按时间倒序（新的在前）。 */
export function recentNotices(log, count) {
  return [...(log?.items ?? [])].reverse().slice(0, Math.max(0, count))
}
