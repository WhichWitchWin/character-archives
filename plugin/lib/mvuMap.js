// MVU 映射：只剩「认卡里有哪些人物字段」这一件事（2026-11-05 收窄）
//
// 人物字段**不再抄进档案**（[ADR 0091](../docs/adr/0091-MVU人物字段映射退役.md)）：
// 模型每轮读正文写命题＋指针，MVU 再抄一遍只会两边打架。
// 这里留着的用途只有一个——面板「MVU 时间与地点（兜底）」在没有字段可选时，
// 把这张卡的形状摊给玩家看，好知道为什么认不出。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/** 人名字段，不算"要抄的字段"。 */
const NAME_KEYS = new Set(['名字', '姓名', 'name'])

/**
 * 把「人物」容器摊平成人物对象数组。
 *
 * 认两种形状：
 *   · 数组：`人物: [{ 名字: '示例甲', 身份: '账房' }]`
 *   · 对象：`人物: { 示例甲: { 身份: '账房' } }` —— 键就是人名
 * 只认数组的话，写成对象表的卡会「一个字段都发现不了」，面板上整片空白。
 */
function peopleOf(statData) {
  const raw = statData?.人物
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === 'object')
  if (raw && typeof raw === 'object') {
    return Object.entries(raw)
      .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
      .map(([name, value]) => {
        const item = { ...value }
        if (!item.名字 && !item.姓名 && !item.name) item.名字 = name
        return item
      })
  }
  return []
}

/**
 * 摊平「人物」容器里的简单值字段，按字段名去重。
 * @param {object} statData
 * @returns {Array<{key:string, sample:string, count:number}>}
 */
export function listPersonFields(statData) {
  const people = peopleOf(statData)
  const seen = new Map()
  for (const person of people) {
    if (!person || typeof person !== 'object') continue
    for (const [key, value] of Object.entries(person)) {
      if (NAME_KEYS.has(key)) continue
      if (value === null || value === undefined) continue
      // 嵌套对象/数组这一版不接（只接简单值）
      if (typeof value === 'object') continue
      const text = String(value).trim()
      if (!text) continue
      if (!seen.has(key)) seen.set(key, { key, sample: text, count: 0 })
      seen.get(key).count += 1
    }
  }
  return [...seen.values()]
}

/**
 * 诊断：这张卡的 MVU 到底长什么样。
 *
 * 面板上「一个字段都认不出」时，光说"没读到 MVU 变量"没用——玩家没法告诉我们卡长什么样。
 * 这里把一级键、形状、条目数摊出来，界面直接显示，一眼就知道卡在哪。
 *
 * @returns {{keys: Array<{key:string, kind:'list'|'map'|'value', count:number}>, fields:number}}
 */
export function surveyStatData(statData) {
  const keys = []
  for (const [key, value] of Object.entries(statData ?? {})) {
    const kind = Array.isArray(value) ? 'list' : value && typeof value === 'object' ? 'map' : 'value'
    const count = kind === 'list' ? value.length : kind === 'map' ? Object.keys(value).length : 1
    keys.push({ key, kind, count })
  }
  return { keys, fields: listPersonFields(statData).length }
}
