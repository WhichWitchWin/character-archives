// 召回装配（设计稿 §7.3 预算与分级、§7.4 连带；分配方式为两阶段）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { allocateRecalls, charCount } from '../plugin/lib/compose.js'

const brief = (key, text) => ({ key, briefText: text })
const briefFull = (key, short, full) => ({ key, briefText: short, fullText: full })

test('字符数按码点算，不按字节', () => {
  assert.equal(charCount('老陈'), 2)
  assert.equal(charCount('ab'), 2)
  assert.equal(charCount(''), 0)
  assert.equal(charCount(null), 0)
})

test('没人命中时一个字都不注入', () => {
  assert.deepEqual(allocateRecalls([], { budget: 3000 }), { blocks: [], used: 0, dropped: [] })
})

test('保底阶段：人人先拿一行简版', () => {
  const result = allocateRecalls([brief('p1', '老陈 · 旧友'), brief('p2', '林小鱼 · 店员')], { budget: 100 })
  assert.deepEqual(result.blocks.map((block) => block.key), ['p1', 'p2'])
  assert.deepEqual(result.blocks.map((block) => block.level), ['brief', 'brief'])
  assert.equal(result.used, 15)
  assert.deepEqual(result.dropped, [])
})

test('装不下的跳过，但不挡住后面更短的', () => {
  const result = allocateRecalls([brief('big', '一二三四五六七八九十'), brief('small', '短')], { budget: 5 })
  assert.deepEqual(result.blocks.map((block) => block.key), ['small'])
  assert.deepEqual(result.dropped, ['big'])
})

test('加厚阶段：用剩余预算把排前面的升级成完整档案', () => {
  const result = allocateRecalls([
    briefFull('p1', '老陈', '老陈：旧友、旧港、欠条'),
    briefFull('p2', '林', '林小鱼：店员'),
  ], { budget: 100 })
  assert.equal(result.blocks[0].level, 'full')
  assert.equal(result.blocks[0].text, '老陈：旧友、旧港、欠条')
  assert.equal(result.blocks[1].level, 'full')
})

test('升级装不下就停在简版，不半截塞进去', () => {
  const result = allocateRecalls([
    briefFull('p1', '老陈', '老陈：'.padEnd(60, '旧')),
    briefFull('p2', '林小鱼', '林小鱼：'.padEnd(60, '店')),
  ], { budget: 70 })
  // 两条简版共 8 字；剩 62 字，第一个升级要多 55 → 可以；第二个升级要多 57 → 不行
  assert.equal(result.blocks[0].level, 'full')
  assert.equal(result.blocks[1].level, 'brief')
})

test('完整档案比简版还短时不升级（extra <= 0）', () => {
  const result = allocateRecalls([briefFull('p1', '一二三四五', '短')], { budget: 100 })
  assert.equal(result.blocks[0].level, 'brief')
  assert.equal(result.blocks[0].text, '一二三四五')
})

test('常驻摘要先占预算', () => {
  const candidates = [brief('p1', '一二三')]   // 3 字
  assert.deepEqual(allocateRecalls(candidates, { budget: 10, residentChars: 5 }).blocks.map((b) => b.key), ['p1'])
  assert.deepEqual(allocateRecalls(candidates, { budget: 10, residentChars: 8 }).blocks, [])
})

test('预算被常驻摘要吃光时，全部丢弃', () => {
  const result = allocateRecalls([brief('p1', '甲')], { budget: 10, residentChars: 10 })
  assert.deepEqual(result.blocks, [])
  assert.deepEqual(result.dropped, ['p1'])
  assert.equal(result.used, 0)
})
