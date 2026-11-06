// 召回引擎（ADR 0082 / 0085 / 0086 / 0087 / 0089）：正文生成前，把「在场人物的认知」拼成一段注入。
//
// 一条召回单位 = **一条指针**（某人 × 某命题）。按人分块给模型看：
//
//   ▍老陈
//   · 主角欠他一笔钱：真（昨天，听李四说的）
//
// 装配顺序：主角全量（回场那一次）→ ★重要人物（60%）→ 普通角色（剩下的）。
// 同一个人内部：必带栏目先给，其余按打分（关于在场他人 +3／关于地点 +2／索引词命中 +2）。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { STATUS } from './snapshot.js'
import { isPlayer } from './player.js'
import { isPointerCoolingDown } from './cooldown.js'
import { TRUTH, SELF, UNKNOWN_SOURCE, visibleGroups } from './pointers.js'
import { fillTemplate } from './promptTemplates.js'
import { autoWordsOf } from './indexWords.js'

const STATE_LABEL = Object.freeze({ [TRUTH.TRUE]: '真', [TRUTH.FALSE]: '假', [TRUTH.UNKNOWN]: '未定' })
const CONVENTION_LABEL = Object.freeze({ 0: '没完成', 1: '完成了', 2: '过期了', 3: '失败了' })

/** 按码点算字数（注入预算用这个口径）。 */
export function charCount(text) {
  return [...String(text ?? '')].length
}

/** 本局的地类索引词集合（只认本局，不认全局词库）。 */
function placeWordsOf(snapshot) {
  const words = new Set()
  for (const claim of Array.isArray(snapshot?.c) ? snapshot.c : []) {
    for (const word of Array.isArray(claim?.[5]) ? claim[5] : []) {
      if (word?.类 === '地' && typeof word?.词 === 'string' && word.词.trim()) words.add(word.词.trim())
    }
  }
  return words
}

/** 这组来源怎么说人话。 */
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
 * 给一条指针算分（ADR 0089 §2，固定常量）。
 * @returns {number}
 */
export function scorePointer({ claim, presentIdSet, selfId, loc, text, placeWords }) {
  let score = 0
  const about = claim?.[1]
  // ① 关于「在场其他人物」——模型写对白时最需要知道的
  if (about && about !== selfId && presentIdSet.has(about)) score += 3
  // ② 关于「当前地点」
  const words = Array.isArray(claim?.[5]) ? claim[5] : []
  if (loc && words.some((word) => word?.类 === '地' && word?.词 && loc.includes(word.词))) score += 2
  // ③ 在本轮文本里命中：模型抽的索引词 **＋ 程序从值里自动分出来的通用词**
  //    （2026-11-06：模型只管专名，像「收银员」这种词由程序兜，否则正文聊到它召不回来）
  void placeWords
  if (text) {
    const body = String(text)
    const picked = words.some((word) => word?.词 && body.includes(word.词))
    if (picked || autoWordsOf(claim?.[3]).some((word) => body.includes(word))) score += 2
  }
  return score
}

/**
 * 主入口。
 *
 * @param {object} input
 * @param {object} input.snapshot 快照（p / c / pt / gt / loc）
 * @param {number} input.turn 当前轮
 * @param {object} input.definitions 栏目定义（码 → { name, mustRecall, convention }）
 * @param {Set<string>} input.checkedCodes 勾选召回的栏目
 * @param {Set<string>} input.hidden 眼睛闭上的人
 * @param {Set<string>} input.starIds ★重要人物
 * @param {object} input.cooldowns 冷却表
 * @param {number} input.cooldownTurns 冷却轮数（0＝关）
 * @param {number} input.budget 总字数预算
 * @param {object|null} input.playerBack 主角回场标记 `{ turn }`（null＝没有）
 * @param {string} input.viewpoint 人称中文名（"第二人称"）
 * @param {string} input.text 本轮玩家输入
 * @param {Set<string>} input.deletedNames 已删除的人名（兜住删人后残留的指针）
 * @param {object} [input.cognition] 设置里的「认知」组（P20）。不传＝全部显示，行为跟以前一样
 * @returns {{text:string, used:number, blocks:Array}}
 */
export function buildRecallSection({
  snapshot,
  turn = 0,
  definitions = {},
  checkedCodes = new Set(),
  hidden = new Set(),
  starIds = new Set(),
  cooldowns = {},
  cooldownTurns = 0,
  budget = 3000,
  playerBack = null,
  viewpoint = '主角',
  text = '',
  deletedNames = new Set(),
  template = undefined,
  cognition = undefined,
} = {}) {
  // 一条指针可能挂着几组来源；显示几组由设置决定，只影响注入文本（P20）
  const conflictDisplay = cognition?.conflictDisplay ?? 'all'
  const people = Array.isArray(snapshot?.p) ? snapshot.p : []
  const claims = Array.isArray(snapshot?.c) ? snapshot.c : []
  const pointers = Array.isArray(snapshot?.pt) ? snapshot.pt : []
  const loc = String(snapshot?.loc ?? '')
  const gt = String(snapshot?.gt ?? '')

  const personById = new Map()
  for (const person of people) {
    if (Array.isArray(person) && person[0]) personById.set(String(person[0]), person)
  }
  const claimById = new Map()
  for (const claim of claims) {
    if (Array.isArray(claim)) claimById.set(claim[0], claim)
  }
  const nameOf = (id) => String(personById.get(String(id))?.[2] ?? '').trim()

  const presentIdSet = new Set(
    people.filter((person) => Array.isArray(person) && person[1] === STATUS.PRESENT).map((person) => String(person[0])),
  )
  const placeWords = placeWordsOf(snapshot)

  // ── 捞候选：一个人一叠指针 ──
  const byPerson = new Map()
  for (const pointer of pointers) {
    if (!Array.isArray(pointer)) continue
    const personId = String(pointer[0] ?? '')
    const person = personById.get(personId)
    if (!person) continue                                   // 闸 1：人还在
    if (!nameOf(personId)) continue                          // 闸 1：姓名非空
    if (deletedNames.has(nameOf(personId))) continue         // 闸 1：不在已删除名单
    if (hidden.has(personId)) continue                       // 闸 2：眼睛没闭
    if (person[1] !== STATUS.PRESENT) continue               // 闸 5：在场
    const isPlayerSelf = isPlayer(personId)
    // 主角在场时**不是召回源**（ADR 0085）；他的全量走 playerBack 那条路
    if (isPlayerSelf) continue

    const claim = claimById.get(pointer[1])
    if (!claim) continue
    const code = claim[2]
    const definition = definitions?.[code]
    if (!definition) continue
    if (checkedCodes.size && !checkedCodes.has(code)) continue   // 闸 3：栏目被勾选
    // 闸 4：指针级冷却（建立/修改盖章 + 召回盖章，ADR 0086）
    if (cooldownTurns > 0 && isPointerCoolingDown(cooldowns, pointer, turn, cooldownTurns)) continue

    const score = scorePointer({ claim, presentIdSet, selfId: personId, loc, text, placeWords })
    const bucket = byPerson.get(personId) ?? []
    bucket.push({ pointer, claim, definition, score })
    byPerson.set(personId, bucket)
  }

  // ── 主角回场：全量注入一次（只按他自己的指针来）──
  const blocks = []
  // 与 blocks 一一对应：每块装了哪些指针。**只有真装进去的**才记，
  // 调用方拿它盖召回冷却章（2026-11-05 补），没给出去的绝不盖章。
  const blockPointers = []
  let used = 0
  const linesOf = (name, items, { detailed = true } = {}) => {
    const lines = [`▍${name}`]
    for (const item of items) {
      const detail = detailed ? describeGroups(item.pointer, nameOf, conflictDisplay) : ''
      const convention = ''
      void convention
      lines.push(`· ${item.claim[3]}${detail ? `：${detail}` : ''}`)
    }
    return lines
  }

  if (playerBack && nameOf('p0')) {
    const playerItems = []
    for (const pointer of pointers) {
      if (!Array.isArray(pointer) || String(pointer[0]) !== 'p0') continue
      const claim = claimById.get(pointer[1])
      if (!claim) continue
      // 冷却对"全量"不设限——玩家显式要的（ADR 0089 §9），但灌完会盖章（这里不管，调用方盖）
      playerItems.push({ pointer, claim, score: 0 })
    }
    if (playerItems.length) {
      const limit = 1000
      const lines = [`▍${nameOf('p0')}`]
      const taken = []
      for (const item of playerItems) {
        const line = `· ${item.claim[3]}：${describeGroups(item.pointer, nameOf, conflictDisplay)}`
        if (used + charCount(line) > limit) break
        lines.push(line)
        taken.push(item.pointer)
        used += charCount(line)
      }
      if (lines.length > 1) {
        blocks.push(lines.join('\n'))
        blockPointers.push(taken)
      }
    }
  }

  // ── 分预算：★ 先拿 60%，普通拿剩下的；★ 用剩的还回普通 ──
  const remaining = Math.max(0, budget - used)
  const starIdsInPool = [...byPerson.keys()].filter((id) => starIds.has(id))
  const normalIdsInPool = [...byPerson.keys()].filter((id) => !starIds.has(id))
  // 没有 ★ 人物时 60% 白留就浪费了 —— 全给普通角色（这是常态局，不是边角）
  const starShare = starIdsInPool.length ? Math.round(remaining * 0.6) : 0
  let starLeft = starShare
  let normalLeft = remaining - starShare

  const renderPerson = (personId, items, cap) => {
    const name = nameOf(personId)
    const must = items.filter((item) => item.definition?.mustRecall === true)
    const rest = items
      .filter((item) => item.definition?.mustRecall !== true)
      .sort((a, b) => b.score - a.score
        || (Number(b.pointer[3] ?? 0) - Number(a.pointer[3] ?? 0))
        || (Number(b.claim[4] ?? 0) - Number(a.claim[4] ?? 0)))

    const lines = [`▍${name}`]
    let left = cap
    const taken = []
    const push = (item, detailed) => {
      const detail = detailed ? describeGroups(item.pointer, nameOf, conflictDisplay) : ''
      const line = `· ${item.claim[3]}${detail ? `：${detail}` : ''}`
      const chars = charCount(line) + 1
      if (chars > left) return false
      lines.push(line)
      left -= chars
      taken.push(item.pointer)
      return true
    }

    for (const item of must) push(item, true)
    for (const item of rest) {
      if (push(item, true)) continue
      if (push(item, false)) continue
    }
    const spent = cap - left
    const hasContent = lines.length > 1
    return { text: hasContent ? lines.join('\n') : '', spent, pointers: hasContent ? taken : [] }
  }

  // ★ 先给
  const starEach = starIdsInPool.length ? Math.floor(starShare / starIdsInPool.length) : 0

  for (const personId of starIdsInPool) {
    const rendered = renderPerson(personId, byPerson.get(personId), Math.max(0, Math.min(starEach, starLeft)))
    if (rendered.text) {
      blocks.push(rendered.text)
      blockPointers.push(rendered.pointers)
      used += rendered.spent
      starLeft -= rendered.spent
    }
  }

  // ★ 没用完的预算还回普通角色（不然这份就白扔了）
  normalLeft += starLeft

  // 普通角色：把剩下的预算平分
  const normalEach = normalIdsInPool.length ? Math.floor(normalLeft / normalIdsInPool.length) : 0
  for (const personId of normalIdsInPool) {
    const rendered = renderPerson(personId, byPerson.get(personId), Math.max(0, Math.min(normalEach, normalLeft)))
    if (rendered.text) {
      blocks.push(rendered.text)
      blockPointers.push(rendered.pointers)
      used += rendered.spent
      normalLeft -= rendered.spent
    }
  }

  if (!blocks.length) return { text: '', used, blocks: [], pointers: [] }

  // 召回模板（assets/recall-prompt.txt）：玩家可以在面板里改骨架，
  // 占位符 {{VIEWPOINT}} / {{GT}} / {{LOC}} / {{STAMP}} / {{BLOCKS}}。
  if (typeof template === 'string' && template.trim()) {
    const stamp = [gt, loc].filter(Boolean).join(' · ')
    const templated = fillTemplate(template, {
      VIEWPOINT: viewpoint,
      GT: gt,
      LOC: loc,
      STAMP: stamp,
      BLOCKS: blocks.join('\n\n'),
    })
    return { text: templated, used: charCount(templated), blocks, pointers: blockPointers.flat() }
  }

  // ── 抬头（ADR 0089 §8 重做）──
  const head = [`【人物档案参考】本局写作人称：${viewpoint}`]
  const meta = [gt, loc].filter(Boolean).join(' · ')
  if (meta) head.push(`现在：${meta}`)
  head.push('下面是各人**自己记得的事**（是认知，不保证是客观真相）。只用来让人物言行前后一致，不要在正文里复述。')

  const text2 = [...head, '', ...blocks].join('\n\n')
  if (charCount(text2) > budget) {
    // 超预算就从尾巴砍整块（指针清单跟着一起砍）
    let keep = [...blocks]
    let keepPointers = [...blockPointers]
    while (keep.length && charCount([...head, '', ...keep].join('\n\n')) > budget) {
      keep.pop()
      keepPointers.pop()
    }
    const trimmed = [...head, '', ...keep].join('\n\n')
    return {
      text: keep.length ? trimmed : '',
      used: charCount(trimmed),
      blocks: keep,
      pointers: keep.length ? keepPointers.flat() : [],
    }
  }
  return { text: text2, used: charCount(text2), blocks, pointers: blockPointers.flat() }
}

/**
 * 把一条指针的来源组拼成一句话。
 * 显示几组看设置（conflictDisplay）：都显示／只显示他本人那组／只显示最后一组（P20）。
 */
function describeGroups(pointer, nameOf, conflictDisplay = 'all') {
  const groups = visibleGroups(pointer, conflictDisplay)
  if (!groups.length) return ''
  return groups.map((group) => describeGroup(group, nameOf)).join('；')
}
