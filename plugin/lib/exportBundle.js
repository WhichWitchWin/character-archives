// 导出包：预设单独可导，**档案必须带预设一起导**（ADR 0050）
//
// 为什么档案不能单飞：命题里的栏目是按**单字母码**存的，没有栏目定义，那些码谁也解释不了——
// "a" 是身份职业还是未了事项？导出去就是一堆乱码。
//
// 同理，**字典也要带上**：命题内容的原文可能是字典下标（数字），没有字典同样解不出来。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { STATUS } from './snapshot.js'
import { splitAliases } from './names.js'
import { checkText } from './inputLimit.js'

/** 包标识：认这个才认是"我们的"导出。 */
export const FORMAT = 'character-archives'

/** 包的版本号：结构不兼容时加一。 */
export const BUNDLE_VERSION = 1

function baseBundle(kind) {
  return {
    format: FORMAT,
    version: BUNDLE_VERSION,
    kind,
    exportedAt: new Date().toISOString(),
  }
}

/**
 * 只导预设：条目定义 ＋ 顺序。
 * @param {{name?:string, definitions?:object, order?:string[]}} input
 */
function buildPresetExport({ name = '未命名预设', definitions = {}, order = undefined } = {}) {
  const codes = Object.keys(definitions ?? {})
  return {
    ...baseBundle('preset'),
    preset: {
      name: String(name ?? '未命名预设'),
      entries: structuredCloneSafe(definitions),
      order: Array.isArray(order) && order.length ? [...order] : codes,
    },
  }
}

/**
 * 导档案：**自动把条目定义和字典一起带上**。
 * 没有条目定义就直接报错——不产出"解释不了"的包。
 * @param {{name?:string, definitions?:object, order?:string[], snapshot?:object,
 *          dict?:object, note?:string}} input
 */
export function buildArchiveExport({
  name = '档案导出',
  definitions = {},
  order = undefined,
  snapshot = undefined,
  dict = undefined,
  nextId = undefined,
  note = '',
} = {}) {
  const codes = Object.keys(definitions ?? {})
  if (!codes.length) {
    throw new Error('导出人物档案必须同时带条目定义：没有定义，值里的条目码无法解释')
  }
  if (!snapshot || !Array.isArray(snapshot.p)) {
    throw new Error('没有可导出的人物册（快照为空）')
  }

  const preset = buildPresetExport({ name, definitions, order }).preset
  return {
    ...baseBundle('archive'),
    preset,
    archive: {
      turn: Number.isInteger(snapshot.t) ? snapshot.t : 0,
      gt: typeof snapshot.gt === 'string' ? snapshot.gt : '',
      persons: structuredCloneSafe(snapshot.p),
      // 字典必带：值的原文可能是字典下标
      dict: structuredCloneSafe(dict ?? { v: 1, d: [], t: [] }),
      // 计数器必带：不带的话导入后新建人物会从 1 开始，撞上已有的号
      nextId: Number.isInteger(nextId) && nextId > 0 ? nextId : fallbackNextId(snapshot.p),
      // 快照结构版本：导入侧要判断能不能读
      snapshotVersion: Number.isInteger(snapshot.v) ? snapshot.v : 1,
      stats: {
        persons: Array.isArray(snapshot.p) ? snapshot.p.length : 0,
        claims: Array.isArray(snapshot.c) ? snapshot.c.length : 0,
        pointers: Array.isArray(snapshot.pt) ? snapshot.pt.length : 0,
      },
      note: String(note ?? ''),
    },
  }
}

/** 人物固定 4 格：编号、状态、姓名、别名串。 */
const PERSON_SLOTS = 4

/**
 * 导入体检：人物册里每个人的姓名与别名。
 *
 * 规矩（2026-11-04 定）：姓名必须非空；**姓名和别名共用一个池子、全局唯一**，
 * 自己姓名和自己的别名相同也算撞。别名内容可以为空串，但**那一格必须在**——
 * 人物是固定 4 格数组，缺了别名格说明这包不是我们导出的，不猜。
 *
 * 为什么宁可整包拒：姓名是召回与写入的唯一门牌号。撞名的人按「重名绝不猜」
 * 会被静默跳过（ADR 0048/0049），那是最难查的一类问题——导进来时就拦住最省事。
 *
 * @param {any[]} persons
 * @param {{mainNames?:string[]}} [options] mainNames：主角的名字，撞了也不许导进来
 * @returns {{ok:true, reason:null} | {ok:false, reason:string}}
 */
export function validateArchivePersons(persons, { mainNames = [] } = {}) {
  const fail = (reason) => ({ ok: false, reason })
  if (!Array.isArray(persons)) return fail('人物册不是数组')

  const mains = new Set(
    (Array.isArray(mainNames) ? mainNames : []).map((item) => String(item ?? '').trim()).filter(Boolean),
  )
  const taken = new Map()
  const seenIds = new Set()
  for (let index = 0; index < persons.length; index += 1) {
    const person = persons[index]
    const where = `第 ${index + 1} 个人`
    if (!Array.isArray(person) || person.length < PERSON_SLOTS) {
      return fail(`${where}结构不完整：要有 4 格（编号、状态、姓名、别名），缺了哪一格都不行`)
    }

    const [id, status, rawName, rawAliases] = person
    if (typeof id !== 'string' || !id.trim()) return fail(`${where}的编号是空的`)
    // 编号重复会让所有按编号的操作（改状态、删值、面板行）全打到第一个人身上
    if (seenIds.has(id)) return fail(`${where}的编号「${id}」和前面的人重复了`)
    seenIds.add(id)
    if (status !== STATUS.OFFLINE && status !== STATUS.PRESENT) {
      return fail(`${where}（${id}）的状态既不是在场也不是离场`)
    }
    if (typeof rawName !== 'string') return fail(`${where}（${id}）的姓名不是文字`)
    const name = rawName.trim()
    if (!name) return fail(`${where}（${id}）的姓名是空的——没有姓名的人召回不到、也写不进去`)
    if (typeof rawAliases !== 'string') {
      return fail(`${where}（${id}）的别名不是文字（没有别名请写空字符串）`)
    }

    const aliases = splitAliases(rawAliases)
    // 名字的字符限制：括号会跟编号尾巴打架、逗号是别名分隔符，一律不许进名字
    const nameCheck = checkText(name, '姓名', { max: 24, kind: 'name' })
    if (!nameCheck.ok) return fail(`${where}（${id}）：${nameCheck.reason}`)
    for (const alias of aliases) {
      const aliasCheck = checkText(alias, '别名', { max: 24, kind: 'name' })
      if (!aliasCheck.ok) return fail(`${where}（${id}）：${aliasCheck.reason}`)
    }
    for (const one of [name, ...aliases]) {
      if (mains.has(one)) return fail(`名字「${one}」是主角的名字，不能用`)
      const owner = taken.get(one)
      if (owner) return fail(`名字「${one}」重复了：${owner}和${where}（${id}）都用了它`)
      taken.set(one, where)
    }
  }

  return { ok: true, reason: null }
}

/** 没有计数器时按现有编号兜底：取最大号 +1，绝不给 0（ADR 0004：号码永不复用）。 */
function fallbackNextId(persons) {
  let max = 0
  for (const person of Array.isArray(persons) ? persons : []) {
    const matched = String(person?.[0] ?? '').match(/^p(\d+)$/u)
    if (matched) max = Math.max(max, Number(matched[1]))
  }
  return max + 1
}

/**
 * 把导入包翻成「直接可以写进整局数据的东西」。
 *
 * 档案包默认**不覆盖**已有的档案——玩家得显式 force 才让覆盖。
 * @param {object} bundle
 * @param {{hasExisting?:boolean, force?:boolean}} options
 * @returns {{ok:true, plan:object, reason:null} | {ok:false, plan:null, reason:string}}
 */
export function importBundle(bundle, { hasExisting = false, force = false, mainNames = [] } = {}) {
  const checked = validateBundle(bundle, { mainNames })
  if (!checked.ok) return { ok: false, plan: null, reason: checked.reason }

  const preset = bundle.preset ?? {}
  const entries = structuredCloneSafe(preset.entries ?? {})
  const order = Array.isArray(preset.order) && preset.order.length ? [...preset.order] : Object.keys(entries)


  if (hasExisting && !force) {
    return {
      ok: false,
      plan: null,
      reason: '当前这一局已经有档案了，导入会把它整个替换掉；确认后再导入',
    }
  }

  const archive = bundle.archive ?? {}
  const persons = structuredCloneSafe(archive.persons ?? [])
  return {
    ok: true,
    plan: {
      entries,
      order,
      presetName: preset.name ?? '',
      persons,
      dict: structuredCloneSafe(archive.dict ?? { v: 1, d: [], t: [] }),
      nextId: Number.isInteger(archive.nextId) && archive.nextId > 0
        ? archive.nextId
        : fallbackNextId(persons),
      turn: Number.isInteger(archive.turn) ? archive.turn : 0,
      gt: typeof archive.gt === 'string' ? archive.gt : '',
      note: typeof archive.note === 'string' ? archive.note : '',
    },
    reason: null,
  }
}

/**
 * 校验一个导入包能不能用。
 * @returns {{ok: true, bundle: object, reason: null} | {ok: false, bundle: null, reason: string}}
 */
export function validateBundle(bundle, { mainNames = [] } = {}) {
  const fail = (reason) => ({ ok: false, bundle: null, reason })

  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return fail('不是一个对象（包是空的或格式不对）')
  if (bundle.format !== FORMAT) return fail(`格式不认识：${bundle.format ?? '(空)'}`)
  if (!Number.isInteger(bundle.version) || bundle.version < 1) return fail('版本号不合法')
  if (bundle.version > BUNDLE_VERSION) return fail(`版本太新（${bundle.version}），请升级插件后再导入`)

  // 只认档案包：单独的预设包已砍掉，预设跟着档案走（ADR 0052）
  if (bundle.kind !== 'archive') return fail(`只认档案包，包的类型是：${bundle.kind ?? '(空)'}`)
  if (!bundle.preset || typeof bundle.preset !== 'object' || !bundle.preset.entries) {
    return fail('包里没有条目预设——没有它，值里的条目码无法解释')
  }
  // 走到这里一定是档案包了，人物册和字典必须有
  if (!bundle.archive || !Array.isArray(bundle.archive.persons)) return fail('包里没有人物册')
  if (!bundle.archive.dict || !Array.isArray(bundle.archive.dict.d)) {
    return fail('包里没有字典——值的原文可能解不出来')
  }

  // 逐个体检：姓名非空、4 格齐、编号不重复、姓名与别名不撞（含主角名）
  const personsCheck = validateArchivePersons(bundle.archive.persons, { mainNames })
  if (!personsCheck.ok) return fail(`人物册没过体检：${personsCheck.reason}`)

  return { ok: true, bundle, reason: null }
}

/** 深拷贝一份，免得导出后外面改了对象把包带歪。 */
function structuredCloneSafe(value) {
  if (value === undefined || value === null) return value
  try {
    return structuredClone(value)
  } catch {
    return JSON.parse(JSON.stringify(value))
  }
}
