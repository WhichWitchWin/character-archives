// 三段可编辑的提示词：系统、写入、召回（注入正文）
//
// 为什么让玩家改：这三段是"我们怎么跟模型说话"，措辞直接影响模型行为。
// 写死在代码里只能等发版，而调提示词是高频动作。
//
// 存在**整局数据**（`state.prompts`）：它是交流方式，跟卡无关。
// **空串 = 用默认**——这样随时能"恢复默认"，玩家不用记住原文。
//
// 占位符 `{{NAME}}`：填的时候只替换已知的键，未知的**原样保留**
// （这样玩家写错一个名字不会把整段吞掉，也方便以后加变量）。

/**
 * 每段能用的占位符，界面上直接展示，免得玩家猜。
 * @type {{system:string[], write:string[], recall:string[]}}
 */
export const PLACEHOLDERS = Object.freeze({
  system: Object.freeze(['PERSON', 'PLAYER', 'ENTRIES']),
  write: Object.freeze(['GT', 'PEOPLE']),
  recall: Object.freeze(['VIEWPOINT', 'GT', 'LOC', 'STAMP', 'BLOCKS']),
})

/**
 * 默认模板。
 *
 * **渲染结果必须和改造前逐字一致**——玩家不改的时候，行为一点都不能变。
 * 系统提示词那段是长文本，单独放在 prompt.js 里（由 plugin/assets/system-prompt.txt 生成），
 * 这里只放一个标记，由调用方传入默认值。
 */
export const DEFAULT_TEMPLATES = Object.freeze({
  // 系统提示词：真正的内容在 plugin/prompt.js（唯一真相源是 plugin/assets/system-prompt.txt）
  system: '',
  write: [
    '【写入】',
    '',
    '【当前游戏内时间】{{GT}}',
    '',
    '{{PEOPLE}}',
  ].join('\n'),
  // 「当前」那一行用 {{STAMP}}：它已经把「时间 · 地点」（或只有其中一个）拼好，
  // 这样地点为空时不会留下一个孤零零的「·」。玩家想自己拼可以改用 {{GT}}/{{LOC}}。
  recall: [
    '【人物档案参考】',
    '本局写作人称：{{VIEWPOINT}}',
    '当前：{{STAMP}}',
    '',
    '{{BLOCKS}}',
  ].join('\n'),
})

/**
 * 把模板里的 `{{KEY}}` 换成值。
 *
 * 用**逐字符扫描**而不是 `String.replace`：玩家写的值里可能带 `$&`、`$1` 这类
 * replace 特殊模式，会被当成替换语法吃掉。未知占位符原样保留。
 *
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function fillTemplate(template, vars = {}) {
  const source = String(template ?? '')
  const table = vars && typeof vars === 'object' ? vars : {}
  let out = ''
  let index = 0

  while (index < source.length) {
    const open = source.indexOf('{{', index)
    if (open < 0) {
      out += source.slice(index)
      break
    }
    out += source.slice(index, open)

    const close = source.indexOf('}}', open + 2)
    if (close < 0) {
      out += source.slice(open)
      break
    }

    const key = source.slice(open + 2, close).trim()
    if (Object.hasOwn(table, key)) out += String(table[key] ?? '')
    else out += source.slice(open, close + 2)   // 未知占位符原样留着

    index = close + 2
  }
  return out
}

/**
 * 读设置：存过的用存的，空串/缺失/脏值一律回落默认。
 * @param {{system?:string, write?:string, recall?:string}|null} saved
 * @param {{system?:string}} defaults 系统提示词的默认值由调用方注入
 * @returns {{system:string, write:string, recall:string}}
 */
export function resolveTemplates(saved, defaults = {}) {
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  const pick = (key) => {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value
    return defaults[key] ?? DEFAULT_TEMPLATES[key]
  }
  return { system: pick('system'), write: pick('write'), recall: pick('recall') }
}
