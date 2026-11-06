// 每轮发什么：判定素材与写入素材（docs/每轮发什么.md）
//
// 两次 followup 各发一段**素材**，规则全在系统提示词里（docs/系统提示词.md）：
//   【判定】—— 只判「人」：谁该建档、谁明确离场/回场
//   【写入】—— 只判「认知」：这些人知道了什么、信不信、谁说的
//
// 两条铁律：
//   · 轮次绝不发给模型（ADR 0025）——所以素材里一个"第几轮"都不会出现；
//   · 只放模型算不出来的东西（ADR 0033）——正文、跨轮状态、模糊建档名单。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。
import { fillTemplate } from './promptTemplates.js'
import { STATUS } from './snapshot.js'
import { TRUTH as PTRUTH, SELF, UNKNOWN_SOURCE } from './pointers.js'

const STATUS_LABEL = Object.freeze({
  [STATUS.OFFLINE]: '离场',
  [STATUS.PRESENT]: '在场',
})

/** 一段素材的公共抬头：标题 + 当前游戏内时间（没有就省略那一行）。 */
function head(title, gt) {
  const lines = [title]
  const now = typeof gt === 'string' ? gt.trim() : ''
  if (now) {
    lines.push('', `【当前游戏内时间】${now}`)
  }
  return lines
}

/**
 * 判定素材。
 * @param {{gt?:string, mentioned?:Array<{id:string,name:string,status:number}>,
 *          draft?:object, body?:string}} input
 *   mentioned：**程序扫本轮正文**命中的已建档人物及其状态（ADR 0032）
 *   draft：模糊建档表 `{姓名: 入表轮次}`——只给名字，轮次不给模型
 * @returns {string}
 */
/**
 * 人块标题里怎么称呼这个人。
 * **平时只写名字**——编号是引擎概念，模型不该看到（ADR 0048）；
 * 只有**重名**时，才临时在括号里带上编号，好让模型照抄、程序能定位。
 */
function labelOf(person) {
  // **只写名字**。人物编号是内部码，模型任何阶段都不该看到（ADR 0061）。
  return String(person?.name ?? '').trim()
}

export function buildJudgePrompt({ gt = '', mentioned = [], draft = {}, body = '' } = {}) {
  const lines = head('【判定】', gt)

  const people = Array.isArray(mentioned) ? mentioned.filter((item) => item?.name) : []
  if (people.length) {
    lines.push('', '【本轮提到的人】')
    for (const item of people) {
      lines.push(`· ${labelOf(item)} —— ${STATUS_LABEL[item.status] ?? '在场'}`)
    }
  }

  const names = Object.keys(draft ?? {})
  if (names.length) {
    lines.push('', `【模糊建档】${names.join('、')}`)
  }

  const text = String(body ?? '')
  if (text) {
    lines.push('', '【本轮正文】', text)
  }

  return lines.join('\n')
}

/**
 * 写入素材（ADR 0083 阶段二）。
 *
 * 按人组织：每个人下面列**他脑子里跟当前场景有关**的命题，每行带他的指针描述。
 * 序号是局部的（1、2、3…），同一条命题在不同人下面用**同一个序号**——
 * 模型报「序号」时程序靠这张映射找回命题 ID。
 *
 * @param {{gt?:string, loc?:string,
 *          people?:Array<{id:string,name:string,status:number,fresh?:boolean,
 *                         claims?:Array<{claim:any[],pointer:any[]|null}>}>,
 *          mentioned?:Array<{id:string,name:string,claims?:Array<{claim:any[],pointer:any[]|null}>}>,
 *          definitions?:object, checkedCodes?:Set<string>,
 *          textOf?:(claim:any[])=>string, nameOf?:(id:string)=>string,
 *          template?:string}} input
 * @returns {string}
 */
export function buildWritePrompt({
  gt = '',
  loc = '',
  people = [],
  mentioned = [],
  definitions = {},
  checkedCodes = undefined,
  textOf = (claim) => String(claim?.[3] ?? ''),
  nameOf = (id) => String(id ?? ''),
  template = undefined,
  askPlace = false,
} = {}) {
  const lines = head('【写入】', gt)
  const place = typeof loc === 'string' ? loc.trim() : ''
  if (place) lines.push(`【当前地点】${place}`)
  // 非 MVU 卡、程序也不知道现在在哪：顺口问模型一句（ADR 0089 §5）。
  // 它报的地点会被程序拿去和「本局已有的地类索引词」比对，编的不要。
  else if (askPlace) {
    lines.push('', '【顺带一问】如果你知道故事现在发生在哪儿，请在返回里加一个 `地点` 字段（必须是这局正文/档案里出现过的地名；拿不准就不写）。')
  }

  // 局部序号：同一条命题在所有人物下面共用一个号，模型报回来才能对得上
  const order = new Map()
  let seq = 0
  const seqOf = (claimId) => {
    if (!order.has(claimId)) order.set(claimId, ++seq)
    return order.get(claimId)
  }

  const allowed = checkedCodes ?? new Set(Object.keys(definitions))
  const shared = { definitions, allowed, textOf, nameOf, seqOf }

  for (const person of Array.isArray(people) ? people : []) {
    if (!person?.name) continue
    const status = STATUS_LABEL[person.status] ?? '在场'
    const suffix = person.fresh ? '（本轮新建档，栏目全空）' : ''
    lines.push('', `【${labelOf(person)} · ${status}】${suffix}`)
    pushClaimBlocks(lines, person.claims, { ...shared, listEmptyWhenBlank: true })
  }

  const others = Array.isArray(mentioned) ? mentioned.filter((item) => item?.name) : []
  if (others.length) {
    lines.push('', '【正文提到、但不在场】')
    for (const person of others) {
      lines.push(`· ${labelOf(person)}`)
      pushClaimBlocks(lines, person.claims, shared)
    }
  }

  // 玩家自定义模板：先用内置骨架拼出「人头块」，再整段套进模板
  if (typeof template === 'string' && template.trim()) {
    const blocks = lines.slice(1).join('\n').trim() // 去掉开头的「【写入】」标题
    const rendered = fillTemplate(template, { GT: gt, PEOPLE: blocks })
    // 合并调用时写入段不重复时间（gt 传空）：模板里那行时间标题也一并去掉，
    // 否则会渲染出一行空的「【当前游戏内时间】」。
    if (!String(gt ?? '').trim()) {
      return rendered.replace(/^[ \t]*【当前游戏内时间】[^\n]*\n?/m, '').trim()
    }
    return rendered
  }
  return lines.join('\n')
}

/**
 * 每轮工单开头的「动态上下文」：本局视角、玩家称呼、代词规则、栏目定义、认知口径、约定规则。
 *
 * 为什么单独抽出来：成员（member）的系统提示词是**固定**的（每局一次、能缓存），
 * 而这几样每局／每卡都不一样，只能每轮随工单发。
 *
 * @param {{viewpoint?:string, playerName?:string, entriesText?:string,
 *          definitions?:object, cognition?:object}} input
 *   definitions：本局栏目定义（看有没有【约定】栏目，决定发不发【约定规则】）；
 *   不传时按 `entriesText` 里的【约定】标记兜底。**不传 definitions 也不发这段**。
 *   cognition：设置里的「认知」组（P20）。**不传就【认知口径】整段不出**——
 *   老调用方（没读设置）行为跟以前完全一样；【约定规则】不依赖 cognition。
 */
export function buildContextText({ viewpoint = '第二人称', playerName = '主角', entriesText = '', definitions = undefined, cognition = undefined } = {}) {
  const name = String(playerName || '主角').trim() || '主角'
  const lines = [
    `【本局视角】${viewpoint}；主角＝${name}。`,
    '',
    '**代词不算人名**（三类任务都遵守）：',
    `· 第二人称：「你」在叙述层里就是主角 ${name}，不要给他另建一个叫「你」的人物。`,
    `· 第一人称：「我」在叙述层里就是主角 ${name}，同上。`,
    `· 第三人称：主角直接用名字 ${name} 称呼；「他／她」可能指任何人，**不能**当主角的指代。`,
    '· **只有叙述层算**：引号（「」或 ""）里的代词指**说话对象**，可能是任何一个在场角色。',
    '  例：示例甲对示例乙说「你怎么看」——这个「你」是示例乙；示例甲说「我不去」——这个「我」是示例甲。',
    `· 报「关于谁」「谁认为」「人物是谁」时一律写**档案里的名字**（姓名或别名）；指主角就写 ${name}。`,
  ]
  const entries = String(entriesText || '').trim()
  if (entries) {
    lines.push('', '【栏目定义】', entries)
  }
  // 认知口径（P20）：模型的「态度」怎么给。以前这两条写死在系统提示词里，
  // 但提示词是固定的一份（能缓存），口径却是每局可改的，所以只能随工单发。
  if (cognition && typeof cognition === 'object') {
    const rawAttitude = String(cognition.defaultAttitude ?? '').trim()
    // 认不出的值回落到「未定」：宁可保守，也别让模型拿到一句看不懂的口径
    const attitude = ['未定', '真', '假'].includes(rawAttitude) ? rawAttitude : '未定'
    lines.push('', '【认知口径】')
    lines.push(`· 模型判断不了某事真假时，态度给「${attitude}」。`)
    if (cognition.eyewitnessTrue === false) {
      // 关掉＝「亲见」不再自动升级成「真」，但**也不是一律未定**：
      // 要让模型看正文里这个人自己的表现（他明确信了/他怀疑），看不出来才落到默认态度。
      // 「真／假」也不能一起废：系统提示词里还有一条「别人说的跟他自己知道的相反 → 写相反的态度」。
      lines.push(`· 谁亲眼见到都不自动算「真」：按正文里他自己的表现判断——他明确信了、或这话本来就是他说的，给「真」；他明确不信、怀疑、觉得是假的，给「假」；看不出来，给「${attitude}」。`)
    } else {
      // 两条都得写：只写「主角」的话，NPC 自己亲眼确认过的情形在口径里就悬空了，
      // 模型只能自己发挥（一律未定 or 把主角那条泛化给所有人），行为不稳定。
      lines.push('· 主角亲眼见到的，可以直接给「真」。')
      lines.push('· 其他角色自己亲眼确认过、有自己判断的，按他们自己的判断给「真」或「假」。')
    }
    // 上限得告诉模型：只在存储侧丢最早的，模型会白写一堆然后被默默扔掉
    // （跟 pointers.js 的 setEntry 用同一套兜底：不是 1 以上的整数就按 3）
    const rawLimit = Number(cognition.maxOtherSources)
    const limit = Number.isInteger(rawLimit) && rawLimit >= 1 ? rawLimit : 3
    lines.push(`· 一条命题最多给 ${limit} 个「谁知道」（超过的会被丢掉，先丢最早的）。`)
  }
  // 约定细则只在**本局真有【约定】栏目**时才发：默认 8 栏一个都没勾，
  // 放固定系统提示词里等于每轮白烧 400 多字（ADR 0105）。
  // 老调用方可能只传 entriesText、不传 definitions；此时按渲染好的栏目表里的
  // 【约定】标记兜底，免得「栏目表有标记、工单却没有约定规则」。
  const hasConvention = (definitions && typeof definitions === 'object'
    && Object.values(definitions).some((item) => item?.convention === true))
    || /【约定】/.test(String(entriesText || ''))
  if (hasConvention) {
    lines.push('', '【约定规则】')
    lines.push('· 只有【栏目定义】表里标着【约定】的栏目，每条 `认知` 才写 `约定` 字段，值为 `没完成`／`完成了`／`过期了`／`失败了`；别的栏目别写。')
    lines.push('· 约定时间还没到、或者到了还没兑现 → `没完成`；正文明确兑现 → `完成了`；时间已过没人做到 → `过期了`；明确写出来这事黄了 → `失败了`。')
    lines.push('· 上一轮素材里给你的约定类命题，这一轮重新判断状态；正文没提、并且**约定时间还没过**，才沿用上次的状态。')
    lines.push('· 例：{ "关于":"示例甲", "栏目":"未了事项", "值":"约示例乙明天卯时码头见", "认知":[ { "谁":"示例乙", "来源":"自己", "态度":"真", "约定":"没完成" } ] }')
  }
  return lines.join('\n')
}

/**
 * 合并素材：判人段 + 写入段，**一次发出去**。
 *
 * 为什么合并：member / 后台结算档下，正文生成和结算共用一次模型调用；
 * 分两次发消息的旧链路在那里走不通（ADR 0092）。
 *
 * 判人段直接复用 buildJudgePrompt，写入段复用 buildWritePrompt（写入段不再重复时间行）。
 */
export function buildCombinedPrompt({
  gt = '', loc = '',
  mentioned = [], draft = {}, body = '',
  people = [], mentionedPeople = [],
  definitions = {}, checkedCodes = undefined,
  textOf = (claim) => String(claim?.[3] ?? ''),
  nameOf = (id) => String(id ?? ''),
  askPlace = false,
  writeTemplate = undefined,
} = {}) {
  const judge = buildJudgePrompt({ gt, mentioned, draft, body })
  const write = buildWritePrompt({
    gt: '',   // 时间已经在判人段出现过，写入段不再重复
    loc,
    people,
    mentioned: mentionedPeople,
    definitions,
    checkedCodes,
    textOf,
    nameOf,
    askPlace,
    template: writeTemplate,
  })
  return `${judge}\n\n${write}`
}

function pushClaimBlocks(lines, claims, { definitions, allowed, textOf, nameOf, seqOf, listEmptyWhenBlank = false }) {
  const list = Array.isArray(claims) ? claims : []
  // 一条命题都没有：把勾选的栏目名列出来。
  // 不列的话素材里只有人名、什么都没有——模型会直接返回空数组，一个人都建不出来。
  if (!list.length) {
    if (!listEmptyWhenBlank) return
    const names = Object.keys(definitions)
      .filter((code) => allowed.has(code))
      .map((code) => definitions[code]?.name || code)
    if (names.length) lines.push(`  （这些栏目还空着：${names.join('、')}）`)
    return
  }
  for (const code of Object.keys(definitions)) {
    if (!allowed.has(code)) continue
    const rows = list.filter((item) => item?.claim?.[2] === code)
    if (!rows.length) continue
    lines.push(`· ${definitions[code]?.name || '（未命名栏目）'}`)
    for (const item of rows) {
      const no = seqOf(item.claim[0])
      const detail = describePointer(item.pointer, nameOf)
      lines.push(`  ${no}. ${textOf(item.claim)}${detail ? ` ｜ ${detail}` : ''}`)
    }
  }
}

/**
 * 把一条指针渲染成人话。
 *
 * 「自己」那组说的是**他自己的判断**（他确认过 / 他认为错了 / 他也拿不准）；
 * 「别人」那组说的是**他从谁那儿听来的、信不信**（ADR 0083：状态＝信不信这个来源）。
 */
function describePointer(pointer, nameOf) {
  const states = Array.isArray(pointer?.[2]) ? pointer[2] : []
  if (!states.length) return ''
  return states
    .map((entry) => {
      const state = entry?.[0]
      const source = entry?.[1]
      if (source === SELF) {
        if (state === PTRUTH.TRUE) return '他自己确认过'
        if (state === PTRUTH.FALSE) return '他认为这是错的'
        return '他自己也拿不准'
      }
      const who = source === UNKNOWN_SOURCE ? '' : `听${nameOf(source)}说的`
      const lead = who ? `他${who}` : '他听说的'
      if (state === PTRUTH.TRUE) return `${lead}，信了`
      if (state === PTRUTH.FALSE) return `${lead}，认为是假的`
      return `${lead}，拿不准`
    })
    .join('；')
}
