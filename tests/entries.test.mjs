// 该局的条目定义（码 → 条目），以及回退后的清理（ADR 0008 / 0009）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SINGLE_CODES,
  createEntryDefinitions,
  defineEntry,
  entryAt,
  nextFreeCode,
  pruneFrom,
} from '../plugin/lib/entries.js'

const def = (name, extra = {}) => ({ name, prompt: '', ...extra })

test('单字母码池：52 个（大小写各 26）', () => {
  assert.equal(SINGLE_CODES.length, 52)
  assert.equal(new Set(SINGLE_CODES).size, 52)
  assert.ok(SINGLE_CODES.includes('a'))
  assert.ok(SINGLE_CODES.includes('X'))
  assert.ok(SINGLE_CODES.includes('Z'))
})

test('第一个空闲码是 a，用过之后顺延', () => {
  assert.equal(nextFreeCode(createEntryDefinitions()), 'a')
  const defs = defineEntry(createEntryDefinitions(), 'a', def('姓名'), 1)
  assert.equal(nextFreeCode(defs), 'b')
})

test('码池用满时返回 null', () => {
  let defs = createEntryDefinitions()
  for (const code of SINGLE_CODES) defs = defineEntry(defs, code, def('占位'), 1)
  assert.equal(nextFreeCode(defs), null)
})

test('定义记下 fromTurn', () => {
  const defs = defineEntry(createEntryDefinitions(), 'a', def('姓名'), 5)
  assert.equal(defs.a.fromTurn, 5)
  assert.equal(defs.a.name, '姓名')
})

test('按轮次取定义：创建之前视为不存在', () => {
  const defs = defineEntry(createEntryDefinitions(), 'xa', def('口头禅'), 10)
  assert.equal(entryAt(defs, 'xa', 8), null)          // 还没建
  assert.equal(entryAt(defs, 'xa', 10).name, '口头禅') // 创建当轮有了
  assert.equal(entryAt(defs, 'xa', 15).name, '口头禅')
  assert.equal(entryAt(defs, 'zz', 15), null)          // 压根没有
})

test('清理：删掉 late 于回退点的定义，并交回被回收的码', () => {
  let defs = createEntryDefinitions()
  defs = defineEntry(defs, 'a', def('姓名'), 1)
  defs = defineEntry(defs, 'xa', def('口头禅'), 10)
  defs = defineEntry(defs, 'xb', def('绰号'), 20)

  const result = pruneFrom(defs, 8)
  assert.deepEqual(Object.keys(result.defs), ['a'])
  assert.deepEqual(result.freed.sort(), ['xa', 'xb'])
  assert.deepEqual(result.defs.a.name, '姓名')
})

test('清理后码能重新分配给新条目', () => {
  let defs = createEntryDefinitions()
  defs = defineEntry(defs, 'a', def('姓名'), 1)
  defs = defineEntry(defs, 'b', def('口头禅'), 10)
  const { defs: pruned } = pruneFrom(defs, 8)
  assert.equal(nextFreeCode(pruned), 'b')
})

test('清理不动等于回退点的条目（创建于该轮仍保留）', () => {
  const defs = defineEntry(createEntryDefinitions(), 'b', def('口头禅'), 8)
  assert.deepEqual(Object.keys(pruneFrom(defs, 8).defs), ['b'])
})

test('是纯函数，不改原对象', () => {
  const original = defineEntry(createEntryDefinitions(), 'xa', def('口头禅'), 10)
  pruneFrom(original, 8)
  assert.equal(Object.keys(original).length, 1)
})
