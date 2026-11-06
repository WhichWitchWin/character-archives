// MVU 解析：把状态机的 stat_data 拆成「时间 / 在场名单 / 人物字段」（ADR 0005、§8.8）
//
// 实测到的卡结构（只列形状）：
//
//   时间: { 日期, 时刻, 时段 }
//   地点: { 城市, 区域, 场所 }
//   人物: [ { 名字, 身份, 关系, 好感, 怀疑, 疑点, 依据, 冷却:{…} } ]
//   在场: [ "名字" ]
//
// 三条铁律：
//   1. **时间只记录不解析**（ADR 0005）——原样拼成字符串，不算天数、不比大小；
//   2. **拿不到就省略**，绝不编造；
//   3. 解析器只管"把数据摆出来"，**映射到哪个条目是调用方的事**。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/** 时间字段的优先顺序：日期一定有，时刻/时段能补就补。 */
const TIME_KEYS = ['日期', '时刻', '时段']

/** 人名可能出现在这些字段里。 */
const NAME_KEYS = ['名字', '姓名', 'name']

/**
 * 从 MVU 变量里取出 stat_data。酒馆给的可能有两层，都兼容。
 * @param {any} variables onTurnSettled 的 `variables`
 * @returns {object|null}
 */
export function readStatData(variables) {
  if (!variables || typeof variables !== 'object') return null
  const direct = variables.stat_data
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct
  // 有些卡把 stat_data 直接摊在 variables 上
  const keys = Object.keys(variables)
  if (keys.some((key) => TIME_KEYS.some((timeKey) => variables[key]?.[timeKey]) || key === '人物' || key === '在场')) {
    return variables
  }
  return null
}

/**
 * 按点路径取值：`时间.日期` → statData.时间.日期。
 * 字符串与数字都转成文字（有些卡的时间直接是数字），取不到给空串。
 * @returns {string}
 */
export function pickPath(statData, path) {
  const parts = String(path ?? '').split('.').filter(Boolean)
  if (!parts.length) return ''
  let node = statData
  for (const part of parts) {
    if (!node || typeof node !== 'object') return ''
    node = node[part]
  }
  if (typeof node === 'string') return node.trim()
  if (typeof node === 'number' && Number.isFinite(node)) return String(node)
  return ''
}

/**
 * 摊出所有**叶子路径**，给面板的「时间来源／地点来源」下拉用（2026-11-05）。
 *
 * 跳过「人物」：它是数组，不是时间地点，列出来只会把下拉撑爆。
 * 只往下走三层，够覆盖常见卡（`世界.时间.日期` 这种）。
 *
 * @returns {Array<{path:string, sample:string}>}
 */
export function listLeafPaths(statData, { maxDepth = 3 } = {}) {
  const out = []
  const walk = (node, prefix, depth) => {
    if (!node || typeof node !== 'object' || depth > maxDepth) return
    for (const [key, value] of Object.entries(node)) {
      if (!prefix && key === '人物') continue
      const path = prefix ? `${prefix}.${key}` : key
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, path, depth + 1)
      } else if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim()
        if (text) out.push({ path, sample: text })
      }
    }
  }
  walk(statData, '', 1)
  return out
}

/**
 * 拼游戏内时间：`永安三年·冬` 这种是卡自己给的原文，**原样用，不解析**。
 * 优先用「日期」，有「时刻／时段」就补在后面；一个都没有返回空串。
 *
 * `timePath` 是玩家在面板上指定的**兜底字段**：自己按通用形状抓不到才用它。
 * // 抓得到就绝不覆盖——否则随手选一个字段反而会把好数据顶掉（2026-11-05）。
 * @returns {string}
 */
export function extractGt(statData, timePath = '') {
  const time = statData?.时间
  if (time && typeof time === 'object') {
    const parts = TIME_KEYS
      .map((key) => (typeof time[key] === 'string' ? time[key].trim() : ''))
      .filter(Boolean)
    if (parts.length) {
      // 日期已经带了时刻就别重复（有些卡「日期」里就有「三年五月十二日 申时」）
      if (parts.length > 1 && parts[0].includes(parts[1])) return parts[0]
      return parts.join(' ')
    }
  }
  return pickPath(statData, timePath)
}

/** 从对象里挑出人名字段。 */
function pickName(item) {
  if (typeof item === 'string') return item.trim()
  if (!item || typeof item !== 'object') return ''
  for (const key of NAME_KEYS) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key].trim()
  }
  return ''
}

/**
 * 现场名单：`在场` 是字符串数组（也可能是对象数组，都兼容）。
 * @returns {string[]}
 */
export function extractPresent(statData) {
  const list = statData?.在场
  if (!Array.isArray(list)) return []
  return list.map(pickName).filter(Boolean)
}

/**
 * 人物列表：`人物` 数组里每个元素 = 一个人。
 * 字段原样带出（值是字符串/数字都留着），交给调用方决定映射到哪个条目。
 * @returns {Array<{name: string, fields: Record<string, string|number>}>}
 */
export function extractPeople(statData) {
  const list = statData?.人物
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    const name = pickName(item)
    if (!name) continue
    const fields = {}
    for (const [key, value] of Object.entries(item)) {
      if (NAME_KEYS.includes(key)) continue
      if (value === null || value === undefined) continue
      // 嵌套对象（比如 冷却:{关系,好感}）不在这一版抄，跳过
      if (typeof value === 'object') continue
      const text = String(value).trim()
      if (!text) continue
      fields[key] = text
    }
    out.push({ name, fields })
  }
  return out
}

/**
 * 一次把三样都取出来。
 * @param {any} variables
 * @param {{timePath?:string, locPath?:string}} [mapping] 玩家指定的时间／地点兜底字段
 * @returns {{ok:boolean, gt:string, loc:string, present:string[], people:Array<{name:string, fields:object}>}}
 */
export function parseMvu(variables, { timePath = '', locPath = '' } = {}) {
  const statData = readStatData(variables)
  if (!statData) return { ok: false, gt: '', loc: '', present: [], people: [] }
  return {
    ok: true,
    gt: extractGt(statData, timePath),
    loc: extractLoc(statData, locPath),
    present: extractPresent(statData),
    people: extractPeople(statData),
  }
}

/**
 * 取「剧情发生地点」。跟 gt 一样是**原文**，不解析、不做地理推断。
 * 卡里可能是对象（`{城市, 区域, 场所}`）也可能是字符串，都兼容；拿不到给空串。
 *
 * `locPath` 是玩家指定的**兜底字段**：自己抓不到才用它（2026-11-05）。
 * @returns {string}
 */
export function extractLoc(statData, locPath = '') {
  const place = statData?.地点
  if (typeof place === 'string' && place.trim()) return place.trim()
  if (place && typeof place === 'object' && !Array.isArray(place)) {
    const parts = Object.values(place)
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
    if (parts.length) return parts.join('·')
  }
  return pickPath(statData, locPath)
}