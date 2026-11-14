// 批量删除命题 / 认知（ADR 0112）。
//
// 面板上「他是什么样」的命题行和「他的认知」的认知行都要能多选删除。
// 两条纪律沿用单条删除（不能因为批量就松）：
//   ① 删命题 → 连带摘掉**所有**指向它的指针；
//   ② 删认知只摘指针；如果某条命题会被摘到「零指针」，那条**跳过**——
//      零指针命题下一轮会被 `pruneOrphanClaims` 当孤儿清掉，而面板承诺「命题本身不动」。
//
// 纯逻辑：不碰 ctx、不碰文件。

import { dropClaim } from './claims.js'
import { dropPointer, pointersTo } from './pointers.js'

/** 把面板传来的 id 列表洗成「去重后的正整数」。
 *
 * 只认**数字**或**纯数字字符串**：`Number()` 太宽松（`true`→1、`[5]`→5、`'0x10'`→16、`'1e2'`→100），
 * 而这是对外接口，宽松一点就可能删掉不相干的命题。
 */
function normalizeIds(ids) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(ids) ? ids : []) {
    const looksLikeId = typeof raw === 'number'
      ? Number.isInteger(raw)
      : (typeof raw === 'string' && /^\d+$/.test(raw))
    const id = looksLikeId ? Number(raw) : NaN
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * 批量删命题：命题表与指针表一起改（就地修改，调用方拿到的是同一个对象）。
 *
 * @param {{claims?:any[], pointers?:any[], ids?:any[]}} input
 * @returns {{removedClaims:number[], removedPointers:number}}
 *   `removedClaims` 只含**真的找到并删掉**的 id；不存在的 id 静默跳过
 */
export function dropClaims({ claims = [], pointers = [], ids = [] } = {}) {
  const removedClaims = []
  let removedPointers = 0
  for (const id of normalizeIds(ids)) {
    const pointing = pointersTo(pointers, id)
    if (!dropClaim(claims, id)) continue
    removedClaims.push(id)
    for (const pointer of pointing) {
      if (dropPointer(pointers, pointer[0], id)) removedPointers += 1
    }
  }
  return { removedClaims, removedPointers }
}

/**
 * 批量删认知：只摘指针，绝不删命题。**就地修改**传入的指针数组。
 *
 * 跳过规则：某个 id 摘掉这个人的指针后**一条都不剩**，就整条跳过并记进 `skipped`
 * （`reason: 'last-cognition'`）——让面板能把「这几条没删」的原因说清楚。
 * 这个人本来就没有这条认知时，既不算删掉也不算跳过（属于「找不到」，由调用方报）。
 *
 * 脏数据里同一个人可能对同一条命题挂了不止一个指针（正常写入按「人＋命题」去重），
 * 所以真删时**循环摘到底**——只摘一条的话面板上会「删了还在」。
 *
 * @param {{pointers?:any[], personId:string, ids?:any[]}} input
 * @returns {{removed:number[], skipped:Array<{claimId:number, reason:string}>}}
 */
export function dropCognitions({ pointers = [], personId, ids = [] } = {}) {
  const removed = []
  const skipped = []
  for (const id of normalizeIds(ids)) {
    const holding = pointersTo(pointers, id)
    const mine = holding.some((pointer) => pointer[0] === personId)
    if (!mine) continue
    const others = holding.filter((pointer) => pointer[0] !== personId)
    if (others.length === 0) {
      skipped.push({ claimId: id, reason: 'last-cognition' })
      continue
    }
    let dropped = 0
    while (dropPointer(pointers, personId, id)) dropped += 1
    if (dropped > 0) removed.push(id)
  }
  return { removed, skipped }
}
