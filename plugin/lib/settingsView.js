// 设置界面：字段元数据 + 改值校验（§8.6）
//
// 界面只负责画；「有哪些设置项、什么范围、什么选项、怎么夹紧」全在这里。
// 好处：加一个设置项只改这一个文件，界面自动多出一行。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { DEFAULT_SETTINGS } from './settings.js'

/**
 * 字段元数据。`path` 是 `组.键`，跟 DEFAULT_SETTINGS 的结构一一对应。
 *
 * 写法说明：
 *   type: 'switch' | 'number' | 'select'
 *   hint: 大白话，给玩家看的（不是技术注释）
 */
/**
 * 每个组存哪儿（跟 settings.js 的 SCOPE 一致，ADR 0072）。
 *   global 全局级   —— 所有局所有卡共用
 *   card    人物卡级 —— 同一张卡的多个存档共用
 *   game    会话级   —— 一个存档一份
 */
export const GROUP_SCOPE = Object.freeze({
  writeback: 'global',
  recall: 'global',
  storage: 'global',
  visibility: 'global',
  salience: 'global',
  names: 'global',
  cognition: 'global',
  draft: 'global',
  firstExit: 'global',
})

/** 界面上的三段：标题 + 说明。 */
export const SCOPE_SECTIONS = Object.freeze([
  Object.freeze({
    scope: 'global',
    title: '全局级',
    hint: '所有对局、所有人物卡都共用这一份。改一次就一直生效。',
  }),
  Object.freeze({
    scope: 'card',
    title: '人物卡级',
    hint: '同一张人物卡的多个存档共用一份；换一张卡就是另一套。',
  }),
  Object.freeze({
    scope: 'game',
    title: '会话级',
    hint: '只对当前这一局生效；换个存档要重设。',
  }),
])

export const SETTING_SCHEMA = Object.freeze([

  {
    title: '档案写入方式',
    scope: 'global',
    hint: '每轮结算后，怎么把正文里的人物信息写进档案。',
    items: [
      {
        path: 'writeback.mode',
        label: '调用模型方式',
        type: 'select',
        options: [
          { value: 'background', label: '跟随后台（默认，及时）' },
          { value: 'subagent', label: '子代理（后台异步跑）' },
          { value: 'off', label: '关闭（不自动写档案）' },
        ],
        hint: '两档都不挡你输入，都在后台算；跟随后台走常驻成员「档案员」，更及时，后台任务多时要排队。',
      },
    ],
  },
  {
    title: '离场',
    scope: 'global',
    hint: '人物离场时怎么处理。',
    items: [
      {
        path: 'firstExit.mode',
        label: '写入方式',
        type: 'select',
        // 先隐藏（2026-11-06）：firstExit.mode 只出现在设置渲染里，**没有任何业务逻辑读过**，
        // 选自动还是手动程序行为完全一样。定义留着，真要实现手动模式时去掉 hidden 即可。
        hidden: true,
        options: [
          { value: 'auto', label: '自动写入' },
          { value: 'manual', label: '手动写入' },
        ],
        hint: '自动写入省事；手动写入由你在面板上确认。',
      },
      {
        path: 'firstExit.fuzzyTurns',
        label: '模糊离场判定轮数',
        type: 'number',
        min: 1,
        max: 5,
        hint: '连续几轮没动静才算离场。调大更保守。',
      },
      {
        path: 'firstExit.nominationTurns',
        label: '手动提名的停留轮数',
        type: 'number',
        hidden: true,   // 同上：没有任何逻辑读它，配套「手动写入」一起隐藏
        min: 1,
        max: 5,
        hint: '手动模式下，这个人挂在待确认里多少轮。',
      },
    ],
  },
  {
    title: '召回',
    scope: 'global',
    hint: '正文生成前，把离场人物的档案塞多少进去。',
    items: [
      {
        path: 'recall.budgetChars',
        label: '每轮字数上限',
        type: 'number',
        min: DEFAULT_SETTINGS.recall.budgetMin,
        max: DEFAULT_SETTINGS.recall.budgetMax,
        hint: '不是每轮固定塞这么多；没命中就不塞。',
      },
      {
        path: 'recall.queryLevel',
        label: '手动召回默认档位',
        type: 'select',
        options: [
          { value: 'full', label: '全量（所有指针）' },
          { value: 'detailed', label: '详细（带态度/来源/时间）' },
          { value: 'brief', label: '简单（只给内容）' },
        ],
        hint: '面板点「召回」时一律用这个档位（面板上没有档位可选）；正文模型自己查档案时没指定档位也用它。',
      },
      {
        path: 'recall.modelQueryTool',
        label: '让正文模型能主动查档案',
        type: 'switch',
        hint: '正文模型写正文时，可以自己查某个人的档案（工具 archive_query）。',
      },
      {
        path: 'recall.cooldownOn',
        label: '召回冷却',
        type: 'switch',
        hint: '刚召回过的人，隔几轮再出现，别一直念叨同一个人。',
      },
      {
        path: 'recall.cooldownTurns',
        label: '冷却轮数',
        type: 'number',
        min: 0,
        max: 20,
        hint: '0 等于关掉冷却。',
      },
      {
        path: 'recall.dormantTurns',
        label: '沉降轮数',
        type: 'number',
        min: 5,
        max: 999,
        hint: '长期没动静的人沉到底部。999 等于不沉降。',
      },
    ],
  },
  {
    title: '存储',
    scope: 'global',
    hint: '快照保留多少轮。存得越多，能回退得越远，占磁盘也越多。',
    items: [
      {
        path: 'storage.keepTurns',
        label: '保留多少轮快照',
        type: 'number',
        min: 100,
        max: 1000,
        hint: '超出的旧快照挪进 trash（不硬删，可以自己清）。100～1000 轮，默认 200；50 人的局 200 轮约十几 MB。',
      },
      {
        path: 'storage.trashMaxAgeDays',
        label: 'trash 保留多少天',
        type: 'number',
        min: 7,
        max: 90,
        hint: '废文件在 trash 里放这么多天后，结算时自动清掉（按文件名里的时间戳算）。默认 15 天；「立即清理」按钮在下面数据位置那块。',
      },
    ],
  },
  {
    title: '改名',
    scope: 'global',
    hint: '改人物姓名时，旧名字要不要自动存进别名。',
    items: [
      {
        path: 'names.keepOldName',
        label: '旧名自动存别名',
        type: 'switch',
        hint: '只影响你手动改名（人物行姓名框、✏）。模型在正文里看到换称呼时改名，一律保留旧名，不看这个开关。',
      },
    ],
  },
  {
    title: '认知',
    scope: 'global',
    hint: '档案里「他信不信这件事」怎么算。改的是模型的判断口径，不改已经记下的档案。',
    items: [
      {
        path: 'cognition.defaultAttitude',
        label: '拿不准时给什么态度',
        type: 'select',
        options: [
          { value: '未定', label: '未定（默认，拿不准就不猜）' },
          { value: '真', label: '真（倾向相信）' },
          { value: '假', label: '假（倾向不信）' },
        ],
        hint: '模型判断不了某事真假时，按这个来。',
      },
      {
        path: 'cognition.eyewitnessTrue',
        label: '亲眼见到就当作「真」',
        type: 'switch',
        hint: '默认关闭：谁亲眼见到都不自动算真，按正文里他自己的表现判断信不信（看不出才用上一条）。打开＝主角亲眼见到的可以直接给「真」。',
      },
      {
        path: 'cognition.conflictDisplay',
        label: '一件事有几种说法时显示几种',
        type: 'select',
        options: [
          { value: 'all', label: '都显示（默认）' },
          { value: 'self', label: '只显示他自己那组' },
          { value: 'latest', label: '只显示最新一条' },
        ],
        hint: '一件事有几种说法时，注入正文显示几种。只影响给模型看的正文，不改档案里记下的。',
      },
      {
        path: 'cognition.maxOtherSources',
        label: '每条最多几个「听说」来源',
        type: 'number',
        min: 1,
        max: 8,
        hint: '超了丢最早的。数字越小，听到的来源越少、越省字数。',
      },
    ],
  },
  {
    title: '模糊建档',
    scope: 'global',
    hint: '模型拿不准的人先记个名字，等够格了再正式建档。',
    items: [
      {
        path: 'draft.maxIdleTurns',
        label: '多久没露面就清掉',
        type: 'number',
        min: 1,
        max: 10,
        hint: '连续这么多轮正文里都没提到他，就从候选表里移除。清掉只是不再当候选，不影响已建档的人。',
      },
    ],
  },
  {
    title: '可见性',
    scope: 'global',
    hint: '别人（其他插件、模型）能看到多少。',
    items: [
      {
        path: 'visibility.toolFollows',
        label: '查询工具跟随可见性',
        type: 'switch',
        // 先隐藏（2026-11-06）：这一项也没有任何业务代码读取——`archive_query` 并不检查"闭眼"。
        // 三项全隐藏后整组会被空组过滤掉，玩家不再看到一个点不动的开关。
        // 将来要真做"闭眼的人模型也查不到"，把 hidden 去掉并在工具里加判断即可。
        hidden: true,
        hint: '闭上眼的人，模型也查不到。',
      },
      {
        path: 'visibility.crossPluginRead',
        label: '跨插件读跟随可见性',
        type: 'switch',
        // 先隐藏（2026-11-06）：这两个开关只出现在设置定义与渲染里，
        // **没有任何业务逻辑读过**，点了也不生效。定义留着，以后要恢复把 hidden 去掉即可。
        hidden: true,
        hint: '别的插件能不能读到闭眼的人。',
      },
      {
        path: 'visibility.crossPluginWrite',
        label: '跨插件写跟随写入',
        type: 'switch',
        hidden: true,
        hint: '别的插件能不能改锁住的人。',
      },
    ],
  },
])

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readPath(object, path) {
  return path.split('.').reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), object)
}

/** 按路径找一项元数据。 */
export function findSetting(path) {
  for (const group of SETTING_SCHEMA) {
    const item = group.items.find((entry) => entry.path === path)
    if (item) return item
  }
  return null
}

/** 默认值：从 DEFAULT_SETTINGS 里那一条取。 */
function defaultValueOf(path, defaults) {
  return readPath(defaults, path)
}

/**
 * 把设置翻成界面能直接画的分组，附上当前值与默认值。
 * @param {object} settings 已 resolve 的设置
 * @param {object} [defaults] 默认值来源
 */
export function describeSettings(settings, defaults = undefined, { codes = [] } = {}) {
  const base = defaults ?? settings
  const flat = SETTING_SCHEMA.map((group) => ({
    title: group.title,
    hint: group.hint,
    scope: group.scope ?? 'game',
    // hidden 的项不下发（定义仍在 SETTING_SCHEMA 里，findSetting 照样找得到）
    items: group.items.filter((item) => item.hidden !== true).map((item) => {
      const value = readPath(settings, item.path)
      const def = defaultValueOf(item.path, base)
      // 「多选」型（勾选哪些栏目）：**空数组 ≠ 没存过**
      //   undefined（没存过）→ 默认全勾
      //   []（玩家主动全取消）→ 就该一个不勾
      if (item.type === 'codes') {
        // 条目码由调用方传进来（宿主知道有哪些栏目）；为空说明是纯逻辑调用
        const all = (Array.isArray(codes) ? codes : []).map((entry) => String(entry?.code ?? entry))
        const hasValue = Array.isArray(value)
        const hasDefault = Array.isArray(def)
        return {
          ...item,
          value: hasValue ? value : all,
          default: hasDefault ? def : all,
        }
      }
      return { ...item, value, default: def }
    }),
  }))
  // 按作用域分三段：全局级 / 人物卡级 / 会话级
  // 过滤两处空壳：项全被隐藏的组、以及没组的段——免得面板上出现一个空标题。
  return SCOPE_SECTIONS.map((section) => ({
    scope: section.scope,
    title: section.title,
    hint: section.hint,
    groups: flat.filter((group) => group.scope === section.scope && group.items.length > 0),
  })).filter((section) => section.groups.length > 0)
}

/**
 * 数值输入的格式白名单：可选负号 + 纯数字（允许小数）。
 *
 * 为什么不直接 `Number(raw)`：`Number('0x10')` 是 16、`Number('')` 是 0、
 * `Number('1e999')` 是 Infinity——玩家眼里这些都不是数字，不该被"猜"成某个值。
 *
 * ⚠️ 浏览器侧的 `plugin/client.js` 有一份同规则的副本（那边不能 import lib），
 * 改这里就要同步改那边，守卫测试会比对两边的正则字面量。
 */
const NUMBER_INPUT_RE = /^-?\d+(?:\.\d+)?$/u

/**
 * 把输入框里的原始字符串变成合法的设置值。
 *
 * 界面和 `coerce` 共用这一把尺子：界面上先过滤字符、失焦再夹紧，后端再用同一个
 * 函数兜一遍。两边规则一旦分叉，玩家就会遇到"我明明填了 5，它却记成别的"。
 *
 * @param {any} raw 输入框里的原始字符串（数字也接受）
 * @param {{min?:number, max?:number}} [range]
 * @returns {{ok:true, value:number} | {ok:false, reason:string}}
 */
export function parseNumberInput(raw, { min, max } = {}) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, reason: '不能为空' }
  if (!NUMBER_INPUT_RE.test(text)) return { ok: false, reason: '只能填数字' }
  const num = Number(text)
  if (!Number.isFinite(num)) return { ok: false, reason: '数字超出范围' }
  const rounded = Math.round(num)
  const low = Number.isFinite(min) ? min : -Infinity
  const high = Number.isFinite(max) ? max : Infinity
  return { ok: true, value: Math.min(high, Math.max(low, rounded)) }
}

/** 按元数据把一个值夹成合法值；不合法就返回 undefined（表示"别改"）。 */
function coerce(item, raw) {
  if (item.type === 'switch') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true') return true
    if (raw === 'false') return false
    return undefined
  }
  if (item.type === 'number') {
    // 跟界面共用一把尺子：空串、0x10、1e999 这些一律判不合法 → 不改
    const parsed = parseNumberInput(raw, { min: item.min, max: item.max })
    return parsed.ok ? parsed.value : undefined
  }
  if (item.type === 'select') {
    const allowed = (item.options ?? []).map((option) => option.value)
    return allowed.includes(raw) ? raw : undefined
  }
  if (item.type === 'text') {
    return typeof raw === 'string' ? raw.trim() : undefined
  }
  if (item.type === 'codes') {
    if (Array.isArray(raw)) return raw.map((item) => String(item ?? '').trim()).filter(Boolean)
    if (typeof raw === 'string') return raw.split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean)
    return undefined
  }
  if (item.type === 'list') {
    const pieces = Array.isArray(raw)
      ? raw
      : typeof raw === 'string'
        ? raw.split(/[,，、\s]+/)
        : null
    if (!pieces) return undefined
    const list = []
    for (const piece of pieces) {
      const text = String(piece ?? '').trim()
      if (text && !list.includes(text)) list.push(text)   // 顺手去重，玩家手滑写两遍不算错
    }
    return list
  }
  return undefined
}

/**
 * 应用一批改动。**纯函数**：返回新设置，不动入参。
 *
 * 不认识的路径、非法值一律忽略——宁可"这次没生效"，也不往设置里塞脏数据。
 * @param {object} settings
 * @param {Record<string, any>} patch `{ '组.键': 新值 }`
 */
export function applySettingPatch(settings, patch = {}) {
  const next = structuredClone(isPlainObject(settings) ? settings : {})
  if (!isPlainObject(patch)) return next

  for (const [path, raw] of Object.entries(patch)) {
    const item = findSetting(path)
    if (!item) continue
    const value = coerce(item, raw)
    if (value === undefined) continue
    const keys = path.split('.')
    let node = next
    for (const key of keys.slice(0, -1)) {
      if (!isPlainObject(node[key])) node[key] = {}
      node = node[key]
    }
    node[keys[keys.length - 1]] = value
  }
  return next
}
