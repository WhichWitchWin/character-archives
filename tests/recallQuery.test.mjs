// 查档案（ADR 0089 §9）：显式点名拉一个角色的指针，三档。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPendingRecallText, normalizeLevel, queryPerson } from '../plugin/lib/recallQuery.js'
import { TRUTH, SELF } from '../plugin/lib/pointers.js'

const person = (id, status, name) => [id, status, name, [], '']
const claim = (id, about, code, content) => [id, about, code, content, 3, []]
const pointer = (personId, claimId, groups = [[TRUTH.TRUE, SELF, '三年五月']]) => [personId, claimId, groups, 3]

const snapshot = {
  p: [person('p1', 1, '老陈'), person('p2', 1, '李四')],
  c: [claim(1, 'p1', 'a', '在旧港'), claim(2, 'p2', 'a', '李四欠他钱')],
  pt: [pointer('p1', 1), pointer('p1', 2)],
}

test('normalizeLevel：全量/详细/简单 与英文都认，认不出回落默认', () => {
  assert.equal(normalizeLevel('全量'), 'full')
  assert.equal(normalizeLevel('详细'), 'detailed')
  assert.equal(normalizeLevel('简单'), 'brief')
  assert.equal(normalizeLevel('full'), 'full')
  assert.equal(normalizeLevel('', 'detailed'), 'detailed')
  assert.equal(normalizeLevel('乱七八糟', 'brief'), 'brief')
})

test('查档案：按人名拉到他的所有指针', () => {
  const result = queryPerson({ snapshot, name: '老陈' })
  assert.equal(result.ok, true)
  assert.ok(result.text.includes('在旧港'))
  assert.ok(result.text.includes('李四欠他钱'))
  assert.equal(result.pointers.length, 2)
})

test('查档案：详细档带态度/来源/时间，简单档只有内容', () => {
  const detailed = queryPerson({ snapshot, name: '老陈', level: 'detailed' })
  assert.ok(detailed.text.includes('他自己确认过'))
  assert.ok(detailed.text.includes('三年五月'))
  const brief = queryPerson({ snapshot, name: '老陈', level: 'brief' })
  assert.ok(brief.text.includes('在旧港'))
  assert.ok(!brief.text.includes('他自己确认过'))
})

test('查档案：找不到人给原因，不抛错', () => {
  const result = queryPerson({ snapshot, name: '查无此人' })
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('找不到'))
})

test('查档案：这人没有指针时也给一句', () => {
  const empty = { p: [person('p9', 1, '新人')], c: [], pt: [] }
  const result = queryPerson({ snapshot: empty, name: '新人' })
  assert.equal(result.ok, true)
  assert.ok(result.text.includes('还没有任何认知'))
})

// ── 三档与冷却（2026-11-04 定）──
// 全量：恒不看冷却（显式要全部）；详细/简单：只看冷却外的。

// 这两个人的指针「最后变动轮」都是 0（很久没动），所以不会被"建立/修改盖章"挡住，
// 冷却只来自下面显式给的冷却表。
const snapshotOld = {
  p: [person('p1', 1, '老陈'), person('p2', 1, '李四')],
  c: [claim(1, 'p1', 'a', '在旧港'), claim(2, 'p2', 'a', '李四欠他钱')],
  pt: [
    ['p1', 1, [[TRUTH.TRUE, SELF, '三年五月']], 0],
    ['p1', 2, [[TRUTH.TRUE, SELF, '三年五月']], 0],
  ],
}

test('全量档：指针在冷却里也照给', () => {
  const cooldowns = { 'pt:p1:1': { lastTurn: 9, until: 19 } }
  const result = queryPerson({ snapshot: snapshotOld, name: '老陈', level: 'full', cooldowns, cooldownTurns: 10, turn: 10 })
  assert.ok(result.text.includes('在旧港'), '全量不该被冷却挡住')
  assert.equal(result.pointers.length, 2)
})

test('详细档：冷却中的指针不给，提示用全量', () => {
  const cooldowns = { 'pt:p1:1': { lastTurn: 9, until: 19 }, 'pt:p1:2': { lastTurn: 9, until: 19 } }
  const result = queryPerson({ snapshot: snapshotOld, name: '老陈', level: 'detailed', cooldowns, cooldownTurns: 10, turn: 10 })
  assert.ok(result.text.includes('都在冷却里'), result.text)
  assert.equal(result.pointers.length, 0)
})

test('详细档：只挡住冷却中那一条，其余照给', () => {
  const cooldowns = { 'pt:p1:1': { lastTurn: 9, until: 19 } }
  const result = queryPerson({ snapshot: snapshotOld, name: '老陈', level: 'detailed', cooldowns, cooldownTurns: 10, turn: 10 })
  assert.ok(!result.text.includes('在旧港'), '冷却那条不该出现')
  assert.ok(result.text.includes('李四欠他钱'), '没冷却的照给')
})

// ── 冲突显示口径（P20：cognition.conflictDisplay）──
// 查档案（面板／正文模型的 archive_query）和手动召回拼出来的文本，
// 跟自动召回走同一个渲染口径——不然同一件事在提示词里显示三种说法、在工具返回里显示一种，
// 模型会当成两件事。
const multiSnapshot = {
  p: [person('p1', 1, '老陈'), person('p2', 0, '李四'), person('p3', 0, '王五')],
  c: [claim(1, 'p1', 'a', '在旧港')],
  pt: [pointer('p1', 1, [[TRUTH.TRUE, SELF], [TRUTH.FALSE, 'p2'], [TRUTH.TRUE, 'p3']])],
}
const cognitionOf = (conflictDisplay) => ({ conflictDisplay })

test('查档案：不传口径时全部显示（向后兼容）', () => {
  const result = queryPerson({ snapshot: multiSnapshot, name: '老陈' })
  assert.ok(result.text.includes('他自己确认过'))
  assert.ok(result.text.includes('听李四说的'))
  assert.ok(result.text.includes('听王五说的'))
})

test('查档案：self 只显示他自己那组、latest 只显示最后一组', () => {
  const self = queryPerson({ snapshot: multiSnapshot, name: '老陈', cognition: cognitionOf('self') })
  assert.ok(self.text.includes('他自己确认过'))
  assert.ok(!self.text.includes('听李四说的'))

  const latest = queryPerson({ snapshot: multiSnapshot, name: '老陈', cognition: cognitionOf('latest') })
  assert.ok(latest.text.includes('听王五说的'))
  assert.ok(!latest.text.includes('他自己确认过'))
})

test('手动召回拼出来的文本也用同一个口径', () => {
  const result = buildPendingRecallText({
    snapshot: multiSnapshot,
    pending: [{ personId: 'p1', level: 'detailed' }],
    cognition: cognitionOf('latest'),
  })
  assert.ok(result.text.includes('听王五说的'))
  assert.ok(!result.text.includes('他自己确认过'), '注入正文时只显示最后一组')
  assert.equal(result.stamps.length, 1, '过滤显示不影响盖章清单')
})

// ── 手动改过：豁免一次（ADR 0118）——
// 只有「面板召回」这条路消费标记（它的结果会真进提示词）；「查认知」不传，
// 它只是给人看一眼，不该把玩家的豁免额度用掉。

const oneSnapshot = {
  p: [person('p1', 1, '老陈')],
  c: [claim(1, 'p1', 'a', '在旧港')],
  pt: [pointer('p1', 1)],   // 最后变动轮 = 3
}

test('面板召回：冷却中的指针，有豁免标记就能念出来并报「用掉了」', () => {
  const blocked = queryPerson({ snapshot: oneSnapshot, name: '老陈', turn: 5, cooldownTurns: 10 })
  assert.equal(blocked.pointers.length, 0, '没有标记时冷却照挡')

  const result = queryPerson({
    snapshot: oneSnapshot,
    name: '老陈',
    turn: 5,
    cooldownTurns: 10,
    manualFree: { 'pt:p1:1': 3 },
  })
  assert.ok(result.text.includes('在旧港'), '有标记就该念出来')
  assert.deepEqual(result.manualFreeUsed, ['pt:p1:1'])
  assert.deepEqual(result.manualFreeStale, [])
})

test('面板召回：标记白挂（本来不冷却）→ 报 stale', () => {
  const result = queryPerson({
    snapshot: oneSnapshot,
    name: '老陈',
    turn: 20,
    cooldownTurns: 10,
    manualFree: { 'pt:p1:1': 3 },
  })
  assert.ok(result.text.includes('在旧港'))
  assert.deepEqual(result.manualFreeStale, ['pt:p1:1'])
  assert.deepEqual(result.manualFreeUsed, [])
})

test('查认知：不传 manualFree 就完全不消费标记', () => {
  const result = queryPerson({ snapshot: oneSnapshot, name: '老陈', turn: 20, cooldownTurns: 10 })
  assert.deepEqual(result.manualFreeUsed, [])
  assert.deepEqual(result.manualFreeStale, [])
})

test('面板召回：全量档不看冷却，但真给了也算用掉', () => {
  const result = queryPerson({
    snapshot: oneSnapshot,
    name: '老陈',
    level: 'full',
    turn: 5,
    cooldownTurns: 10,
    manualFree: { 'pt:p1:1': 3 },
  })
  assert.ok(result.text.includes('在旧港'), '全量档恒不看冷却')
  assert.deepEqual(result.manualFreeUsed, ['pt:p1:1'], '给了就算用掉')
})

test('面板召回：被 skip 挡掉的指针不算用掉（同一轮已经在自动召回里给过了）', () => {
  const result = queryPerson({
    snapshot: oneSnapshot,
    name: '老陈',
    level: 'full',
    turn: 5,
    cooldownTurns: 10,
    manualFree: { 'pt:p1:1': 3 },
    skip: new Set(['pt:p1:1']),
  })
  assert.equal(result.pointers.length, 0)
  assert.deepEqual(result.manualFreeUsed, [], '没进文本就不算用掉')
})
