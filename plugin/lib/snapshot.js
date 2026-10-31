// 人物冷存档 · 快照结构（设计稿 §4.1 字段、§4.8 版本与迁移策略）
//
// 快照是整个插件唯一按轮保存的东西（saveTurnData，每条 ≤ 64 KB）。
// 它刻意用「短键 + 数组」而不是对象：字段名占的字节也算在 64 KB 里。
//
// 结构（字段顺序永不改变，新字段一律加在末尾）：
//   { "v": 1, "t": 40, "p": [ 人物... ] }
//   人物 = ["p7", 状态, "姓名", [条目...], "召回词串"]
//   条目 = ["a", 值, "信度位", 轮次]
//
// 读到坏东西的策略（§4.8「不清空、不覆盖」）：
//   - 顶层结构坏了（不是对象 / 没有 p）→ 整份拒绝，调用方不许覆盖存档；
//   - 单个坏人物、单条坏条目 → **只丢那一个**，其余照常读出，并记进 problems。
//     整份报废会逼调用方去读更旧的一份，再「有变化才写」写回去，等于永久丢数据。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

export const SNAPSHOT_VERSION = 1

/** 状态字段：把「位置状态」和「资料是否容灾」打包在一个数字里（设计稿第二节）。 */
export const STATUS = Object.freeze({
  OFFLINE: 0,     // 离场
  PRESENT: 1,     // 在场
  MVU_OFFLINE: 2, // 离场·资料容灾
  MVU_PRESENT: 3, // 在场·资料容灾
})

const PERSON_FIELDS = 5
const ENTRY_FIELDS = 4

export function createSnapshot(turn) {
  return { v: SNAPSHOT_VERSION, t: turn, p: [] }
}

export function createPerson(id, status, name, entries = [], triggers = '') {
  return [id, status, name, entries, triggers]
}

export function createEntry(code, value, confidence, turn) {
  return [code, value, confidence, turn]
}

/**
 * 校验并读入一份快照。
 * @returns {{ok: true, snapshot: object, reason: null, problems: string[]}
 *          | {ok: false, snapshot: null, reason: string, problems: string[]}}
 * reason 为 'upgrade-required' 时表示快照版本高于插件：只可只读展示，不可召回与写入（§4.8）。
 */
export function readSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('快照不是对象')
  if (!Number.isInteger(raw.v) || raw.v < 1) return fail('结构版本 v 不是正整数')
  if (raw.v > SNAPSHOT_VERSION) return { ok: false, snapshot: null, reason: 'upgrade-required', problems: [] }
  if (!Number.isInteger(raw.t) || raw.t < 0) return fail('轮次 t 不是非负整数')
  if (!Array.isArray(raw.p)) return fail('人物列表 p 不是数组')

  const problems = []
  const people = []
  for (const person of raw.p) {
    const copy = readPerson(person, problems)
    if (copy) people.push(copy)
  }

  // 顶层与人物都整份复制：读回来的东西随便改，不会反噬存档对象。
  return { ok: true, snapshot: { ...raw, v: raw.v, t: raw.t, p: people }, reason: null, problems }
}

function readPerson(person, problems) {
  if (!Array.isArray(person) || person.length < PERSON_FIELDS) {
    problems.push('有一个人物不是 5 元素以上的数组，已跳过')
    return null
  }

  const [id, status, name, entries, triggers] = person
  if (typeof id !== 'string' || !id) {
    problems.push('有一个人物的编号不是字符串，已跳过')
    return null
  }
  if (!Number.isInteger(status) || status < STATUS.OFFLINE || status > STATUS.MVU_PRESENT) {
    problems.push(`人物 ${id} 的状态不在 0～3（${status}），已跳过`)
    return null
  }
  if (typeof name !== 'string') {
    problems.push(`人物 ${id} 的姓名不是字符串，已跳过`)
    return null
  }
  if (!Array.isArray(entries)) {
    problems.push(`人物 ${id} 的条目不是数组，已跳过`)
    return null
  }
  if (typeof triggers !== 'string') {
    problems.push(`人物 ${id} 的召回词不是字符串，已跳过`)
    return null
  }

  const copiedEntries = []
  for (const entry of entries) {
    const copy = readEntry(entry)
    if (copy) copiedEntries.push(copy)
    else problems.push(`人物 ${id} 有一条条目结构不对，已跳过`)
  }

  const copy = [...person]
  copy[3] = copiedEntries
  return copy
}

function readEntry(entry) {
  if (!Array.isArray(entry) || entry.length < ENTRY_FIELDS) return null

  const [code, value, confidence, turn] = entry
  if (typeof code !== 'string' || !code) return null
  // 值位置：字符串＝原文，数字＝字典下标。下标必须是非负的安全整数，
  // 否则 decode 会静默变成空白（越界核对由「快照 + 字典」那一层做）。
  const isText = typeof value === 'string'
  const isIndex = Number.isSafeInteger(value) && value >= 0
  if (!isText && !isIndex) return null
  if (typeof confidence !== 'string') return null
  if (typeof turn !== 'number') return null

  return [...entry]
}

/** UTF-8 字节数。64 KB 上限与 8 MB 总量都按这个口径算（§3.2）。 */
export function byteSize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return new TextEncoder().encode(text).length
}

function fail(reason) {
  return { ok: false, snapshot: null, reason, problems: [] }
}
