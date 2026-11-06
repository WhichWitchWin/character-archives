// 人物冷存档 · 离场记录（ADR 0025）
//
// 只记录，不解析：这里的 gt 一律是**原文**（"三年五月十二日"），
// 程序不比较大小、不换算天数、不判断到期 —— 判断交给模型。
//
// 存整局数据（不随回退变、分叉自动复制、删局自动清空）：
//
//   left  离场记录：人物编号 → 离场那一刻的轮次与 gt
//         **只在「在场 → 离场」那一刻写一条**；在场的人不记——看状态就知道。
//         两个用途：注入里的「离场于 X」（用 gt）、离场缓冲的基准（用 turn）。
//
// 「最后确认轮次」记在 flags.seen 里，不在本模块。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx，数据进数据出。

export function createLeft() {
  return {}
}

/** 记下某人离场那一刻的轮次与 gt（覆盖旧值）。玩家手动改状态时也走这里。 */
export function setLeft(left, personId, turn, gt = '') {
  return { ...(left ?? {}), [personId]: { turn, gt } }
}

/** 取某人的离场记录；没有或形状不对返回 null。 */
export function getLeft(left, personId) {
  const found = left?.[personId]
  if (!found || typeof found !== 'object') return null
  return { turn: found.turn, gt: found.gt }
}

/** 回场（离场 → 在场）时清掉这条记录。 */
export function dropLeft(left, personId) {
  const next = { ...(left ?? {}) }
  delete next[personId]
  return next
}
