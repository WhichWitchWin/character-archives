// 写入应用：一条动作 = 一条命题 + 若干指针（ADR 0083 阶段四）
//
// 四级找命题：序号 → 校验值对不对 → 精确匹配 → 宽松匹配 → 新建。
// 序号那一级是「加速通道」不是唯一通道：模型数错号时，它报的值原文往往是对的，
// 一比对就发现对不上，自动退回按值匹配，最坏是新建一条重复命题，不会写坏数据。
//
// 指针规则（ADR 0083）：
//   · 同一人同一命题只有一条指针，多来源塞在一条里；
//   · 「自己」那组只有本人能改——别人报的一律写进他述组，碰不到自己那组。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { addClaim, findClaim, findClaimLoose, claimById } from './claims.js'
import {
  addPointer,
  setEntry,
  touchPointer,
  TRUTH,
  SELF,
  UNKNOWN_SOURCE,
  CONVENTION,
} from './pointers.js'
import { filterIndexWords } from './indexWords.js'

const MAX_TEXT_CHARS = 30

/** 约定状态：模型报文字，程序存内部码（ADR 0087）。 */
const CONVENTION_OF = Object.freeze({
  没完成: CONVENTION.PENDING,
  完成了: CONVENTION.DONE,
  过期了: CONVENTION.EXPIRED,
  失败了: CONVENTION.FAILED,
})

const STATE_OF = Object.freeze({
  真: TRUTH.TRUE,
  假: TRUTH.FALSE,
  未定: TRUTH.UNKNOWN,
})

/** 值的宽松键：去掉标点与空白，「在旧港。」与「在旧港」归一。 */
export function textKey(text) {
  return String(text ?? '').replace(/[\s。，、！？；：“”‘’（）()《》【】…—－\-·]/gu, '')
}

/**
 * 把一批写入动作应用到快照上（就地改 `snapshot.c` / `snapshot.pt`）。
 *
 * @param {{snapshot:object, actions?:object[], seqMap?:Map<number,number>,
 *          definitions?:object, turn?:number,
 *          resolvePerson?:(name:string)=>string|null,
 *          allowedIds?:Set<string>, maxOtherSources?:number}} input
 *   allowedIds：**能建指针的人**（在场人物）。不传＝不限制。
 *   maxOtherSources：「别人」来源组最多几组（设置 cognition.maxOtherSources）。不传＝3。
 * @returns {{applied:any[], bad:Array<{action:object, reason:string}>}}
 */
export function applyWriteActions({
  snapshot,
  actions = [],
  seqMap = undefined,
  definitions = {},
  turn = 0,
  gt = '',
  resolvePerson,
  allowedIds = undefined,
  maxOtherSources = undefined,
} = {}) {
  const applied = []
  const bad = []
  if (!snapshot || !Array.isArray(snapshot.c) || !Array.isArray(snapshot.pt)) return { applied, bad }
  if (typeof resolvePerson !== 'function') return { applied, bad }

  // 模型报的是**栏目名**（素材里显示的就是名字），内部存的是栏目码
  const codeByName = new Map()
  for (const [code, definition] of Object.entries(definitions)) {
    const name = String(definition?.name ?? '').trim()
    if (name) codeByName.set(name, code)
  }

  for (const action of Array.isArray(actions) ? actions : []) {
    const aboutId = resolvePerson(action?.关于)
    if (!aboutId) {
      bad.push({ action, reason: `人物「${action?.关于 ?? ''}」不在档案里` })
      continue
    }

    const codeName = String(action?.栏目 ?? '').trim()
    const code = codeByName.get(codeName)
    if (!code) {
      bad.push({ action, reason: `栏目「${codeName}」不存在` })
      continue
    }

    const text = String(action?.值 ?? '').trim()
    if (!text) {
      bad.push({ action, reason: '值为空' })
      continue
    }
    // 跟提示词里「30 字硬上限」对齐：超了不落盘，免得一条值吃掉整个预算
    if ([...text].length > MAX_TEXT_CHARS) {
      bad.push({ action, reason: `值超过 ${MAX_TEXT_CHARS} 字` })
      continue
    }

    const claim = findOrCreateClaim({ snapshot, action, aboutId, code, text, turn, seqMap })
    if (!claim) {
      bad.push({ action, reason: '命题写不进去' })
      continue
    }
    applied.push(claim)

    for (const entry of Array.isArray(action.认知) ? action.认知 : []) {
      applyCognition({ snapshot, claim, entry, turn, gt, definitions, resolvePerson, allowedIds, bad, action, maxOtherSources })
    }
  }

  return { applied, bad }
}

function findOrCreateClaim({ snapshot, action, aboutId, code, text, turn, seqMap }) {
  // ① 序号（加速通道）：指向的命题必须真的是「同一人 + 同一栏目 + 同一内容」
  if (seqMap && Number.isInteger(action.序号)) {
    const claimId = seqMap.get(action.序号)
    const claim = claimId === undefined ? null : claimById(snapshot.c, claimId)
    if (claim && claim[1] === aboutId && claim[2] === code && textKey(claim[3]) === textKey(text)) return claim
  }

  // ② 精确匹配
  const exact = findClaim(snapshot.c, { personId: aboutId, code, text })
  if (exact) return exact

  // ③ 宽松匹配（标点差异）
  const loose = findClaimLoose(snapshot.c, { personId: aboutId, code, text, keyOf: textKey })
  if (loose) return loose

  // ④ 新建
  const words = filterIndexWords(text, action.索引词)
  return addClaim(snapshot.c, { personId: aboutId, code, text, turn, words })
}

function applyCognition({ snapshot, claim, entry, turn, gt, definitions, resolvePerson, allowedIds, bad, action, maxOtherSources = undefined }) {
  const whoId = resolvePerson(entry?.谁)
  if (!whoId) {
    bad.push({ action, reason: `认知里的「${entry?.谁 ?? ''}」不在档案里` })
    return
  }

  // 不在场的人不建指针——他这轮没接触到信息（ADR 0083 阶段二）。
  // 记进 bad：静默跳过会让模型以为写成功了，调试日志里什么都看不到。
  if (allowedIds && !allowedIds.has(whoId)) {
    bad.push({ action, reason: `「${entry?.谁 ?? ''}」这轮不在场，不给他建指针` })
    return
  }

  const state = STATE_OF[String(entry?.态度 ?? '').trim()]
  if (state === undefined) {
    bad.push({ action, reason: `态度「${entry?.态度 ?? ''}」不是真/假/未定` })
    return
  }

  const source = sourceOf(entry?.来源, resolvePerson)
  if (source === null) {
    bad.push({ action, reason: `来源「${entry?.来源 ?? ''}」解析不了` })
    return
  }

  // 约定状态：只有**约定类栏目**才认这个字段（ADR 0087）。模型报文字，程序存 0/1/2/3。
  // 它属于**这一组来源**（他这次听说的认知），跟着组一起写；非约定类静默忽略。
  const conventionText = String(entry?.约定 ?? '').trim()
  let convention
  if (conventionText && definitions?.[claim?.[2]]?.convention === true) {
    convention = CONVENTION_OF[conventionText]
    if (convention === undefined) {
      bad.push({ action, reason: `约定状态「${conventionText}」不是 没完成/完成了/过期了/失败了` })
      return
    }
  }

  const pointer = addPointer(snapshot.pt, { personId: whoId, claimId: claim[0], turn })
  if (!pointer) return

  // 来源组带「听到时的游戏时间」与「约定状态」（ADR 0086 / 0087）；
  // 写完顺手把「最后变动轮」推到当前轮。
  // 名额（最多几组「别人说的」）由设置传进来，不传就是默认 3（P20）。
  setEntry(pointer, { state, source, gt, convention, maxOtherSources })
  touchPointer(pointer, turn)
}

function sourceOf(raw, resolvePerson) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (text === '自己') return SELF
  if (text === '未知' || text === '未知来源') return UNKNOWN_SOURCE
  return resolvePerson(text)
}
