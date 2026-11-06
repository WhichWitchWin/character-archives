// 当前地点（ADR 0089 §5）：三路取，**只认本局已有的地名**。
//
// 为什么必须校验：新地名意味着没人来过、没存过索引词——拿它去匹配召回只会空转，
// 还会把"当前地点"这个字段污染成一个模型随口编的词。
//
// 三路优先级：
//   ① MVU 给的值（权威，直接用）
//   ② 写入阶段模型自己报的（非 MVU 卡才问）
//   ③ 程序从正文里抓（已知地名出现在正文里 → 取最长的那个）
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { CLAIM_WORDS } from './claims.js'

/** 本局出现过的所有「地」类索引词。 */
export function knownPlaces(snapshot) {
  const claims = Array.isArray(snapshot?.c) ? snapshot.c : []
  const found = new Set()
  for (const claim of claims) {
    const words = Array.isArray(claim?.[CLAIM_WORDS]) ? claim[CLAIM_WORDS] : []
    for (const word of words) {
      if (word?.类 === '地' && typeof word?.词 === 'string' && word.词.trim()) {
        found.add(word.词.trim())
      }
    }
  }
  return found
}

/** 正文里出现过的已知地名，取最长的那个（「旧港码头」优先于「码头」）。 */
export function placeFromText(text, known) {
  const body = String(text ?? '')
  if (!body) return ''
  let best = ''
  for (const place of known ?? []) {
    if (!body.includes(place)) continue
    if ([...place].length > [...best].length) best = place
  }
  return best
}

/**
 * 三路解析当前地点。
 *
 * @param {{mvuLoc?:string, modelLoc?:string, text?:string, known?:Set<string>}} input
 * @returns {string} 空字符串表示"这一轮没有可用的地点"
 */
export function resolvePlace({ mvuLoc = '', modelLoc = '', text = '', known = new Set() } = {}) {
  // ① MVU 给什么就用什么——它是这局的时间/地点源头，最权威
  const fromMvu = String(mvuLoc ?? '').trim()
  if (fromMvu) return fromMvu

  // ② 模型报的：必须命中本局已有地名
  const fromModel = String(modelLoc ?? '').trim()
  if (fromModel && known.has(fromModel)) return fromModel

  // ③ 程序从正文里抓
  return placeFromText(text, known)
}
