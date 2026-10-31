// 快照结构（设计稿 §4.1 总体与字段、§4.8 版本与迁移策略）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

import {
  SNAPSHOT_VERSION,
  STATUS,
  byteSize,
  createEntry,
  createPerson,
  createSnapshot,
  findPerson,
  readSnapshot,
} from '../plugin/lib/snapshot.js'

const LEGAL = {
  v: 1,
  t: 40,
  // ["编号", 状态, 姓名, 条目数组, 召回词串]，条目 = ["条目码", 值, 信度位, 轮次]
  p: [['p7', 1, '老陈', [['a', 3, '6', 25]], '陈先生,老陈头']],
}

const withEntries = (entries) => ({ v: 1, t: 1, p: [['p1', 0, '甲', entries, '']] })

test('空快照的形状是 v/t/p', () => {
  assert.deepEqual(createSnapshot(40), { v: SNAPSHOT_VERSION, t: 40, p: [] })
})

test('人物是 5 元素数组：编号、状态、姓名、条目、召回词', () => {
  assert.deepEqual(createPerson('p7', STATUS.PRESENT, '老陈'), ['p7', 1, '老陈', [], ''])
})

test('条目是 4 元素数组：条目码、值、信度位、轮次', () => {
  assert.deepEqual(createEntry('a', 'A地', '6', 25), ['a', 'A地', '6', 25])
})

test('状态码 0～3 与设计稿一致', () => {
  assert.deepEqual(STATUS, { OFFLINE: 0, PRESENT: 1, MVU_OFFLINE: 2, MVU_PRESENT: 3 })
})

test('合法快照原样通过，没有 problems', () => {
  const result = readSnapshot(LEGAL)
  assert.equal(result.ok, true)
  assert.deepEqual(result.snapshot, LEGAL)
  assert.deepEqual(result.problems, [])
})

test('读回来的是深拷贝，改它不影响原对象', () => {
  const result = readSnapshot(LEGAL)
  result.snapshot.p[0][3].push(['b', '新值', '6', 26])
  assert.equal(LEGAL.p[0][3].length, 1)
})

test('条目值可以是原文（字符串）也可以是字典下标（数字）', () => {
  const raw = withEntries([['a', 'A地', '6', 2], ['a', 3, 'r42+', 2]])
  assert.equal(readSnapshot(raw).ok, true)
})

test('容忍末尾多出来的字段（只加不改）', () => {
  const raw = {
    v: 1,
    t: 5,
    p: [['p1', 0, '甲', [], '', '未来才有的字段']],
    extra: '未来才有的顶层字段',
  }
  const result = readSnapshot(raw)
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.p[0].length, 6)
})

test('结构根本不对才整份拒绝', () => {
  for (const raw of [null, undefined, 'x', 42, [], {}, { v: 1 }, { v: 1, t: 1, p: 'x' }]) {
    const result = readSnapshot(raw)
    assert.equal(result.ok, false, `应拒绝：${JSON.stringify(raw)}`)
    assert.equal(typeof result.reason, 'string')
  }
})

test('结构版本 v 必须是正整数', () => {
  for (const v of [NaN, 1.5, -1, '1', null]) {
    assert.equal(readSnapshot({ v, t: 1, p: [] }).ok, false, `应拒绝 v：${v}`)
  }
})

test('坏人物只丢那一个，不报废整份快照', () => {
  const raw = { v: 1, t: 1, p: [['p1', 0, '甲', [], ''], ['p2', 9, '乙', [], '']] }
  const result = readSnapshot(raw)
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.p.length, 1)
  assert.equal(result.problems.length, 1)
})

test('坏条目只丢那一条，其余条目保住', () => {
  const raw = withEntries([['a', '好值', '6', 1], ['b', null, '6', 1]])
  const result = readSnapshot(raw)
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.p[0][3].length, 1)
  assert.equal(result.snapshot.p[0][3][0][1], '好值')
  assert.equal(result.problems.length, 1)
})

test('条目码不是字符串、信度位不是字符串的条目被丢掉', () => {
  assert.equal(readSnapshot(withEntries([[7, 'A地', '6', 1]])).snapshot.p[0][3].length, 0)
  assert.equal(readSnapshot(withEntries([['a', 'A地', 6, 1]])).snapshot.p[0][3].length, 0)
})

test('字典下标必须是安全的非负整数', () => {
  for (const value of [-1, 3.5, NaN, Infinity]) {
    const result = readSnapshot(withEntries([['a', value, '6', 1]]))
    assert.equal(result.snapshot.p[0][3].length, 0, `应拒绝下标：${value}`)
  }
  assert.equal(readSnapshot(withEntries([['a', 0, '6', 1]])).snapshot.p[0][3].length, 1)
})

test('快照版本高于当前时拒绝参与召回与写入，而不是清空', () => {
  const result = readSnapshot({ ...LEGAL, v: SNAPSHOT_VERSION + 1 })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'upgrade-required')
  assert.equal(result.snapshot, null)
})

test('字节数按 UTF-8 计（64 KB 上限用的就是这个数）', () => {
  assert.equal(byteSize('老陈'), 6)
  assert.equal(byteSize({ v: 1, t: 1, p: [['p1', 0, '甲', [], '']] }),
    Buffer.byteLength(JSON.stringify({ v: 1, t: 1, p: [['p1', 0, '甲', [], '']] }), 'utf8'))
})

test('按编号在某份快照里找人：回退看到旧名，不剧透新名（ADR 0004）', () => {
  const earlier = { v: 1, t: 20, p: [['p7', 0, '老陈', [], '']] }
  const later = { v: 1, t: 50, p: [['p7', 0, '陈老板', [], '']] }
  assert.equal(findPerson(earlier, 'p7')[2], '老陈')
  assert.equal(findPerson(later, 'p7')[2], '陈老板')
  assert.equal(findPerson(earlier, 'p9'), null)   // 还没建档
  assert.equal(findPerson(null, 'p7'), null)
})

test('信度位语法不合法的条目会被丢掉并记进 problems', () => {
  const result = readSnapshot(withEntries([['a', '好值', 'r42', 1]]))
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.p[0][3].length, 0)
  assert.equal(result.problems.length, 1)
})
