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

  // 写入方式（ADR 0007）：async 异步结算（默认，不阻塞）/ background 后台结算（阻塞，保证赶上下一轮）/ off 关闭
  writeback: Object.freeze({
    mode: 'async',
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
    budgetChars: 2000,         // 每轮召回字数预算
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
