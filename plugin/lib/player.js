// 主角常驻档案（ADR 0085）：编号固定 `p0`，名字跟身份设置里的玩家称呼同步。
//
// 为什么主角必须入档：换成「命题 + 指针」后，认知必须挂在**一个人**身上。
// 主角不在人物表 → 模型报「谁＝主角」时找不到人、整条认知被拒，
// 于是第一/三人称下主角亲眼所见记不进指针表，视角兼容只剩一句提示词。
//
// 主角在提示词里**跟普通 NPC 一模一样**，不需要特殊说明；程序负责三件事：
//   ① 保证这一档存在（没有就补）；
//   ② 名字永远跟玩家称呼一致；
//   ③ 一/二人称下**强制在场**（模型报离场会被拒）。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { STATUS } from './snapshot.js'

/** 主角的固定编号。不参与 takePersonId 的号码分配。 */
export const PLAYER_ID = 'p0'

/** 玩家称呼为空时用的占位名（姓名不可留空，ADR 0084）。 */
export const PLAYER_FALLBACK_NAME = '主角'

/**
 * 人称代词：**不是名字**，不能进档案。
 *
 * 第二人称的卡里，酒馆的「玩家默认称呼」常常就是「你」；中英文都要认，
 * 否则玩家手填个「You」照样能存进称呼里。
 */
const PRONOUN_NAMES = new Set([
  // 中文
  '你', '我', '他', '她', '它', '您',
  '你们', '我们', '咱们', '他们', '她们', '它们',
  // 英文（统一小写比较）
  'i', 'me', 'my', 'mine', 'myself',
  'you', 'your', 'yours', 'yourself',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'they', 'them', 'their', 'theirs', 'themselves',
])

export function isPronounName(name) {
  const text = String(name ?? '').trim()
  if (!text) return false
  return PRONOUN_NAMES.has(text) || PRONOUN_NAMES.has(text.toLowerCase())
}

export function isPlayer(personId) {
  return String(personId ?? '') === PLAYER_ID
}

/**
 * 主角在档案里叫什么：**就是身份设置里的玩家称呼**，空则用「主角」。
 *
 * 2026-11-05 回滚：曾经试过"称呼是代词就换成「主角」"，那是自欺欺人——
 * 玩家在酒馆里就叫「你」，改掉名字只会让身份对不上，还连带把
 * `resolvePersonByName('你')` 弄成找不到人（主视角的认知全被拒）。
 * 代词该怎么处理是**匹配层**的事，见 `resolvePersonRef`。
 */
export function playerNameOf(identityName) {
  const text = String(identityName ?? '').trim()
  return text || PLAYER_FALLBACK_NAME
}

/**
 * 保证主角在人物表里，并把名字同步成身份设置里的玩家称呼。
 *
 * @param {any[][]} persons
 * @param {{name?:string, alwaysPresent?:boolean}} options
 *   alwaysPresent：一/二人称下主角**永远在场**（模型改离场会被拉回来）；
 *                  三人称传 false，状态交给剧情。
 * @returns {{persons:any[][], created:boolean, changed:boolean}}
 */
export function ensurePlayer(persons, { name = '', alwaysPresent = false } = {}) {
  const list = Array.isArray(persons) ? [...persons] : []
  const label = playerNameOf(name)
  const index = list.findIndex((person) => Array.isArray(person) && person[0] === PLAYER_ID)

  if (index < 0) {
    list.unshift([PLAYER_ID, STATUS.PRESENT, label, ''])
    return { persons: list, created: true, changed: true }
  }

  const person = list[index]
  const next = [...person]
  let changed = false
  if (String(next[2] ?? '').trim() !== label) {
    next[2] = label
    changed = true
  }
  if (alwaysPresent && next[1] !== STATUS.PRESENT) {
    next[1] = STATUS.PRESENT
    changed = true
  }
  if (changed) list[index] = next
  return { persons: list, created: false, changed }
}

/**
 * 一/二人称下：主角不许离场。
 *
 * 为什么在程序层拒、而不是靠提示词：提示词只能说"尽量别"，模型仍可能报；
 * 而主角离场会让整个"视角人物"设定崩掉——宁可直接拒掉那条动作。
 */
export function playerMustStayPresent(person) {
  return person !== 'third'
}
