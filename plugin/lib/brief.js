// 人物冷存档 · 简版装配（召回时"一行"到底发什么）
//
// 简版一共 4 层，**所有层都只在勾选了的条目里取**（唯一值那层也要勾了才带）：
//
//   ① 唯一值条目     勾了就必带，不参与排序
//   ② MVU 值         单独给 30 字符窗口，按值从短到长填，到 30 截断
//   ③ 最重要的一条   来源必须落在「上一轮在场人员」里，取其中排序最高的；
//                    两个条件必须同时满足，没有就不带
//   ④ 再一条         来源同样要在场，但不能和 ③ 是同一个来源；在符合条件的里随机取
//
// 「在场」算状态 1（在场）和 3（在场·资料容灾）—— 见 PRESENT_STATUSES。
// 同一个值不会在简版里出现两次。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { SOURCE, compareEntries, parseConfidence } from './confidence.js'

/** MVU 值单独占的字符窗口。 */
export const MVU_WINDOW = 30

/** 什么状态算「在场」：1 在场、3 在场·资料容灾。 */
export const PRESENT_STATUSES = Object.freeze([1, 3])

/** 从人物数组里取在场人员编号（人物 = [编号, 状态, 姓名, 条目, 召回词]）。 */
export function presentIdsFrom(persons, statuses = PRESENT_STATUSES) {
  const ids = new Set()
  for (const person of persons ?? []) {
    if (Array.isArray(person) && statuses.includes(person[1])) ids.add(person[0])
  }
  return ids
}

/**
 * 装配简版一行。
 * @param {object} input
 * @param {any[][]} input.entries        该人物的条目数组（[条目码, 值, 信度位, 轮次]）
 * @param {Set<string>} input.checkedCodes 玩家在条目表里勾选的条目码
 * @param {Set<string>} input.uniqueCodes  其中属于「唯一值」的条目码（来自预设，不硬编码）
 * @param {Set<string>} input.presentIds   上一轮的在场人员编号
 * @param {(entry:any[])=>string} input.textOf 把条目解成人看的文本（值可能是字典下标）
 * @param {string[]} [input.order]         排序优先级（默认轮次→来源关键度→真值→来源）
 * @param {(entry:any[])=>number} [input.salienceOf] 来源关键度
 * @param {()=>number} [input.rng]         随机源；测试里注入固定值即可复现
 */
export function buildBrief({
  entries = [],
  checkedCodes = new Set(),
  uniqueCodes = new Set(),
  presentIds = new Set(),
  textOf = (entry) => String(entry[1]),
  order = undefined,
  salienceOf = undefined,
  rng = Math.random,
  confirmTurn = null,
} = {}) {
  const candidates = entries.filter((entry) => checkedCodes.has(entry[0]))
  const used = new Set()
  const compare = (a, b) => compareEntries(a, b, { ...(order ? { order } : {}), ...(salienceOf ? { salienceOf } : {}) })
  const ranked = (list) => [...list].sort(compare)

  // ① 唯一值条目：勾了就必带
  const unique = []
  for (const code of uniqueCodes) {
    if (!checkedCodes.has(code)) continue
    const values = candidates.filter((entry) => entry[0] === code && !used.has(entry))
    if (!values.length) continue
    const best = ranked(values)[0]
    used.add(best)
    unique.push(best)
  }

  // ② MVU 值：30 字符窗口，从短到长填，装不下就截断
  const mvu = []
  let mvuChars = 0
  const mvuValues = candidates
    .filter((entry) => !used.has(entry) && parseConfidence(entry[2])?.source === SOURCE.MVU)
    .sort((a, b) => [...textOf(a)].length - [...textOf(b)].length)
  for (const entry of mvuValues) {
    const length = [...textOf(entry)].length
    if (mvuChars + length > MVU_WINDOW) break
    mvuChars += length
    mvu.push(entry)
    used.add(entry)
  }

  // ③④ 共用的筛选：来源必须是在场人员
  const sourceOf = (entry) => parseConfidence(entry[2])?.via ?? null
  const presentValues = () => candidates.filter((entry) => !used.has(entry) && presentIds.has(sourceOf(entry)))

  const top = ranked(presentValues())[0] ?? null
  if (top) used.add(top)

  const topSource = top ? sourceOf(top) : null
  const extraValues = ranked(presentValues().filter((entry) => sourceOf(entry) !== topSource))
  let extra = null
  if (extraValues.length) {
    const index = Math.min(extraValues.length - 1, Math.floor(rng() * extraValues.length))
    extra = extraValues[index]
  }

  const picked = [...unique, ...mvu, ...(top ? [top] : []), ...(extra ? [extra] : [])]
  const parts = picked.map(textOf)
  // 最后确认轮次是派生字段（取 anchors 记的最后在场轮），不是条目；强制带，放在行尾。
  if (Number.isFinite(confirmTurn)) parts.push(`第${confirmTurn}轮`)
  const text = parts.join('·')
  return { text, chars: [...text].length, mvuChars, parts: { unique, mvu, top, extra } }
}
