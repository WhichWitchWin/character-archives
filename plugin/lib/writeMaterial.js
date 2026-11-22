// 写入素材组装：从快照里挑出「跟当前场景有关」的命题（ADR 0083 阶段二）
//
// 给每个**在场人物**的素材，只挑他自己指针里指向下列命题的那些：
//   ① 所属人物 ∈ 在场人物（含他自己）
//   ② 涉及当前地点（索引词里的「地」类词出现在 loc 里）
//   ③ 索引词命中本轮正文
//
// 正文提到但**不在场**的人单独列一段，只读——他们的命题摆出来给模型复用，
// 但不给他们建指针（他们这轮没接触到信息）。
//
// 序号在这里统一分配：同一条命题在所有人物下面共用一个号，
// 模型报回来靠 `seqMap`（序号 → 命题 id）找回。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { entryLockKey } from './locks.js'

export function buildWriteMaterial({
  snapshot,
  presentIds = new Set(),
  mentionedIds = new Set(),
  checkedCodes = undefined,
  hitWords = new Set(),
  turn = 0,
  locked = undefined,
  lockedEntries = undefined,
  lockedClaims = undefined,
} = {}) {
  const claims = Array.isArray(snapshot?.c) ? snapshot.c : []
  const pointers = Array.isArray(snapshot?.pt) ? snapshot.pt : []
  const people = Array.isArray(snapshot?.p) ? snapshot.p : []
  const loc = String(snapshot?.loc ?? '')

  const allowed = checkedCodes ?? null

  // 序号：全局分配，同一条命题在所有人物下面共用一个号
  const seqMap = new Map() // 序号 → 命题 id
  const claimSeq = new Map() // 命题 id → 序号
  let seq = 0
  const seqOf = (claimId) => {
    if (!claimSeq.has(claimId)) {
      const no = ++seq
      claimSeq.set(claimId, no)
      seqMap.set(no, claimId)
    }
    return claimSeq.get(claimId)
  }

  const byId = new Map()
  for (const claim of claims) {
    if (Array.isArray(claim)) byId.set(claim[0], claim)
  }

  const personOf = (id) => people.find((item) => Array.isArray(item) && item[0] === id) ?? null
  const nameOf = (id) => String(personOf(id)?.[2] ?? '')

  // 这条命题跟这个在场人物有没有关系
  const related = (claim, selfId) => {
    if (claim[1] === selfId) return true
    if (presentIds.has(claim[1])) return true
    const words = Array.isArray(claim[5]) ? claim[5] : []
    if (loc && words.some((word) => word?.类 === '地' && word?.词 && loc.includes(word.词))) return true
    if (hitWords.size && words.some((word) => word?.词 && hitWords.has(word.词))) return true
    return false
  }

  const result = { people: [], mentioned: [], seqMap, seqOf }

  // 锁住的条目/值不进素材（M5-6）：列了也不能写，纯烧 token，还会让模型交一堆注定被丢弃的动作。
  // **三层都要判**：只判值锁与条目锁时，别人素材里仍会列出「被人物锁的人」的命题——
  // 写入虽然会被拦住，但同样是白烧 token。
  // 命题 id 两侧口径统一按字符串比（素材侧原来用数字 Set，遇到字符串 id 会漏过滤）。
  const lockedClaimIds = lockedClaims ? new Set([...lockedClaims].map((id) => String(id))) : null
  const lockedRow = (claim) =>
    (locked && locked.has(claim[1])) ||
    (lockedClaimIds && lockedClaimIds.has(String(claim[0]))) ||
    (lockedEntries && lockedEntries.has(entryLockKey(claim[1], claim[2])))

  // 这个人哪几栏锁着：交给 followup 拼素材时排除掉，别把它列进「这些栏目还空着」。
  const lockedCodesOf = (personId) => {
    const codes = new Set()
    if (!lockedEntries) return codes
    const prefix = `${personId}:`
    for (const key of lockedEntries) {
      const text = String(key)
      if (text.startsWith(prefix)) codes.add(text.slice(prefix.length))
    }
    return codes
  }

  for (const id of presentIds) {
    const person = personOf(id)
    if (!person) continue
    // 锁住的人**连素材都不进**：模型压根不知道有这个人，就不会给他写命题/指针（冻结）
    if (locked && locked.has(id)) continue
    // 姓名留空的人连素材都不进：模型报不出他，写进去也召不回来（ADR 0084）
    if (!String(person[2] ?? '').trim()) continue
    const rows = []
    for (const pointer of pointers) {
      if (!Array.isArray(pointer) || pointer[0] !== id) continue
      const claim = byId.get(pointer[1])
      if (!claim) continue
      if (allowed && !allowed.has(claim[2])) continue
      if (lockedRow(claim)) continue
      if (!related(claim, id)) continue
      seqOf(claim[0])
      rows.push({ claim, pointer })
    }
    result.people.push({ id, name: String(person[2] ?? ''), status: person[1], claims: rows, lockedCodes: lockedCodesOf(id) })
  }

  for (const id of mentionedIds) {
    if (presentIds.has(id)) continue
    const person = personOf(id)
    if (!person) continue
    // 同上：锁住的人不给模型看（冻结在锁住那一刻）
    if (locked && locked.has(id)) continue
    // 同上：空姓名的人不给写入，也不摆出来让模型猜（ADR 0084）
    if (!String(person[2] ?? '').trim()) continue
    const rows = claims
      .filter(
        (claim) =>
          Array.isArray(claim) && claim[1] === id && (!allowed || allowed.has(claim[2])) && !lockedRow(claim),
      )
      .map((claim) => ({ claim, pointer: null }))
    if (!rows.length) continue
    for (const row of rows) seqOf(row.claim[0])
    result.mentioned.push({ id, name: String(person[2] ?? ''), rows, claims: rows, status: person[1], lockedCodes: lockedCodesOf(id) })
  }

  return result
}
