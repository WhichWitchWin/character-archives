// 测试夹具：小样本，只为测实现，不为测容量极限。
export const GT = '三年五月十二日'

/** 字典：两条合法的长句（第 0 号、第 1 号） */
export const DICT_RAW = {
  v: 1,
  d: ['他站在旧港码头边的木栈桥上', '碧海潮生按玉箫声'],
  t: [4, 4],
}

/** 第 0 号是字典下标，第 1 号是原文；p2 在场 */
export const PERSONS = [
  ['p1', 0, '老陈', [['a', 0, '6', 20], ['b', '旧港', '7', 20]], '陈先生'],
  ['p2', 1, '林小鱼', [['a', '收银员', '0', 21]], ''],
]

export const SNAPSHOT = { v: 1, t: 21, p: PERSONS, gt: GT }

/** 在场名单：人物编号 → 最后一次出现的轮次与当时的游戏时间 */
export const ANCHORS = { p2: { turn: 21, gt: GT } }

/** 暂存批：同一轮的所有值共享一条 gt */
export const PENDING = [
  { turn: 20, gt: '三年五月初九', reason: 'mvu-rescue', fails: 0, values: [['p1', 'a', '旧港', '6']] },
]

export const GAME_STATE = {
  v: 1,
  dict: DICT_RAW,
  flags: { status: {}, lock: {}, hidden: {} },
  snapshots: { index: [{ turn: 21, bytes: 320 }] },
  anchors: ANCHORS,
  pending: PENDING,
  notice: { v: 1, items: [] },
}
