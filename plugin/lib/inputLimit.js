// 模型交回来的 JSON，一律要**过一遍输入限制**（ADR 0069）。
//
// 为什么要有：模型（或玩家）可能报出带引号、括号、反斜杠、控制字符的东西。
// 这些东西拼进存储、拼进提示词、拼进 JSON 都会出问题，而且**静默出问题**——
// 值写不进去、面板显示错乱、下次读不出来，只能靠猜。
//
// 尺度：**玩家日常会用的**。别的都不要。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/**
 * 允许出现的符号（**除了**汉字、字母、数字之外）。
 *
 * 为什么只留这几个：
 *   · 「·」间隔号——名字里常见（阿·卡、瓦西里·普希金）
 *   · 「-」连字符——名字里常见（陈-九、Anne-Marie）
 *   · 空格——「张 三」这种排版
 *   · 「（）」「《》」全角括号——**只允许成对的全角括号**（中文日常用法）
 *   · 「，」「。」「、」「：」「；」「！」「？」等全角标点——中文日常用法
 *
 * **不允许**：所有半角标点（英文的 , . ! ? ; : " ' ( ) [ ] { } < > / \ | ~ @ # $ % ^ * + = _ `）
 * 这些在 JSON 里都有特殊含义，或者在中文正文里根本不出现。
 */
export const ALLOWED_SYMBOLS = Object.freeze([
  '·', '-', ' ', '（）', '《》', '，', '。', '、', '：', '；', '！', '？', '～',
])

/** 界面用的一句话说明（玩家看得懂就行）。 */
export function describeAllowed() {
  return '汉字、字母、数字，以及 · - 空格 和全角标点（，。、：；！？（）《》～）'
}

/**
 * 名字（姓名／别名）能用的字符，比正文**更严**。
 *
 * 为什么不给"特殊输入也能用"的兼容：
 *   · **括号**——素材里重名者写作「老陈(p7)」，名字里带括号会跟编号尾巴的解析打架，
 *     后果是这个人按名字永远写不进去，而且没有任何提示；
 *   · **逗号／顿号**——那是别名的分隔符，名字里带它会被切成两个人名。
 * 名字是门牌号，宁可让玩家改一个字符，也不要让程序去猜。
 */
const ALLOWED_NAME_RE = /^[\u4e00-\u9fff\u3400-\u4dbfA-Za-z0-9·\- \u3000]+$/u

/** 姓名／别名的长度上限（按字符算）。改名、建档、查询共用这一个数。 */
export const NAME_MAX = 24

/**
 * 输入框实时过滤：把名字里不能用的字符直接剔掉。
 *
 * 浏览器侧照抄一份（`client.js` 的 `filterNameChars`）——它不能 import lib。
 * 两边正则与上限由 `tests/queryInput.test.mjs` 的守卫测试比对，改一边必须改另一边。
 */
export function filterNameChars(text, max = NAME_MAX) {
  const kept = [...String(text ?? '')].filter((ch) => ALLOWED_NAME_RE.test(ch))
  return kept.slice(0, max).join('')
}

/** 名字的允许范围（报错时给玩家看）。 */
export function describeAllowedName() {
  return '汉字、字母、数字，以及 · - 空格（不能有括号、逗号、顿号）'
}

/**
 * 逐字检查：**只允许**汉字、字母、数字、白名单里的符号。
 *
 * 不用"黑名单"的方式——黑名单永远列不全（ASCII 有一百多个符号）。
 * 改成白名单：只要不在白名单里，一律拒。
 */
const ALLOWED_RE = /^[\u4e00-\u9fff\u3400-\u4dbfA-Za-z0-9·\- \u3000\uFF08\uFF09\u300A\u300B\uFF0C\u3002\u3001\uFF1A\uFF1B\uFF01\uFF1F\uFF5E]+$/

/** 找出第一个不该有的字符（报错要指名道姓，别只说"不合法"）。 */
function firstBadChar(re, text) {
  for (const ch of text) {
    if (!re.test(ch)) return ch
  }
  return null
}

/**
 * 检查一段文本合不合法。
 *
 * @param {string} text 要检查的内容
 * @param {string} label 报错时用的称呼（"姓名"/"别名"/"栏目"/"值"…）
 * @param {{max?:number, kind?:'text'|'name'}} [options]
 *   max：长度上限（按字符算，不按字节）；kind='name' 时用更严的名字白名单。
 * @returns {{ok:boolean, reason:string|null, badChar?:string}}
 */
export function checkText(text, label = '内容', { max = 200, kind = 'text' } = {}) {
  const raw = text === null || text === undefined ? '' : String(text)
  if (!raw.trim()) return { ok: false, reason: `${label}不能为空` }

  const isName = kind === 'name'
  const bad = firstBadChar(isName ? ALLOWED_NAME_RE : ALLOWED_RE, raw)
  if (bad !== null) {
    const shown = bad === '\n' ? '换行' : bad === '\t' ? '制表符' : bad
    return {
      ok: false,
      reason: isName
        ? `${label}里有不能用的符号「${shown}」——只允许：${describeAllowedName()}`
        : `${label}里有不该出现的符号「${shown}」——只允许：${describeAllowed()}`,
      badChar: bad,
    }
  }

  const length = [...raw].length
  if (length > max) {
    return { ok: false, reason: `${label}太长了（${length} 字，上限 ${max}）` }
  }
  return { ok: true, reason: null }
}
