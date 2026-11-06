// 手动召回进上下文（ADR 0089 补充）：面板上点「召回」= 排队，下一轮正文生成前拼进提示词。
//
// 和「查认知」的区别：查认知只给人看、不盖章、不进上下文；召回进上下文、按档位、注入了才盖章。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPendingRecallText, queryPerson } from '../plugin/lib/recallQuery.js'
import { TRUTH, SELF } from '../plugin/lib/pointers.js'

const person = (id, status, name) => [id, status, name, [], '']
const claim = (id, about, code, content) => [id, about, code, content, 3, []]
const pointer = (personId, claimId, groups, lastTurn = 0) => [personId, claimId, groups, lastTurn]

const snapshot = {
  p: [person('p1', 1, '老陈'), person('p2', 1, '李四')],
  c: [claim(1, 'p1', 'a', '在旧港'), claim(2, 'p2', 'a', '李四欠他钱')],
  pt: [
    pointer('p1', 1, [[TRUTH.TRUE, SELF, '三年五月']]),
    pointer('p2', 2, [[TRUTH.TRUE, SELF, '三年五月']]),
  ],
}

// ── 按编号查（面板召回排队存的是编号，不是名字）──

test('查档案：给编号也能查到人', () => {
  const result = queryPerson({ snapshot, personId: 'p1', level: 'full' })
  assert.equal(result.ok, true)
  assert.ok(result.text.includes('在旧港'))
  assert.equal(result.pointers.length, 1)
})

test('查档案：编号查不到时给原因', () => {
  const result = queryPerson({ snapshot, personId: 'p404', level: 'full' })
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('找不到'))
})

// ── 排队拼注入文本 ──

test('排队为空：不产出文本、不盖章', () => {
  const result = buildPendingRecallText({ snapshot, pending: [] })
  assert.equal(result.text, '')
  assert.deepEqual(result.stamps, [])
  assert.deepEqual(result.done, [])
})

test('排队一个人：拼进文本、给出要盖章的指针、标记已处理', () => {
  const result = buildPendingRecallText({
    snapshot,
    pending: [{ personId: 'p1', level: 'detailed' }],
  })
  assert.ok(result.text.includes('在旧港'))
  assert.ok(!result.text.includes('李四欠他钱'), '没点名的人不该混进来')
  assert.deepEqual(result.done, ['p1'])
  assert.equal(result.stamps.length, 1)
  assert.equal(result.stamps[0][1], 1)
})

test('排队两个人：都拼进去，本人才有的内容互不串台', () => {
  const result = buildPendingRecallText({
    snapshot,
    pending: [{ personId: 'p1', level: 'brief' }, { personId: 'p2', level: 'brief' }],
  })
  assert.ok(result.text.includes('在旧港'))
  assert.ok(result.text.includes('李四欠他钱'))
  assert.deepEqual(result.done.sort(), ['p1', 'p2'])
  assert.equal(result.stamps.length, 2)
})

test('排队的人认知全在冷却里：不占提示词，但仍标记已处理（不卡队列）', () => {
  const cooldowns = { 'pt:p1:1': { lastTurn: 9, until: 19 } }
  const result = buildPendingRecallText({
    snapshot,
    pending: [{ personId: 'p1', level: 'detailed' }],
    cooldowns,
    cooldownTurns: 10,
    turn: 10,
  })
  assert.equal(result.text, '')
  assert.deepEqual(result.stamps, [])
  assert.deepEqual(result.done, ['p1'])
})

test('全量档：冷却里的认知照拼（玩家显式要了全部）', () => {
  const cooldowns = { 'pt:p1:1': { lastTurn: 9, until: 19 } }
  const result = buildPendingRecallText({
    snapshot,
    pending: [{ personId: 'p1', level: 'full' }],
    cooldowns,
    cooldownTurns: 10,
    turn: 10,
  })
  assert.ok(result.text.includes('在旧港'))
  assert.equal(result.stamps.length, 1)
})

test('排队的人已经不在快照里：跳过并标记已处理，不让队列烂在那儿', () => {
  const result = buildPendingRecallText({
    snapshot,
    pending: [{ personId: 'p404', level: 'detailed' }],
  })
  assert.equal(result.text, '')
  assert.deepEqual(result.done, ['p404'])
})

test('排队里重复同一个人：只拼一次', () => {
  const result = buildPendingRecallText({
    snapshot,
    pending: [{ personId: 'p1', level: 'brief' }, { personId: 'p1', level: 'detailed' }],
  })
  assert.equal(result.done.length, 1)
  assert.equal(result.stamps.length, 1)
})

test('排队里有空编号的垃圾项：也标记已处理，别让它永远堵在队列里', () => {
  const result = buildPendingRecallText({
    snapshot,
    pending: [{ personId: '', level: 'detailed' }, { personId: 'p1', level: 'brief' }],
  })
  assert.deepEqual(result.done, ['', 'p1'])
  assert.ok(result.text.includes('在旧港'))
})

// ── 同一轮去重（2026-11-05）──
// 自动召回先算、手动召回后算，盖章发生在两者之后 —— 不显式跳过，同一条会在提示词里出现两遍。

const two = {
  p: [person('p1', 1, '老陈')],
  c: [claim(1, 'p1', 'a', '在旧港'), claim(2, 'p1', 'b', '手里有刀')],
  pt: [
    pointer('p1', 1, [[TRUTH.TRUE, SELF, '三年五月']]),
    pointer('p1', 2, [[TRUTH.TRUE, SELF, '三年五月']]),
  ],
}

test('查认知：skip 里的指针不出现，其余照给', () => {
  const result = queryPerson({
    snapshot: two,
    personId: 'p1',
    level: 'full',
    skip: new Set(['pt:p1:1']),
  })
  assert.ok(!result.text.includes('在旧港'))
  assert.ok(result.text.includes('手里有刀'))
  assert.equal(result.pointers.length, 1)
})

test('召回：skip 透传到查询里，被跳过的不算盖章', () => {
  const result = buildPendingRecallText({
    snapshot: two,
    pending: [{ personId: 'p1', level: 'detailed' }],
    skip: new Set(['pt:p1:1']),
    cooldownTurns: 0,
  })
  assert.ok(!result.text.includes('在旧港'))
  assert.ok(result.text.includes('手里有刀'))
  assert.equal(result.stamps.length, 1)
})

test('召回：这个人的认知全被 skip 了就不产出文本，但仍出队', () => {
  const result = buildPendingRecallText({
    snapshot: two,
    pending: [{ personId: 'p1', level: 'detailed' }],
    skip: new Set(['pt:p1:1', 'pt:p1:2']),
    cooldownTurns: 0,
  })
  assert.equal(result.text, '')
  assert.deepEqual(result.stamps, [])
  assert.deepEqual(result.done, ['p1'])
})
