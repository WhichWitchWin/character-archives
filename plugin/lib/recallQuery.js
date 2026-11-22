// 查档案（ADR 0089 §9）：玩家/后台按人名主动拉一个角色的指针。
//
// 两条路，语义完全不同（2026-11-05 拆开）：
//   · **查认知**（`queryPerson`）＝纯展示：给人看的，不看预算、不盖章、不进提示词；
//   · **召回**（`buildPendingRecallText`）＝排队进上下文：下一轮正文生成前拼进提示词，**注入了才盖章**。
// 而「自动召回」在 `lib/recallEngine.js`——程序按场景挑，受预算和打分约束。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { resolvePersonByName } from './actions.js'
import { cooldownGate, isPointerCoolingDown, pointerKey } from './cooldown.js'
import { TRUTH, SELF, UNKNOWN_SOURCE, visibleGroups } from './pointers.js'

/** 编号优先（面板召回排队存的是编号），退一步才按名字认。 */
function lookupId(people, personId, name) {
  const wanted = String(personId ?? '').trim()
  if (wanted && people.some((item) => Array.isArray(item) && String(item[0]) === wanted)) return wanted
  return resolvePersonByName(people, name)
}

const STATE_LABEL = Object.freeze({ [TRUTH.TRUE]: '真', [TRUTH.FALSE]: '假', [TRUTH.UNKNOWN]: '未定' })
const CONVENTION_LABEL = Object.freeze({ 0: '没完成', 1: '完成了', 2: '过期了', 3: '失败了' })

/** 三档；留空或认不出时用 fallback。 */
export const QUERY_LEVELS = Object.freeze(['full', 'detailed', 'brief'])

export function normalizeLevel(raw, fallback = 'detailed') {
  const text = String(raw ?? '').trim()
  const map = {
    全量: 'full', full: 'full',
    详细: 'detailed', detailed: 'detailed',
    简单: 'brief', brief: 'brief',
  }
  return map[text] ?? (QUERY_LEVELS.includes(text) ? text : fallback)
}

function describeGroup(group, nameOf) {
  const state = STATE_LABEL[group?.[0]] ?? '未定'
  const source = group?.[1]
  const at = typeof group?.[2] === 'string' ? group[2].trim() : ''
  const convention = CONVENTION_LABEL[group?.[3]] ?? ''
  let from = ''
  if (source === SELF) from = '他自己确认过'
  else if (source === UNKNOWN_SOURCE) from = '他听说的'
  else from = `听${nameOf(source)}说的`
  const bits = [from]
  if (at) bits.push(at)
  if (convention) bits.push(`约定${convention}`)
  return `${state}（${bits.join('，')}）`
}

/**
 * 查一个人的档案。
 *
 * @param {object} input
 * @param {object} input.snapshot 快照
 * @param {string} [input.name] 人名或别名
 * @param {string} [input.personId] 人物编号（给了就优先，不再按名字认）
 * @param {'full'|'detailed'|'brief'} input.level 档位
 * @param {object} input.definitions 栏目定义
 * @param {object} [input.cooldowns] 冷却表
 * @param {number} [input.cooldownTurns] 冷却轮数（0＝关）
 * @param {number} [input.turn] 当前轮
 * @param {object} [input.cognition] 设置里的「认知」组（P20）。不传＝全部显示
 * @returns {{ok:true, name:string, level:string, text:string, pointers:any[]} | {ok:false, reason:string}}
 */
export function queryPerson({
  snapshot,
  name,
  personId,
  level = 'detailed',
  cooldowns = {},
  manualFree = null,
  cooldownTurns = 0,
  turn = 0,
  skip = null,
  cognition = undefined,
} = {}) {
  const people = Array.isArray(snapshot?.p) ? snapshot.p : []
  const claims = Array.isArray(snapshot?.c) ? snapshot.c : []
  const pointers = Array.isArray(snapshot?.pt) ? snapshot.pt : []
  // 一条指针挂着几组来源时显示几组（P20）：跟自动召回同一个口径
  const conflictDisplay = cognition?.conflictDisplay ?? 'all'

  const foundId = lookupId(people, personId, name)
  if (!foundId) {
    const who = String(name ?? personId ?? '').trim()
    return { ok: false, reason: who ? `找不到「${who}」——重名或没建档` : '找不到这个人——重名或没建档' }
  }

  const person = people.find((item) => Array.isArray(item) && String(item[0]) === foundId)
  const personName = String(person?.[2] ?? '').trim()
  const nameOf = (id) => String(people.find((item) => String(item?.[0]) === String(id))?.[2] ?? '').trim()
  const claimById = new Map()
  for (const claim of claims) if (Array.isArray(claim)) claimById.set(claim[0], claim)

  const mine = pointers.filter((pointer) => Array.isArray(pointer) && String(pointer[0]) === foundId)
  if (!mine.length) {
    return {
      ok: true,
      name: personName,
      level,
      text: `▍${personName}\n（还没有任何认知）`,
      pointers: [],
      manualFreeUsed: [],
      manualFreeStale: [],
    }
  }

  // 全量**恒不看冷却**（显式要全部，给完照样盖章）；
  // 详细/简单**只看冷却外**的——跟自动召回一个口径。
  // `skip` 是「同一轮已经给过的指针」，只在召回路径上用（查询不需要）。
  // `manualFree`（ADR 0118）：手动改过的那条豁免一次冷却。传 null ＝ 不参与（查认知那条路不消费标记）。
  const usedFree = new Set()
  const staleFree = new Set()
  const eligible = (pointer) => {
    if (level === 'full') return true
    if (!manualFree) return !isPointerCoolingDown(cooldowns, pointer, turn, cooldownTurns)
    const gate = cooldownGate(cooldowns, manualFree, pointer, turn, cooldownTurns)
    const key = pointerKey(pointer[0], pointer[1])
    if (gate.drop) staleFree.add(key)
    if (gate.consume) usedFree.add(key)
    return gate.pass
  }
  const visible = mine
    .filter(eligible)
    .filter((pointer) => !(skip instanceof Set) || !skip.has(pointerKey(pointer[0], pointer[1])))
  if (!visible.length) {
    return {
      ok: true,
      name: personName,
      level,
      text: `▍${personName}\n（这些认知都在冷却里，想看全部请用「全量」）`,
      pointers: [],
      manualFreeUsed: [],
      manualFreeStale: [...staleFree],
    }
  }

  const lines = [`▍${personName}`]
  const used = []
  for (const pointer of visible) {
    const claim = claimById.get(pointer[1])
    if (!claim) continue
    if (level === 'brief') {
      lines.push(`· ${claim[3]}`)
    } else {
      const groups = visibleGroups(pointer, conflictDisplay)
      const detail = groups.map((group) => describeGroup(group, nameOf)).join('；')
      lines.push(`· ${claim[3]}${detail ? `：${detail}` : ''}`)
    }
    used.push(pointer)
  }

  // 只有**真进了这段文本**的才算用掉：全量档没经过冷却闸，这里兜一遍；
  // 被 `skip` 挡掉的、以及没进 used 的，一律不算。
  const usedKeys = new Set(used.map((pointer) => pointerKey(pointer[0], pointer[1])))
  for (const pointer of used) {
    const key = pointerKey(pointer[0], pointer[1])
    // 已经判为 stale 的（本来就冷却）别重复记成 used——两条都报会让调用方分不清
    if (manualFree?.[key] && !staleFree.has(key)) usedFree.add(key)
  }
  return {
    ok: true,
    name: personName,
    level,
    text: lines.join('\n'),
    pointers: used,
    manualFreeUsed: [...usedFree].filter((key) => usedKeys.has(key)),
    manualFreeStale: [...staleFree],
  }
}

/**
 * 把排队中的「手动召回」拼成下一轮的注入文本。
 *
 * 队列由面板写入（`recall-person`），由召回注入点消费：
 *   · 每人一段，空段（认知全在冷却里、或已经没有认知）**不占提示词**；
 *   · `stamps` 是注入了的指针——调用方拿它盖召回冷却章；
 *   · `done` 是**处理过**的编号（含没内容的），调用方据此清队列，别让队列烂在那儿。
 *
 * @param {object} input
 * @param {object} input.snapshot 快照
 * @param {Array<{personId:string, level:string}>} [input.pending] 排队表
 * @param {object} [input.cognition] 设置里的「认知」组（P20）：显示口径跟自动召回一致
 * @returns {{text:string, stamps:any[], done:string[]}}
 */
export function buildPendingRecallText({
  snapshot,
  pending = [],
  cooldowns = {},
  manualFree = null,
  cooldownTurns = 0,
  turn = 0,
  skip = null,
  cognition = undefined,
} = {}) {
  const seen = new Set()
  const blocks = []
  const stamps = []
  const done = []
  // 手动豁免（ADR 0118）：这条路的输出会真进提示词，所以要消费标记
  const usedFree = new Set()
  const staleFree = new Set()

  for (const item of Array.isArray(pending) ? pending : []) {
    const id = String(item?.personId ?? '').trim()
    // 空编号的垃圾项也要记进 done：调用方拿 done 出队，不记就永远留在队列里
    if (!id) {
      done.push(id)
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    done.push(id)

    const result = queryPerson({
      snapshot,
      personId: id,
      level: normalizeLevel(item?.level, 'detailed'),
      cooldowns,
      manualFree,
      cooldownTurns,
      turn,
      skip,
      cognition,
    })
    // 无效的标记不管这次有没有给出内容，都报上去清掉
    for (const key of result.manualFreeStale ?? []) staleFree.add(key)
    if (!result.ok || !result.pointers.length) continue
    blocks.push(result.text)
    stamps.push(...result.pointers)
    for (const key of result.manualFreeUsed ?? []) usedFree.add(key)
  }

  // 加一句抬头：不然模型分不清「程序按场景挑的」和「玩家点名要它记住的」
  const text = blocks.length ? `【玩家点名要求你记住的】\n\n${blocks.join('\n\n')}` : ''
  return { text, stamps, done, manualFreeUsed: [...usedFree], manualFreeStale: [...staleFree] }
}
