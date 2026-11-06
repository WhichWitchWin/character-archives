// 命题表：全局一份的「有人提过 / 有人信过的一句话」（ADR 0081 / 0083）
//
// 为什么是扁平数组而不是嵌在人物里：一条命题可能被很多人知道（指针指向它），
// 嵌在人物档案里就得复制 N 份，索引词也要抽 N 次（ADR 0081「存储结构」）。
//
// 结构（固定 6 元素，字段顺序永不改变）：
//   [id, 所属人物, 栏目码, 内容, 起始轮, 索引词]
//   - id         自增正整数，给指针指路
//   - 索引词      [{ 词, 类 }]，空数组表示没抽到
//
// 约定不是靠轮次判断的：程序只存不判断，模型看着 gt 自己判（ADR 0087）。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

export const CLAIM_FIELDS = 6
export const CLAIM_ID = 0
export const CLAIM_PERSON = 1
export const CLAIM_CODE = 2
export const CLAIM_TEXT = 3
export const CLAIM_FROM = 4
export const CLAIM_WORDS = 5

export function createClaims() {
  return []
}

/**
 * 追加一条命题。
 * @returns {any[] | null} 新命题；参数不合法返回 null（不抛，写回链路不能因一条坏动作断掉）
 */
export function addClaim(claims, { personId, code, text, turn, words = [] } = {}) {
  if (!Array.isArray(claims)) return null
  if (typeof personId !== 'string' || !personId) return null
  if (typeof code !== 'string' || !code) return null
  if (typeof text !== 'string' || !text) return null

  const claim = [
    nextClaimId(claims),
    personId,
    code,
    text,
    Number.isInteger(turn) ? turn : 0,
    Array.isArray(words) ? words : [],
  ]
  claims.push(claim)
  return claim
}

export function nextClaimId(claims) {
  let max = 0
  for (const claim of Array.isArray(claims) ? claims : []) {
    const id = Array.isArray(claim) ? claim[CLAIM_ID] : 0
    if (Number.isInteger(id) && id > max) max = id
  }
  return max + 1
}

/** 某人的命题；给了 code 就再按栏目筛。 */
export function claimsOf(claims, personId, code = undefined) {
  if (!Array.isArray(claims)) return []
  return claims.filter((claim) => {
    if (!Array.isArray(claim)) return false
    if (claim[CLAIM_PERSON] !== personId) return false
    if (code !== undefined && claim[CLAIM_CODE] !== code) return false
    return true
  })
}

export function claimById(claims, id) {
  if (!Array.isArray(claims)) return null
  return claims.find((claim) => Array.isArray(claim) && claim[CLAIM_ID] === id) ?? null
}

/** 精确匹配「人物 + 栏目 + 内容」。 */
export function findClaim(claims, { personId, code, text } = {}) {
  if (!Array.isArray(claims)) return null
  return (
    claims.find(
      (claim) =>
        Array.isArray(claim) &&
        claim[CLAIM_PERSON] === personId &&
        claim[CLAIM_CODE] === code &&
        claim[CLAIM_TEXT] === text,
    ) ?? null
  )
}

/**
 * 宽松匹配：调用方给 keyOf（一般是 actions.js 的 looseKey），
 * 用来兜住「在旧港」与「在旧港。」这种标点差异。
 */
export function findClaimLoose(claims, { personId, code, text, keyOf } = {}) {
  if (!Array.isArray(claims)) return null
  if (typeof keyOf !== 'function') return null
  const key = keyOf(text)
  return (
    claims.find(
      (claim) =>
        Array.isArray(claim) &&
        claim[CLAIM_PERSON] === personId &&
        claim[CLAIM_CODE] === code &&
        keyOf(claim[CLAIM_TEXT]) === key,
    ) ?? null
  )
}

// 真删（只给「永久删除人物」这类场景用；命题正常不删——ADR 0087 约定类只存不判断）。
export function dropClaim(claims, id) {
  if (!Array.isArray(claims)) return false
  const index = claims.findIndex((claim) => Array.isArray(claim) && claim[CLAIM_ID] === id)
  if (index < 0) return false
  claims.splice(index, 1)
  return true
}

/**
 * 摘掉孤儿命题（P22②）：一个指针都没有的命题**永远召不回、面板也看不见**，
 * 却每轮都跟着快照走——纯死数据，摘掉等于没发生过。
 *
 * 保险：`turn`（当前轮）给了就**豁免本轮新建的命题**——写入是「建命题＋挂指针」
 * 同一步，正常不会有零指针窗口；豁免只防写入中途失败留下的半截数据，
 * 等下一轮它仍没指针，自然会被摘掉。
 *
 * @param {any[]} claims 命题表（原地修改）
 * @param {any[]} pointers 指针表（只读）
 * @param {{turn?:number}} [options]
 * @returns {{removed:number[], kept:number}} 摘掉的命题 id 与保留数
 */
export function pruneOrphanClaims(claims, pointers, { turn = undefined } = {}) {
  if (!Array.isArray(claims)) return { removed: [], kept: 0 }
  const referenced = new Set()
  for (const pointer of Array.isArray(pointers) ? pointers : []) {
    if (Array.isArray(pointer) && pointer[1] !== undefined) referenced.add(pointer[1])
  }
  const removed = []
  for (const claim of claims) {
    if (!Array.isArray(claim)) continue
    const id = claim[CLAIM_ID]
    const isOrphan = !referenced.has(id)
    const isNewThisTurn = Number.isInteger(turn) && claim[CLAIM_FROM] === turn
    if (isOrphan && !isNewThisTurn) removed.push(id)
  }
  if (removed.length) {
    const gone = new Set(removed)
    for (let at = claims.length - 1; at >= 0; at -= 1) {
      const claim = claims[at]
      if (Array.isArray(claim) && gone.has(claim[CLAIM_ID])) claims.splice(at, 1)
    }
  }
  return { removed, kept: claims.length }
}
