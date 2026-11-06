// 撤回指针（ADR 0102）：模型可以用它说「这个人不再这么认为了」。
//
// 为什么需要：档案里「谁知道什么」是按人分开的（A 以为 B 去了 C 地，
// D 以为 B 去了 F 地，两条认知各自独立）。同一个人改口以后，
// 他指向旧说法的那条指针要能撤掉——否则他会同时"知道"两个互相矛盾的去向。
//
// 三条边界：
//   · 只摘**这一个人**的指针，别人的一根不动；
//   · 只认**在场人物**（跟"只有在场的人才能获得新认知"同一条规矩）；
//   · 只认**本轮素材里发过号**的命题（模型看不见的东西不许动）。
//
// 撤到零指针 → 这条命题立即清掉：撤回是显式否定，不用等下一轮的孤儿清理。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { dropClaim } from './claims.js'
import { dropPointer } from './pointers.js'

/**
 * 把一批撤回动作应用到快照上（就地改 `snapshot.c` / `snapshot.pt`）。
 *
 * @param {{snapshot:object, retracts?:Array<{谁:string, 序号:number}>,
 *          seqMap?:Map<number,number>, resolvePerson?:(name:string)=>string|null,
 *          allowedIds?:Set<string>}} input
 * @returns {{applied:Array<{personId:string, claimId:number, aboutId:string,
 *            claimText:any, droppedClaim:boolean}>,
 *            bad:Array<{item:object, reason:string}>}}
 */
export function applyRetractions({
  snapshot,
  retracts = [],
  seqMap = undefined,
  resolvePerson = undefined,
  allowedIds = undefined,
} = {}) {
  const applied = []
  const bad = []
  if (!snapshot || !Array.isArray(snapshot.c) || !Array.isArray(snapshot.pt)) return { applied, bad }

  for (const item of Array.isArray(retracts) ? retracts : []) {
    // 只认「谁」：持指针的人＝改口的人（ADR 0106）。命题说的是谁由序号查，不用模型报。
    const name = String(item?.谁 ?? '').trim()
    const no = Number(item?.序号)
    if (!name || !Number.isInteger(no) || no <= 0) {
      bad.push({ item, reason: '撤回要写清「谁」和「序号」' })
      continue
    }

    const personId = typeof resolvePerson === 'function' ? resolvePerson(name) : null
    if (!personId) {
      bad.push({ item, reason: `人物「${name}」不在档案里` })
      continue
    }
    // 不在场的人这轮接触不到信息，也就没理由改主意（ADR 0083）
    if (allowedIds && !allowedIds.has(personId)) {
      bad.push({ item, reason: `「${name}」这轮不在场，不能撤回他的认知` })
      continue
    }

    // 序号必须在**本轮素材**的号表里：防止模型编一个号去删它没看见的东西
    const claimId = seqMap && typeof seqMap.get === 'function' ? seqMap.get(no) : undefined
    if (claimId === undefined) {
      bad.push({ item, reason: `序号 ${no} 不在本轮素材里` })
      continue
    }

    const hadPointer = snapshot.pt.some(
      (row) => Array.isArray(row) && row[0] === personId && row[1] === claimId,
    )
    if (!hadPointer) {
      // 静默跳过会让模型以为撤成功了，调试日志里什么都看不到
      bad.push({ item, reason: `「${name}」本来就没有这条认知` })
      continue
    }

    // 命题说的是谁、说的是什么：在删之前抓下来，调试日志要能直读「谁 → 关于谁 · 内容」
    const claimRow = snapshot.c.find((row) => Array.isArray(row) && row[0] === claimId) ?? null
    const aboutId = String(claimRow?.[1] ?? '')
    const claimText = claimRow?.[3] ?? ''

    if (!dropPointer(snapshot.pt, personId, claimId)) {
      bad.push({ item, reason: '撤回没落上（指针摘不掉）' })
      continue
    }

    // 没人再指着这条命题 → 立即清掉（命题表只动命题，指针已经处理完）
    const stillPointed = snapshot.pt.some((row) => Array.isArray(row) && row[1] === claimId)
    let droppedClaim = false
    if (!stillPointed) droppedClaim = Boolean(dropClaim(snapshot.c, claimId))

    applied.push({ personId, claimId, aboutId, claimText, droppedClaim })
  }

  return { applied, bad }
}
