// 快照结构（设计稿 §4.1 字段、§4.8 版本与迁移、ADR 0005 的 gt）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

import {
  SNAPSHOT_VERSION,
  STATUS,
  readOrCreateSnapshot,
  byteSize,
  createSnapshot,
  findPerson,
  readSnapshot,
  resolveTurn,
} from '../plugin/lib/snapshot.js'
import { GT, SNAPSHOT } from './fixtures/sample.mjs'

test('空快照带 gt（默认空串）', () => {
  assert.deepEqual(createSnapshot(40), { v: SNAPSHOT_VERSION, t: 40, p: [], gt: '', loc: '', c: [], pt: [] })
  assert.deepEqual(createSnapshot(40, GT), { v: SNAPSHOT_VERSION, t: 40, p: [], gt: GT, loc: '', c: [], pt: [] })
})

test('快照带空的命题表和指针表', () => {
  const snapshot = createSnapshot(40)
  assert.deepEqual(snapshot.c, [])
  assert.deepEqual(snapshot.pt, [])
})

test('读旧快照时缺失的命题表 / 指针表补成空数组', () => {
  const result = readSnapshot({ v: 1, t: 3, p: [] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.snapshot.c, [])
  assert.deepEqual(result.snapshot.pt, [])
})

test('读快照时命题表不是数组 → 记 problem 并补空', () => {
  const result = readSnapshot({ v: 1, t: 3, p: [], c: 'x' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.snapshot.c, [])
  assert.ok(result.problems.some((item) => item.includes('命题')))
})

test('读快照保留命题与指针内容', () => {
  const result = readSnapshot({
    v: 1,
    t: 3,
    p: [],
    c: [[1, 'p7', 'a', '在旧港', 3, [], 0]],
    pt: [['p7', 1, [[0, '']], 3]],
  })
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.c.length, 1)
  assert.equal(result.snapshot.c[0][3], '在旧港')
  assert.equal(result.snapshot.pt.length, 1)
})

test('状态只有离场/在场两个值（容灾状态已删，ADR 0045）', () => {
  assert.deepEqual(STATUS, { OFFLINE: 0, PRESENT: 1 })
})

test('人物固定 4 格：编号、状态、姓名、别名串', () => {
  const result = readSnapshot({ v: 1, t: 3, p: [['p1', 1, '老陈', '陈先生']] })
  assert.deepEqual(result.snapshot.p[0], ['p1', 1, '老陈', '陈先生'])
})

test('旧格式（人物 5 格、别名在第 5 位）不认：那一格不是文字，整个人被跳过', () => {
  const result = readSnapshot({ v: 1, t: 3, p: [['p1', 1, '老陈', [], '陈先生']] })
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.p.length, 0)
  assert.equal(result.problems.length, 1)
})

test('人物少于 4 格 → 只丢那一个', () => {
  const result = readSnapshot({ v: 1, t: 3, p: [['p1', 1, '老陈']] })
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.p.length, 0)
  assert.equal(result.problems.length, 1)
})

test('别名不是文字 → 只丢那一个', () => {
  const result = readSnapshot({ v: 1, t: 3, p: [['p1', 1, '老陈', 42]] })
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.p.length, 0)
  assert.equal(result.problems.length, 1)
})

test('坏人物只丢那一个，其余保住', () => {
  const raw = { v: 1, t: 1, p: [['p1', 0, '甲', ''], ['p2', 9, '乙', '']] }
  const result = readSnapshot(raw)
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.p.length, 1)
  assert.equal(result.snapshot.p[0][0], 'p1')
  assert.equal(result.problems.length, 1)
})

test('合法快照原样通过，没有 problems', () => {
  const result = readSnapshot(SNAPSHOT)
  assert.equal(result.ok, true)
  assert.deepEqual(result.snapshot, { ...SNAPSHOT, c: [], pt: [] })
  assert.deepEqual(result.problems, [])
})

test('读回来的是深拷贝', () => {
  const raw = { v: 1, t: 1, p: [['p1', 0, '甲', '']], c: [[1, 'p1', 'a', '在旧港', 1, [], 0]] }
  const result = readSnapshot(raw)
  result.snapshot.c[0][3] = '改了'
  assert.equal(raw.c[0][3], '在旧港')
})

test('结构根本不对才整份拒绝；v 必须是正整数', () => {
  for (const raw of [null, undefined, 'x', 42, [], {}, { v: 1 }, { v: 1, t: 1, p: 'x' }]) {
    assert.equal(readSnapshot(raw).ok, false, `应拒绝：${JSON.stringify(raw)}`)
  }
  for (const v of [NaN, 1.5, -1, '1']) {
    assert.equal(readSnapshot({ v, t: 1, p: [] }).ok, false)
  }
})

test('gt 必须是字符串；快照头的 gt 坏了当空串', () => {
  const result = readSnapshot({ ...SNAPSHOT, gt: 42 })
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.gt, '')
  assert.equal(result.problems.length, 1)
})

test('快照版本高于当前时拒绝参与召回与写入，而不是清空', () => {
  const result = readSnapshot({ ...SNAPSHOT, v: SNAPSHOT_VERSION + 1 })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'upgrade-required')
  assert.equal(result.snapshot, null)
})

test('按编号在某份快照里找人：回退看到旧名，不剧透新名（ADR 0004）', () => {
  const earlier = { v: 1, t: 20, p: [['p7', 0, '老陈', '']] }
  const later = { v: 1, t: 50, p: [['p7', 0, '陈老板', '']] }
  assert.equal(findPerson(earlier, 'p7')[2], '老陈')
  assert.equal(findPerson(later, 'p7')[2], '陈老板')
  assert.equal(findPerson(earlier, 'p9'), null)
  assert.equal(findPerson(null, 'p7'), null)
})

test('字节数按 UTF-8 计', () => {
  assert.equal(byteSize('老陈'), 6)
  assert.equal(byteSize({ v: 1, t: 1, p: [] }),
    Buffer.byteLength(JSON.stringify({ v: 1, t: 1, p: [] }), 'utf8'))
})

test('读快照：没有就从空册开始（第一份快照得有人造出来）', () => {
  const born = readOrCreateSnapshot(null, 7, { gt: '永安三年·冬' })
  assert.equal(born.ok, true)
  assert.deepEqual(born.snapshot, { v: SNAPSHOT_VERSION, t: 7, p: [], gt: '永安三年·冬', loc: '', c: [], pt: [] })
  assert.equal(born.bootstrapped, true)
})

test('读快照：坏数据也当空册重来，不卡死', () => {
  for (const bad of [{}, { v: 1 }, { v: 1, t: 3, p: 'nope' }]) {
    const result = readOrCreateSnapshot(bad, 7, {})
    assert.equal(result.ok, true)
    assert.deepEqual(result.snapshot.p, [])
    assert.equal(result.bootstrapped, true)
  }
})

test('读快照：正常快照原样返回，不覆盖', () => {
  const raw = { v: 1, t: 7, gt: '永安三年·冬', p: [['p1', 1, '老陈', '']] }
  const result = readOrCreateSnapshot(raw, 7, {})
  assert.equal(result.bootstrapped, false)
  assert.equal(result.snapshot.p.length, 1)
})

test('快照头带「剧情发生地点」：跟 gt 一样是原文，拿不到就空串', () => {
  const withLoc = createSnapshot(40, '永安三年·冬', '临安·旧港·码头')
  assert.equal(withLoc.loc, '临安·旧港·码头')
  assert.equal(createSnapshot(40).loc, '', '没地点时应该是空串，不是 undefined')

  const parsed = readSnapshot({ v: 1, t: 40, gt: '永安三年·冬', loc: '临安·旧港·码头', p: [] })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.snapshot.loc, '临安·旧港·码头')

  // 脏数据当空串，不让整份快照作废
  const dirty = readSnapshot({ v: 1, t: 40, loc: 123, p: [] })
  assert.equal(dirty.ok, true)
  assert.equal(dirty.snapshot.loc, '')
})

// ── 回退（B1）：定位轮次要用酒馆当前状态 ──
// 整局数据里的 updatedTurn 回退时不会自己变小；getTurnState 给的是回退后的当前轮。
test('resolveTurn：回退后以酒馆当前轮次为准', () => {
  assert.equal(resolveTurn({ updatedTurn: 5, turnState: { turn: 3 } }), 3)
})

test('resolveTurn：没有 turnState（旧宿主）回落 updatedTurn', () => {
  assert.equal(resolveTurn({ updatedTurn: 5, turnState: null }), 5)
})

test('resolveTurn：都没有 → null', () => {
  assert.equal(resolveTurn({ updatedTurn: null, turnState: null }), null)
  assert.equal(resolveTurn({}), null)
})

test('resolveTurn：turnState.turn 非法 → 回落 updatedTurn', () => {
  assert.equal(resolveTurn({ updatedTurn: 5, turnState: { turn: 0 } }), 5)
  assert.equal(resolveTurn({ updatedTurn: 5, turnState: { turn: -1 } }), 5)
  assert.equal(resolveTurn({ updatedTurn: 5, turnState: { turn: 2.5 } }), 5)
  assert.equal(resolveTurn({ updatedTurn: 5, turnState: { turn: '3' } }), 5)
})
