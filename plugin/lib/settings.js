// 人物冷存档 · 设置项默认值（唯一事实来源）
//
// 全部取自设计稿 §8.6「设置页」表格。改默认值只改这里，别在别处再抄一份。
// 存放位置：savePluginData（插件自己的数据，不跟某一局走，见 plugin-api-data.md）。

/**
 * 设置项的默认值。
 * 信度的 reopenAs 用信度码表示「未知来源·未定」= '7'（设计稿 §5.6）。
 */
export const DEFAULT_SETTINGS = Object.freeze({
  // 首次离场（设计稿 §「首次离场」）
  firstExit: Object.freeze({
    mode: 'auto',              // 'auto' 自动写入 | 'manual' 手动写入
    confirmAmbiguous: false,   // 勾选后模糊离场先挂 3 轮待确认
    nominationTurns: 5,        // 手动写入的提名停留轮数（1～10）
    fuzzyTurns: 3,             // 模糊离场判定轮数（1～5）
  }),

  // 档案写入方式（ADR 0007）：subagent 子代理写入（默认，不等）/ background 后台写入（阻塞，保证及时）/ off 关闭
  writeback: Object.freeze({
    mode: 'subagent',
  }),

  // 信度（§5.3～§5.6）
  confidence: Object.freeze({
    enabled: true,             // 按卡，默认开
    editAsUser: false,         // 信度编辑：勾上则改来源为「用户」
    editTruth: 'keep',         // 'keep' 不改 | 'true' 真 | 'unknown' 未定 | 'false' 假
    closeOrder: Object.freeze(['turn', 'salience', 'truth', 'source']),
    reopenAs: '7',             // 重新开启时信度归为：默认未知来源·未定
  }),

  // MVU 容灾（仅状态机卡可用）
  mvuRescue: true,

  // 条目预设库 / MVU 映射（§8.8）
  presetLibrary: Object.freeze({
    autoMap: true,
    acceptModelValuesForMvu: false,
  }),

  // 召回（§7.3～§7.5、§7.10）
  recall: Object.freeze({
    budgetChars: 3000,         // 每轮召回注入的**上限**（字符数），不是每轮固定注入这么多
    budgetMin: 500,
    budgetMax: 6000,
    level: 'mixed',            // 'mixed' 混合 | 'full' 全部全量 | 'brief' 全部简版
    modelQueryTool: true,      // 前台模型主动查询工具
    algorithm: 'equal-weight', // 'equal-weight' 等权归一化 | 'rrf' 名次融合
    maintainUnmapped: true,    // 未映射的内置条目是否也由正文自动维护
    cooldownOn: true,          // 召回冷却开关
    cooldownTurns: 10,         // 冷却轮数（0～20）
    residentSummary: false,    // 常驻摘要开关
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

  // 容量（§3.5、§3.7）
  capacity: Object.freeze({
    hintPercent: 60,
    keepTurnsOnCompact: 10,    // 压缩时保留轮数（0～50）
  }),

  // 提示详细程度（§3.5）
  notice: Object.freeze({
    detail: 'standard',        // 'brief' 简洁 | 'standard' 标准 | 'detail' 详细
  }),
})

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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
    label: '子代理写入',
    detail: '每轮派一个临时子代理去判断和整理，派出去就不等它了。',
    pros: Object.freeze(['你完全不会被卡住', '人物册在后台自己慢慢更新']),
    cons: Object.freeze(['记录可能晚一轮才出现：这一轮刚发生的事，下一轮注入时可能还没写进去']),
  }),
  Object.freeze({
    id: 'background',
    label: '后台写入',
    detail: '把它挂在酒馆的后台结算里，写完了才继续下一轮。',
    pros: Object.freeze(['最及时：这一轮发生的事，下一轮就能用上']),
    cons: Object.freeze(['每轮会多等一会儿，任务越慢等得越久', '有后台任务时本局会显示后台忙，编辑等操作要等它结束']),
  }),
  Object.freeze({
    id: 'off',
    label: '关闭',
    detail: '不自动判断、不自动写档案。',
    pros: Object.freeze(['不花后台模型的额度', '完全不会打扰你']),
    cons: Object.freeze(['人物册只能靠你自己在面板里手动维护']),
  }),
])

/** 取某一档的文案；档位不认识时回落到默认档。 */
export function writebackMode(mode) {
  return WRITEBACK_MODES.find((item) => item.id === mode) ?? WRITEBACK_MODES[0]
}
