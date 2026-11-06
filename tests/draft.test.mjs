// 模糊建档表：程序扫 + 清理（ADR 0036 定的"程序扫是主路径"）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { expireDraft, pruneDraft, scanDraft } from '../plugin/lib/draft.js'
import { createSegmenter } from '../plugin/lib/segment.js'
import { configureSegmenter } from '../plugin/lib/match.js'
import { readFileSync } from 'node:fs'

// 匹配层现在走分词：用真实词表，测试行为与线上一致
const seg = createSegmenter({
  dictText: readFileSync(new URL('../plugin/assets/dict/zh.txt', import.meta.url), 'utf8'),
  extraWords: ['周', '卖炭翁', '沈九', '老陈'],
})
configureSegmenter(seg)

const draft = { 卖炭翁: 30, 沈九: 33, 老陈: 12 }
const person = (name, aliases = '') => ['p1', 1, name, aliases]

test('扫正文：只返回本轮真的出现的名字（素材只列这些）', () => {
  const hits = scanDraft(draft, '卖炭翁挑着担子从巷口过来，瞥了沈九一眼。')
  assert.deepEqual(hits.sort(), ['卖炭翁', '沈九'].sort())
})

test('扫正文：一个有都没命中就返回空数组', () => {
  assert.deepEqual(scanDraft(draft, '天亮了，街上没人。'), [])
  assert.deepEqual(scanDraft(draft, ''), [])
  assert.deepEqual(scanDraft({}, '卖炭翁来了'), [])
})

test('扫正文：单字名只认称谓，不会因为出现单个字就命中', () => {
  const single = { 周: 20 }
  // 「周末」里的「周」不算点名（沿用召回的正文口径）
  assert.deepEqual(scanDraft(single, '周末的集市很热闹。'), [])
  // 带称谓才算
  assert.deepEqual(scanDraft(single, '周老板来了。'), ['周'])
})

test('清理：已经建档的人要从模糊建档表里去掉', () => {
  const persons = [person('老陈', '陈先生')]
  const result = pruneDraft(draft, persons)
  assert.deepEqual(result.removed, ['老陈'])
  assert.equal(result.draft.老陈, undefined)
  assert.equal(result.draft.卖炭翁, 30, '没建档的保留')
})

test('清理：别名撞上也要去掉（同一个人换了叫法）', () => {
  const persons = [person('陈师傅', '老陈')]
  const result = pruneDraft(draft, persons)
  assert.deepEqual(result.removed, ['老陈'])
})

test('清理：不修改传进来的对象（纯函数）', () => {
  const original = { ...draft }
  pruneDraft(original, [person('老陈')])
  assert.deepEqual(original, draft)
})

test('清理：没有人需要去掉时原样返回', () => {
  const result = pruneDraft(draft, [person('张三')])
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.draft, draft)
})

// ---------- 过期清理（ADR 0075）----------
// 表里的值改成「最后一次露面的轮次」：入表时＝当前轮，之后每次命中刷成当前轮。

test('过期：连续够 N 轮没露面就清掉', () => {
  const table = { 卖炭翁: 10, 沈九: 14 }
  // 第 15 轮，上限 5：卖炭翁 15-10=5 → 清；沈九 15-14=1 → 留
  const result = expireDraft(table, { hits: [], turn: 15, maxIdle: 5 })
  assert.deepEqual(result.removed, ['卖炭翁'])
  assert.deepEqual(result.draft, { 沈九: 14 })
})

test('过期：还差一轮就够数时不清', () => {
  const result = expireDraft({ 卖炭翁: 10 }, { hits: [], turn: 14, maxIdle: 5 })
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.draft, { 卖炭翁: 10 })
})

test('过期：本轮露面就把时间戳推到现在（不会误清）', () => {
  const result = expireDraft({ 卖炭翁: 10, 沈九: 9 }, { hits: ['卖炭翁'], turn: 15, maxIdle: 5 })
  assert.deepEqual(result.touched, ['卖炭翁'])
  assert.deepEqual(result.removed, ['沈九'])
  assert.equal(result.draft.卖炭翁, 15, '时间戳要刷新成当前轮')
})

test('过期：刚入表的人当轮不会被清（差 0 轮）', () => {
  const result = expireDraft({ 新面孔: 12 }, { hits: [], turn: 12, maxIdle: 1 })
  assert.deepEqual(result.removed, [])
})

test('过期：上限设为 1 时，下一轮没露面就清', () => {
  assert.deepEqual(expireDraft({ 甲: 10 }, { hits: [], turn: 11, maxIdle: 1 }).removed, ['甲'])
  assert.deepEqual(expireDraft({ 甲: 10, 乙: 11 }, { hits: ['乙'], turn: 11, maxIdle: 1 }).removed, ['甲'])
})

test('过期：上限非法值回落到默认 3，最小值按 1 处理', () => {
  // 0 / 负数一律按 1 算：只要没露面就够数（不能变成"永不过期"）
  assert.deepEqual(expireDraft({ 甲: 10 }, { hits: [], turn: 11, maxIdle: 0 }).removed, ['甲'], '0 按 1 算')
  assert.deepEqual(expireDraft({ 甲: 10, 乙: 11 }, { hits: ['乙'], turn: 11, maxIdle: -3 }).removed, ['甲'], '负数也按 1 算')
  // NaN 这种非法值回落默认 3（2026-11-06：默认由 5 收到 3）
  assert.deepEqual(expireDraft({ 甲: 10 }, { hits: [], turn: 12, maxIdle: NaN }).removed, [], '差 2 轮不清')
  assert.deepEqual(expireDraft({ 甲: 10 }, { hits: [], turn: 13, maxIdle: NaN }).removed, ['甲'], '差 3 轮清')
})

test('过期：轮次不是整数的脏数据不碰（清理不该误伤来历不明的东西）', () => {
  const result = expireDraft({ 脏的: 'x', 甲: 10 }, { hits: [], turn: 99, maxIdle: 5 })
  assert.deepEqual(result.removed, ['甲'])
  assert.deepEqual(result.draft, { 脏的: 'x' })
})

test('过期：不修改传进来的对象（纯函数）', () => {
  const original = { 卖炭翁: 10 }
  expireDraft(original, { hits: [], turn: 99, maxIdle: 5 })
  assert.deepEqual(original, { 卖炭翁: 10 })
})

test('过期：空表或非法输入安全返回', () => {
  assert.deepEqual(expireDraft({}, { turn: 5 }).removed, [])
  assert.deepEqual(expireDraft(null, { turn: 5 }).draft, {})
  assert.deepEqual(expireDraft(undefined, {}).draft, {})
})
