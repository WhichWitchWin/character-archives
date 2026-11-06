// 名字（姓名／别名）的切分与拼装——**唯一口径**。
//
// 为什么单独一个模块：存储侧原来只按半角逗号切，匹配侧却按「,，、」三种切，
// 两边不一致过。模型给出「老陈头，掌柜」时，撞名体检查不出「掌柜」，
// 但匹配层却能命中它——撞名照样会静默丢数据（ADR 0084）。切分只留一份实现。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/** 别名分隔符：半角逗号、全角逗号、顿号。模型三种都会写，玩家也会。 */
const ALIAS_SEPARATORS = /[,，、]/u

/**
 * 把别名字段拆成干净的数组。
 * 既能吃字符串（快照里那种 "陈先生,老陈头"），也能吃数组；去空、去重、保序。
 * @param {string|string[]|undefined|null} raw
 * @returns {string[]}
 */
export function splitAliases(raw) {
  const list = Array.isArray(raw) ? raw : [raw]
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    for (const piece of item.split(ALIAS_SEPARATORS)) {
      const text = piece.trim()
      if (text) out.push(text)
    }
  }
  return [...new Set(out)]
}

/** 存回快照时统一用半角逗号拼——存储格式只有一种。 */
export function joinAliases(raw) {
  return splitAliases(raw).join(',')
}

/** 一个人身上所有能用来找他的名字：姓名 + 别名。 */
export function namesOfPerson(person) {
  const name = String(person?.[2] ?? '').trim()
  const aliases = splitAliases(person?.[3])
  return name ? [name, ...aliases] : aliases
}
