// 测试夹具：小样本，只为测实现，不为测容量极限。
export const GT = '三年五月十二日'

/** 字典：两条合法的长句（第 0 号、第 1 号） */
export const DICT_RAW = {
  v: 1,
  d: ['他站在旧港码头边的木栈桥上', '碧海潮生按玉箫声'],
  t: [4, 4],
}

/** p1 离场、p2 在场；人物固定 4 格，第 4 格是别名串 */
export const PERSONS = [
  ['p1', 0, '老陈', '陈先生'],
  ['p2', 1, '林小鱼', ''],
]

export const SNAPSHOT = { v: 1, t: 21, p: PERSONS, gt: GT, loc: '临安·旧港·码头' }
