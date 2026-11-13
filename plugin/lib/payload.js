// 解析模型交回来的 payload（ADR 0064）
//
// 两种形状，按阶段分：
//   判定：{ 建档:[…], 改状态:[…], 模糊建档:[…] }
//   写入：[ {关于, 栏目, 值, 序号?, 索引词?, 认知:[{谁,态度,来源}]}, … ]
//
// 写入改成扁平数组：一条动作自带「关于谁」+「谁知道了」，不再按人分块——
// 同一条命题可能被多个人知道，分块会把命题内容重复写好几遍（ADR 0083）。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// ── 交卷形状兜底（ADR 0109）──
//
// 模型有时把整份交卷 JSON 当字符串塞进一个自己编的键里（`{parameter:"{…}"}`、`{parent:"{}",https:"{…}"}`）。
// 解析器只认顶层键，于是判定与写入两段都读成「0 条动作」；交卷工具还回 ok，
// 模型以为交成功了，下一轮继续这么交——2026-11-12 就是这么静默空了 24 轮。
//
// 所以：解析前先剥壳（本段），交卷工具再用 acceptShape 判断形状认不认得，不认得就退回让模型自纠。

const JSON_FENCE = /^```[a-zA-Z]*\s*|```\s*$/g

/** 判定块与写入块共用的顶层键。剥壳只在「一个都不认得」时才动手。 */
export const PAYLOAD_KEYS = Object.freeze([
  '回头测试', '建档', '改状态', '改名', '模糊建档',
  '通过', '不通过', '命题', '撤回', '地点',
])

/** 字符串里藏着对象就解析出来，否则给 undefined（只认 `{` / `[` 开头，不瞎猜）。 */
function tryJsonString(value) {
  if (typeof value !== 'string') return undefined
  const text = value.trim().replace(JSON_FENCE, '').trim()
  if (!text) return undefined
  const head = text[0]
  if (head !== '{' && head !== '[') return undefined
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * 剥掉模型自造的壳：`{parameter:"{…}"}` / `{parent:"{}",https:"{…}"}` / `["{…}"]`。
 *
 * 顶层已经认得任何已知键就原样返回（**绝不误伤正常交卷**）；
 * 否则逐个字符串值试解析，最多剥 4 层（正常最多两层：壳套壳）。
 *
 * @param {any} payload
 * @param {readonly string[]} [keys] 视为「认得」的顶层键
 * @param {number} [depth] 递归层数（内部用）
 * @returns {any} 剥不动就返回原值
 */
export function unwrapPayload(payload, keys = PAYLOAD_KEYS, depth = 0) {
  // 上限 4 层（实测最多两层：壳套壳）。写 >= 而不是 >：`depth` 是「已经剥了几层」，
  // `> 4` 会实际剥到 5 层，跟文档对不上。
  if (depth >= 4) return payload
  if (Array.isArray(payload)) {
    if (payload.length === 1) {
      const inner = tryJsonString(payload[0])
      if (inner) return unwrapPayload(inner, keys, depth + 1)
    }
    return payload
  }
  if (!isPlainObject(payload)) return payload
  if (keys.some((key) => payload[key] !== undefined)) return payload
  const candidates = Object.values(payload).map(tryJsonString).filter(Boolean)
  if (!candidates.length) return payload
  // 双键包装（parent + https）里只有一个装着真内容：优先挑认得出的那个
  const next = candidates.find((one) => keys.some((key) => one[key] !== undefined))
    ?? candidates[candidates.length - 1]
  return unwrapPayload(next, keys, depth + 1)
}

/**
 * 这次交卷的形状认不认得：解包后能认出已知键，或者是「主动交空」。
 *
 * 只用来给模型回执——认不得就回 `ok:false` 让它重交，别把脏载荷合并进盒子里
 * （合并进去了，/debug 里只剩「0 条动作」，看不出是形状问题）。
 */
export function acceptShape(args) {
  if (args == null) return false
  const unwrapped = unwrapPayload(args)
  if (unwrapped !== args) return true
  if (isPlainObject(args)) {
    if (!Object.keys(args).length) return true   // 「没有要做的就交 {}」是合法行为
    return PAYLOAD_KEYS.some((key) => args[key] !== undefined)
  }
  // 顶层数组：老形状的扁平动作列表（parseJudgePayload 仍认它）
  if (Array.isArray(args)) return args.every(isPlainObject)
  return false
}

/** 退回给模型的话：说清怎么改，别只说「不对」（模型下一轮才知道该怎么重交）。 */
export const SUBMIT_SHAPE_ERROR = '交卷形状不对：请把动作对象**直接**作为参数提交（顶层就是 回头测试/建档/改状态/改名/模糊建档/命题/撤回/地点），不要把 JSON 包成字符串、也不要塞进别的键里。示例见系统提示词「六、输出」。'

/**
 * 交卷工具入口的统一守卫（子代理档与后台成员档共用同一份契约，ADR 0092/0109）。
 *
 * 认不得的形状**不入盒**：合进去只会让 /debug 里只剩「0 条动作」，
 * 而模型那边收到 ok，下一轮继续照样交——2026-11-12 的空转就是这么来的。
 *
 * @param {any} args 工具收到的参数
 * @returns {{ok:true, value:object} | {ok:false, error:string}}
 */
export function normalizeSubmission(args) {
  // 交卷盒只收对象：顶层数组（哪怕解析层认得）放进去等于静默丢内容，一并退回
  if (!isPlainObject(args)) return { ok: false, error: SUBMIT_SHAPE_ERROR }
  if (!acceptShape(args)) return { ok: false, error: SUBMIT_SHAPE_ERROR }
  return { ok: true, value: args }
}

/**
 * 判定阶段的 payload → 动作列表。
 *
 * @param {any} payload
 * @returns {Array<object>} `建档` / `改状态` / `模糊建档` 三种动作
 */
export function parseJudgePayload(payload) {
  // 兼容：模型直接给数组（老形状）
  if (Array.isArray(payload)) return payload.filter(isPlainObject)

  const source = isPlainObject(payload) ? payload : {}
  const actions = []

  // ── 回头测试（ADR 0062）：模型必须先表态"哪些称呼喊得回" ──
  // 两种写法都认：`{回头测试:{通过,不通过}}` 和顶层 `{通过,不通过}`。
  const lookRaw = isPlainObject(source.回头测试) ? source.回头测试 : source
  const hasLook = Array.isArray(lookRaw.通过) || Array.isArray(lookRaw.不通过)
  if (hasLook) {
    actions.push({
      动作: '回头测试',
      通过: asArray(lookRaw.通过).map((item) => (typeof item === 'string' ? item.trim() : String(item?.称呼 ?? '').trim())).filter(Boolean),
      不通过: asArray(lookRaw.不通过).map((item) => (typeof item === 'string'
        ? { 称呼: item.trim(), 原因: '' }
        : { 称呼: String(item?.称呼 ?? '').trim(), 原因: String(item?.原因 ?? '').trim() })),
    })
  }

  for (const item of asArray(source.建档)) {
    if (!isPlainObject(item)) continue
    actions.push({
      动作: '建档',
      姓名: item.姓名,
      别名: item.别名,
      状态: item.状态,
    })
  }

  for (const item of asArray(source.改状态)) {
    if (!isPlainObject(item)) continue
    actions.push({ 动作: '改状态', 人物: item.姓名 ?? item.人物, 状态: item.状态 })
  }

  for (const item of asArray(source.改名)) {
    if (!isPlainObject(item)) continue
    actions.push({ 动作: '改名', 姓名: item.姓名, 新姓名: item.新姓名 })
  }

  // 「模糊建档」块只要**报了**（数组，哪怕空）就以模型为准；没报才用回头测试兜底。
  // 兜底理由：没过回头测试的人按定义正是「露过脸、但不够格建档」，模型常只在「不通过」
  // 里列一遍、忘了再写进这个块，程序得替它把名字留下，不然下轮要重新认一遍（ADR 0075）。
  const reportedDraft = asArray(source.模糊建档)
  const draftNames = Array.isArray(source.模糊建档)
    ? reportedDraft
    : (hasLook ? asArray(lookRaw.不通过) : [])
  for (const item of draftNames) {
    // 允许写成字符串，也允许写成 {姓名}；兜底来源是 {称呼, 原因}
    const name = typeof item === 'string'
      ? item.trim()
      : textOf(item?.姓名 ?? item?.称呼)
    if (name) actions.push({ 动作: '模糊建档', 姓名: name })
  }

  return actions
}

/**
 * 写入阶段的 payload → 动作列表（ADR 0083）。
 *
 * 一条动作 = 一条命题 + 若干指针：
 *   { 关于, 栏目, 值, 序号?, 索引词?, 认知:[{谁, 态度, 来源}] }
 *
 * 缺字段的条目**照样保留**——交给校验层明确拒掉，比在这里默默吞掉好排查。
 *
 * @param {any} payload
 * @returns {Array<object>}
 */
export function parseWritePayloadBundle(payload) {
  const source = Array.isArray(payload)
    ? payload
    : isPlainObject(payload) && Array.isArray(payload.命题)
      ? payload.命题
      : []
  // 非 MVU 卡才会问「当前地点」，所以它只出现在对象形状里（ADR 0089 §5）
  const place = isPlainObject(payload) ? textOf(payload.地点) : ''

  const actions = []
  for (const item of source) {
    if (!isPlainObject(item)) continue

    const action = {
      关于: textOf(item.关于),
      栏目: textOf(item.栏目),
      值: textOf(item.值),
    }

    // 序号模型常写成字符串，能转就转；非正整数一律当没给
    const no = Number(item.序号)
    if (Number.isInteger(no) && no > 0) action.序号 = no

    if (Array.isArray(item.索引词)) action.索引词 = item.索引词

    action.认知 = (Array.isArray(item.认知) ? item.认知 : [])
      .filter((entry) => isPlainObject(entry) && textOf(entry.谁))
      .map((entry) => {
        const one = {
          谁: textOf(entry.谁),
          态度: textOf(entry.态度),
          来源: textOf(entry.来源),
        }
        // 约定状态只有模型报了才带这个键（非约定类命题不带，省字段）
        const convention = textOf(entry.约定)
        if (convention) one.约定 = convention
        return one
      })

    actions.push(action)
  }

  const parsedRetracts = parseRetracts(payload)
  return { actions, place, retracts: parsedRetracts.list, retractsDropped: parsedRetracts.dropped }
}

/**
 * 撤回块（ADR 0102 / 0106）：`{ 撤回:[{谁, 序号}] }`。
 *
 * `谁` ＝ 持指针的人（改口的人）；命題说的是谁**不用模型报**——序号已锁定命题，
 * 程序自己查得到（ADR 0106 把旧字段 `关于` 换掉，免得和命题里的「关于」撞义）。
 *
 * 序号写的是**素材里那条命题前面的编号**，只认正整数；缺「谁」的条目直接丢，
 * 剩下的交给校验层去拒（这里只做形状清洗，不做权限判断）。
 */
function parseRetracts(payload) {
  const source = isPlainObject(payload) && Array.isArray(payload.撤回) ? payload.撤回 : []
  const out = []
  let dropped = 0
  for (const item of source) {
    if (!isPlainObject(item)) { dropped += 1; continue }
    const name = textOf(item.谁)
    const no = Number(item.序号)
    if (!name || !Number.isInteger(no) || no <= 0) { dropped += 1; continue }
    out.push({ 谁: name, 序号: no })
  }
  return { list: out, dropped }
}

/** 只要动作的旧入口（其余调用方不用改）。 */
export function parseWritePayload(payload) {
  return parseWritePayloadBundle(payload).actions
}
