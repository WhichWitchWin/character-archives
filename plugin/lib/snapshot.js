// 人物冷存档 · 快照结构（设计稿 §4.1 字段、§4.8 版本与迁移、ADR 0005 的 gt）
//
// 快照是整个插件唯一按轮保存的东西（saveTurnData，每条 ≤ 64 KB）。
// 它刻意用「短键 + 数组」而不是对象：字段名占的字节也算在 64 KB 里。
//
// 结构（字段顺序永不改变，新字段一律加在末尾）：
//   { "v": 1, "t": 40, "p": [ 人物... ], "gt": "三年五月十二日", "loc": "临安·旧港",
//     "c": [ 命题... ], "pt": [ 指针... ] }
//   人物 = ["p7", 状态, "姓名", "别名串"]
//
// 姓名按原文存放、不进字典（§4.1）—— 回退到改名之前的那份快照时，
// 看到的自然是当时的旧名字，不会剧透后来的新名字（ADR 0004）。
//
// 读到坏东西的策略（§4.8「不清空、不覆盖」）：
//   - 顶层结构坏了 → 整份拒绝，调用方不许覆盖存档；
//   - 单个坏人物 → 只丢那一个，其余照常读出，记进 problems。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

export const SNAPSHOT_VERSION = 1

/** 状态字段：只有离场／在场两个值（ADR 0045 砍掉了资料容灾）。 */
export const STATUS = Object.freeze({
  OFFLINE: 0, // 离场
  PRESENT: 1, // 在场
})

const PERSON_FIELDS = 4

export function createSnapshot(turn, gt = '', loc = '') {
  return { v: SNAPSHOT_VERSION, t: turn, p: [], gt, loc, c: [], pt: [] }
}

/**
 * 定位「现在该读哪一轮的快照」。
 *
 * 整局数据里的 `updatedTurn` 是**我们上次结算的轮次**，剧情回退时它不会自己变小
 * （回退只动酒馆的正文与按轮数据，不动插件自己写的那份整局数据，B1）。所以定位轮次
 * 必须先问酒馆当前状态（`getTurnState().turn`，官方文档明确「回退、重新生成后读到的是
 * 回退后的当前状态」），拿不到才回落 `updatedTurn`。
 *
 * @param {{updatedTurn?:number|null, turnState?:{turn?:number}|null}} input
 * @returns {number|null}
 */
export function resolveTurn({ updatedTurn = null, turnState = null } = {}) {
  const now = turnState && Number.isInteger(turnState.turn) && turnState.turn >= 1
    ? turnState.turn
    : null
  if (now != null) return now
  return Number.isInteger(updatedTurn) && updatedTurn >= 1 ? updatedTurn : null
}

/**
 * 校验并读入一份快照。
 * @param {object} raw 落盘的快照
 * @returns {{ok: true, snapshot: object, reason: null, problems: string[]}
 *          | {ok: false, snapshot: null, reason: string, problems: string[]}}
 */
export function readSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('快照不是对象')
  if (!Number.isInteger(raw.v) || raw.v < 1) return fail('结构版本 v 不是正整数')
  if (raw.v > SNAPSHOT_VERSION) return { ok: false, snapshot: null, reason: 'upgrade-required', problems: [] }
  if (!Number.isInteger(raw.t) || raw.t < 0) return fail('轮次 t 不是非负整数')
  if (!Array.isArray(raw.p)) return fail('人物列表 p 不是数组')

  const problems = []
  let gt = ''
  if (raw.gt === undefined || raw.gt === null) gt = ''
  else if (typeof raw.gt === 'string') gt = raw.gt
  else problems.push('快照头的时间不是字符串，已当作空')

  // 剧情发生地点：跟 gt 一样只存原文；脏数据当空串，不让整份快照作废
  let loc = ''
  if (raw.loc === undefined || raw.loc === null) loc = ''
  else if (typeof raw.loc === 'string') loc = raw.loc
  else problems.push('快照头的地点不是字符串，已当作空')

  const people = []
  for (const person of raw.p) {
    const copy = readPerson(person, problems)
    if (copy) people.push(copy)
  }

  // 命题表 / 指针表（ADR 0081/0083）：旧快照没有这两块，补空数组即可。
  // 不升级版本号——新字段加在末尾是向后兼容的，v 只在结构不兼容时升。
  let claims = []
  if (raw.c === undefined || raw.c === null) claims = []
  else if (Array.isArray(raw.c)) claims = raw.c.filter((claim) => Array.isArray(claim)).map((claim) => [...claim])
  else problems.push('命题表不是数组，已当作空')

  let pointers = []
  if (raw.pt === undefined || raw.pt === null) pointers = []
  else if (Array.isArray(raw.pt)) pointers = raw.pt.filter((pointer) => Array.isArray(pointer)).map((pointer) => [...pointer])
  else problems.push('指针表不是数组，已当作空')

  // 顶层与人物都整份复制：读回来的东西随便改，不会反噬存档对象。
  return {
    ok: true,
    snapshot: { ...raw, v: raw.v, t: raw.t, p: people, gt, loc, c: claims, pt: pointers },
    reason: null,
    problems,
  }
}

/**
 * 在**某一份快照**里按编号找人（ADR 0004）。
 * 显示「他述来源」时必须以「正在看的那份快照」为界调用它 ——
 * 回退到改名之前，拿到的就是当时的旧名字，不会剧透后来的新名字。
 * @returns {any[] | null} 人物数组；找不到（还没建档 / 已被删除 / 合并后移除）返回 null
 */
export function findPerson(snapshot, id) {
  if (!snapshot || !Array.isArray(snapshot.p)) return null
  return snapshot.p.find((person) => Array.isArray(person) && person[0] === id) ?? null
}

function readPerson(person, problems) {
  if (!Array.isArray(person) || person.length < PERSON_FIELDS) {
    problems.push('有一个人物不是 4 元素以上的数组，已跳过')
    return null
  }

  const [id, status, name, aliases] = person

  if (typeof id !== 'string' || !id) {
    problems.push('有一个人物的编号不是字符串，已跳过')
    return null
  }
  if (!Number.isInteger(status) || status < STATUS.OFFLINE || status > STATUS.PRESENT) {
    problems.push(`人物 ${id} 的状态不在 0～1（${status}），已跳过`)
    return null
  }
  if (typeof name !== 'string') {
    problems.push(`人物 ${id} 的姓名不是字符串，已跳过`)
    return null
  }
  if (typeof aliases !== 'string') {
    problems.push(`人物 ${id} 的别名不是字符串，已跳过`)
    return null
  }

  return [id, status, name, aliases]
}

/** UTF-8 字节数。64 KB 上限与 8 MB 总量都按这个口径算（§3.2）。 */
export function byteSize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return new TextEncoder().encode(text).length
}

function fail(reason) {
  return { ok: false, snapshot: null, reason, problems: [] }
}
/**
 * 读快照；**读不到就造一份空的**。
 *
 * 为什么需要：第一轮根本没有快照，而写回的逻辑是「读快照 → 改 → 写回」——
 * 读失败就 return 的话，第一份快照永远造不出来，整个写回链路死锁。
 *
 * @param {any} raw readTurnData 的返回值（可能为 null）
 * @param {number} turn 轮次
 * @param {{gt?:string}} [options]
 * @returns {{ok:true, snapshot:object, bootstrapped:boolean, problems:string[]}}
 */
export function readOrCreateSnapshot(raw, turn, { gt = '' } = {}) {
  const parsed = readSnapshot(raw)
  if (parsed.ok) return { ok: true, snapshot: parsed.snapshot, bootstrapped: false, problems: parsed.problems }
  return {
    ok: true,
    snapshot: createSnapshot(Number.isInteger(turn) ? turn : 0, typeof gt === 'string' ? gt : ''),
    bootstrapped: true,
    problems: parsed.problems ?? [],
  }
}
