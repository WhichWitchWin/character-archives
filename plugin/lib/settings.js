// 人物冷存档 · 设置项默认值（唯一事实来源）
//
// 全部取自设计稿 §8.6「设置页」表格。改默认值只改这里，别在别处再抄一份。
//
// **存哪**：按 `SCOPE` 分三处（ADR 0072）：
//   · global 全局级  —— 所有局、所有卡共用，存插件数据
//   · card    人物卡级 —— 同一张卡的多个存档共用，按卡分区
//   · game    会话级  —— 一个存档一份，跟这局走

/**
 * 设置项的默认值。
 */
export const DEFAULT_SETTINGS = Object.freeze({

  // 首次离场（设计稿 §「首次离场」）
  firstExit: Object.freeze({
    mode: 'auto',              // 'auto' 自动写入 | 'manual' 手动写入
    nominationTurns: 3,        // 手动写入的提名停留轮数（1～5）
    fuzzyTurns: 3,             // 模糊离场判定轮数（1～5）
  }),

  // 档案写入方式（ADR 0007）：subagent 子代理写入 / background 跟随后台（默认，阻塞，保证及时）/ off 关闭
  writeback: Object.freeze({
    mode: 'background',
  }),

  // 召回（§7.3～§7.5、§7.10）
  recall: Object.freeze({
    budgetChars: 3000,         // 每轮召回注入的**上限**（字符数），不是每轮固定注入这么多
    budgetMin: 1000,           // 玩家可填的最小值：全量灌一个角色就是 1000（ADR 0089），再低连一个人都装不下
    budgetMax: 6000,           // 玩家可填的最大值
    modelQueryTool: true,      // 正文模型主动查档案的工具（ADR 0089 §9，已实现）
    queryLevel: 'detailed',    // 查档案默认档位：full 全量 | detailed 详细 | brief 简单
    cooldownOn: true,          // 召回冷却开关
    cooldownTurns: 10,         // 冷却轮数（0～20）
    dormantTurns: 20,          // 沉降轮数（5～999，999＝不沉降）：长期没动静的人沉底（§7.11、ADR 0031）
  }),

  // 存储（2026-11-05）：快照保留多少轮。窗口外的旧快照挪进 trash，不硬删。
  storage: Object.freeze({
    keepTurns: 200,            // 100～1000。50 人的局、200 轮约十几 MB；1000 轮约 40MB
    trashMaxAgeDays: 15,       // trash 里的废文件保留多少天（7～90），到期在结算时自动清
  }),

  // 模糊建档（ADR 0075）：候选表不能只进不出，太久没露面就清掉
  draft: Object.freeze({
    maxIdleTurns: 3,           // 连续多少轮没露面就清出候选表（1～10）
  }),

  // 可见性（§8.6、§8.7）
  visibility: Object.freeze({
    toolFollows: true,         // 查询工具是否跟随可见性
    crossPluginRead: false,    // 跨插件读是否跟随可见性
    crossPluginWrite: false,   // 跨插件写是否跟随写入
  }),

  // 关键度（§六）
  salience: Object.freeze({
    lock: false,
    proportional: false,
  }),

  // 改名：玩家手改姓名时，旧名要不要自动进别名（模型改名一律保留，不看这个）
  names: Object.freeze({
    keepOldName: true,
  }),

  // 认知口径（P20）：模型判断「态度」时的默认口径。
  // 这三项以前写死在系统提示词和 pointers.js 里，玩家改不了；
  // 现在挪到设置里，提示词只指路（「见每轮工单开头」），实际口径每轮随工单发。
  cognition: Object.freeze({
    defaultAttitude: '未定',   // '未定' | '真' | '假'：模型拿不准时给什么态度
    eyewitnessTrue: false,     // 亲见自动算真？默认关（2026-11-06）：靠正文里他自己的表现判断信不信
    conflictDisplay: 'all',    // 'all' 全显示 | 'self' 只显示他本人的那一组 | 'latest' 只显示最后一组
    maxOtherSources: 3,        // 1～8：一条指针最多挂几个「别人说的」来源组
  }),
})

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 每个设置组存哪儿（ADR 0072）。
 *
 * · global 全局级：所有局所有卡共用（存插件数据）
 * · card    人物卡级：同一张卡的多个存档共用（按卡分区）
 * · game    会话级：一个存档一份（跟这局走）
 */
export const SCOPE = Object.freeze({
  writeback: 'global',
  recall: 'global',
  storage: 'global',
  draft: 'global',
  visibility: 'global',
  salience: 'global',
  names: 'global',
  cognition: 'global',
  firstExit: 'global',
})

/** 把一份完整设置拆成三份。 */
export function splitSettings(settings) {
  const source = isPlainObject(settings) ? settings : {}
  const out = { global: {}, card: {}, game: {} }
  for (const [group, value] of Object.entries(source)) {
    const scope = SCOPE[group] ?? 'game'
    out[scope][group] = value
  }
  return out
}

/**
 * 把三份合成一份完整设置（后写的覆盖先写的）。
 * @param {{global?:object, card?:object, game?:object}} parts
 * @returns {object}
 */
export function mergeSettings(parts = {}) {
  const out = {}
  for (const scope of ['global', 'card', 'game']) {
    const group = parts[scope]
    if (!isPlainObject(group)) continue
    for (const [key, value] of Object.entries(group)) out[key] = value
  }
  return out
}

/**
 * 把保存过的设置叠到默认值上：只覆盖给出过的字段，其余回落默认。
 * 永远返回新对象，改它不会污染 DEFAULT_SETTINGS。
 */
export function resolveSettings(saved) {
  const base = structuredClone(DEFAULT_SETTINGS)
  merge(base, saved)
  return base
}

function merge(base, patch) {
  if (!isPlainObject(patch)) return base
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(base[key])) merge(base[key], value)
    else base[key] = value
  }
  return base
}

// ---------- 设置页文案：档案写入方式（ADR 0007） ----------
// 文案集中放在这里，界面直接取，避免同一句话在多个文件里各写一遍。

export const WRITEBACK_TITLE = '档案写入方式'

/** 设置项总说明：这个选项影响什么。 */
export const WRITEBACK_SUMMARY =
  '每一轮正文写完后，插件要不要自动判断并更新人物册。' +
  '只影响人物册的记录，不影响酒馆自己的变量结算。'

export const WRITEBACK_MODES = Object.freeze([
  Object.freeze({
    id: 'subagent',
    label: '子代理',
    detail: '每轮派一个临时子代理去判断和整理，在后台异步跑，不挡你的输入。',
    pros: Object.freeze(['你完全不会被卡住']),
    cons: Object.freeze(['记录可能晚一轮才出现：这一轮刚发生的事，下一轮注入时可能还没写进去']),
  }),
  Object.freeze({
    id: 'background',
    label: '跟随后台',
    detail: '跟着酒馆的后台成员（档案员）一起跑，排队算账，不影响你的输入。',
    pros: Object.freeze(['最及时：这一轮发生的事，下一轮就能用上', '跟书记/润色师同列，后台任务页看得见']),
    cons: Object.freeze(['后台任务多时要排队，档案可能稍晚才更新']),
  }),
  Object.freeze({
    id: 'off',
    label: '关闭',
    detail: '不自动判断、不自动写档案。',
    pros: Object.freeze(['不花后台模型的额度', '完全不会打扰你']),
    cons: Object.freeze(['人物册只能靠你自己在面板里手动维护']),
  }),
])

/** 取某一档的文案；档位不认识时回落到默认档（跟随后台）。 */
export function writebackMode(mode) {
  return WRITEBACK_MODES.find((item) => item.id === mode) ?? WRITEBACK_MODES.find((item) => item.id === DEFAULT_SETTINGS.writeback.mode) ?? WRITEBACK_MODES[0]
}
