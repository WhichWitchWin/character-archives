// 人物冷存档 · 该局的栏目定义（ADR 0008 / 0009）
//
// 栏目码 ↔ 栏目的对照**分三层**，别混：
//   1. 预设表 / MVU 映射表（跨局，存插件数据区）—— 只存**文字名**，不存码；
//   2. 该局的栏目定义（本文件）—— 名字落到哪个码，存**整局数据**；
//   3. 快照 —— 只有命题，没有定义。
//
// 码不随便回收。唯一安全的回收时机是「回退后已经跑了一轮、撤销不回来了」，
// 那时被丢弃未来的栏目码才回到空闲池（ADR 0009）。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

const LOWER = [...'abcdefghijklmnopqrstuvwxyz']        // 26
const UPPER = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']        // 26

/** 单字母码池：52 个。 */
export const SINGLE_CODES = Object.freeze([...LOWER, ...UPPER])

/** 空定义表。 */
export function createEntryDefinitions() {
  return {}
}

/** 写入/覆盖一个栏目定义，并记下它是第几轮建的。 */
export function defineEntry(definitions, code, definition, fromTurn) {
  return { ...(definitions ?? {}), [code]: { ...definition, fromTurn } }
}

/**
 * 按轮次取定义：创建之前的那一轮视为「这个栏目还不存在」。
 * 这样回退到更早的轮次时，界面上不会冒出一个空栏目。
 */
export function entryAt(definitions, code, turn) {
  const found = definitions?.[code]
  if (!found) return null
  if (Number.isFinite(found.fromTurn) && turn < found.fromTurn) return null
  return found
}

/** 下一个空闲的单字母码；码池满了返回 null。 */
export function nextFreeCode(definitions) {
  return SINGLE_CODES.find((code) => !definitions?.[code]) ?? null
}

/**
 * 回退确认之后调：删掉晚于 `turn` 才创建的定义，把它们的码交回空闲池。
 * 安全性来自「活着的快照最晚只到 turn，不可能引用 fromTurn > turn 的码」。
 * @returns {{defs: object, freed: string[]}}
 */
export function pruneFrom(definitions, turn) {
  const defs = {}
  const freed = []
  for (const [code, definition] of Object.entries(definitions ?? {})) {
    if (Number.isFinite(definition.fromTurn) && definition.fromTurn > turn) freed.push(code)
    else defs[code] = definition
  }
  return { defs, freed }
}
