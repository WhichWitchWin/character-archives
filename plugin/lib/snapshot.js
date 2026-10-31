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
// 值位置靠 JSON 类型区分：字符串＝原文，数字＝字典下标（见 dictionary.js）。
// 派生的东西（关键度、分组、空条目、字典本体、MVU 映射表）**不进快照**（§4.7）。
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
 * @returns {{ok: true, snapshot: object, reason: null}
 *          | {ok: false, snapshot: null, reason: string}}
 * reason 为 'upgrade-required' 时表示快照版本高于插件，只可只读展示，不可召回与写入（§4.8）。
 */
export function readSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('快照不是对象')
  if (typeof raw.v !== 'number') return fail('缺少结构版本 v')
  if (raw.v > SNAPSHOT_VERSION) return { ok: false, snapshot: null, reason: 'upgrade-required' }
  if (typeof raw.t !== 'number') return fail('缺少轮次 t')
  if (!Array.isArray(raw.p)) return fail('人物列表 p 不是数组')

  const people = []
  for (const person of raw.p) {
    const checked = readPerson(person)
    if (!checked.ok) return checked
    people.push(checked.person)
  }

  // 顶层与人物都整份复制：读回来的东西随便改，不会反噬存档对象。
  return { ok: true, snapshot: { ...raw, v: raw.v, t: raw.t, p: people }, reason: null }
}

function readPerson(person) {
  if (!Array.isArray(person) || person.length < PERSON_FIELDS) return fail('人物不是 5 元素以上的数组')

  const [id, status, name, entries, triggers] = person
  if (typeof id !== 'string' || !id) return fail('人物编号不是字符串')
  if (!Number.isInteger(status) || status < STATUS.OFFLINE || status > STATUS.MVU_PRESENT) {
    return fail(`人物 ${id} 的状态不在 0～3：${status}`)
  }
  if (typeof name !== 'string') return fail(`人物 ${id} 的姓名不是字符串`)
  if (!Array.isArray(entries)) return fail(`人物 ${id} 的条目不是数组`)
  if (typeof triggers !== 'string') return fail(`人物 ${id} 的召回词不是字符串`)

  const copiedEntries = []
  for (const entry of entries) {
    const checked = readEntry(entry, id)
    if (!checked.ok) return checked
    copiedEntries.push(checked.entry)
  }

  const copy = [...person]
  copy[3] = copiedEntries
  return { ok: true, person: copy, reason: null }
}

function readEntry(entry, personId) {
  if (!Array.isArray(entry) || entry.length < ENTRY_FIELDS) {
    return fail(`人物 ${personId} 的条目不是 4 元素以上的数组`)
  }

  const [code, value, confidence, turn] = entry
  if (typeof code !== 'string' || !code) return fail(`人物 ${personId} 的条目码不是字符串`)
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fail(`人物 ${personId} 的条目 ${code} 的值既不是原文也不是字典下标`)
  }
  if (typeof confidence !== 'string') return fail(`人物 ${personId} 的条目 ${code} 的信度位不是字符串`)
  if (typeof turn !== 'number') return fail(`人物 ${personId} 的条目 ${code} 的轮次不是数字`)

  return { ok: true, entry: [...entry], reason: null }
}

/** UTF-8 字节数。64 KB 上限与 8 MB 总量都按这个口径算（§3.2）。 */
export function byteSize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return new TextEncoder().encode(text).length
}

function fail(reason) {
  return { ok: false, snapshot: null, reason }
}
