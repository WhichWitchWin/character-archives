// 快照结构（设计稿 §4.1 字段、§4.8 版本与迁移、ADR 0005 的 gt）
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
import { createDictionary, openDictionary } from '../plugin/lib/dictionary.js'
import { DICT_RAW, GT, SNAPSHOT } from './fixtures/sample.mjs'

const withEntries = (entries) => ({ v: 1, t: 1, p: [['p1', 0, '甲', entries, '']] })

test('空快照带 gt（默认空串）', () => {
  assert.deepEqual(createSnapshot(40), { v: SNAPSHOT_VERSION, t: 40, p: [], gt: '' })
  assert.deepEqual(createSnapshot(40, GT), { v: SNAPSHOT_VERSION, t: 40, p: [], gt: GT })
})

test('人物是 5 元素数组，条目是 4 元素（有 gt 才 5 元素）', () => {
  assert.deepEqual(createPerson('p7', STATUS.PRESENT, '老陈'), ['p7', 1, '老陈', [], ''])
  assert.deepEqual(createEntry('a', 'A地', '6', 25), ['a', 'A地', '6', 25])
  assert.deepEqual(createEntry('a', 'A地', '6', 25, GT), ['a', 'A地', '6', 25, GT])
})

test('覆盖一条值 = 整条重建，gt 不会被继承（ADR 0005）', () => {
  const old = createEntry('a', '旧值', '6', 10, GT)
  assert.equal(old.length, 5)
  const replaced = createEntry('a', '新值', '6', 20)
  assert.equal(replaced.length, 4)
})

test('合法快照原样通过，没有 problems', () => {
  const result = readSnapshot(SNAPSHOT)
  assert.equal(result.ok, true)
  assert.deepEqual(result.snapshot, SNAPSHOT)
  assert.deepEqual(result.problems, [])
})

test('读回来的是深拷贝', () => {
  const result = readSnapshot(SNAPSHOT)
  result.snapshot.p[0][3].push(['x', '新值', '6', 26])
  assert.equal(SNAPSHOT.p[0][3].length, 2)
})

test('结构根本不对才整份拒绝；v 必须是正整数', () => {
  for (const raw of [null, undefined, 'x', 42, [], {}, { v: 1 }, { v: 1, t: 1, p: 'x' }]) {
    assert.equal(readSnapshot(raw).ok, false, `应拒绝：${JSON.stringify(raw)}`)
  }
  for (const v of [NaN, 1.5, -1, '1']) {
    assert.equal(readSnapshot({ v, t: 1, p: [] }).ok, false)
  }
})

test('坏人物、坏条目只丢那一个，其余保住', () => {
  const raw = {
    v: 1,
    t: 1,
    p: [['p1', 0, '甲', [['a', '好值', '6', 1], ['b', null, '6', 1]], ''], ['p2', 9, '乙', [], '']],
  }
  const result = readSnapshot(raw)
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.p.length, 1)
  assert.equal(result.snapshot.p[0][3].length, 1)
  assert.equal(result.problems.length, 2)
})

test('字典下标必须是非负安全整数', () => {
  for (const value of [-1, 3.5, NaN, Infinity]) {
    assert.equal(readSnapshot(withEntries([['a', value, '6', 1]])).snapshot.p[0][3].length, 0)
  }
})

test('带字典校验时：下标越界或字典为空一律甩掉', () => {
  const dict = openDictionary(DICT_RAW)
  assert.equal(readSnapshot(withEntries([['a', 0, '6', 1]]), { dict }).snapshot.p[0][3].length, 1)
  assert.equal(readSnapshot(withEntries([['a', 5, '6', 1]]), { dict }).snapshot.p[0][3].length, 0)

  const empty = openDictionary(createDictionary())
  const result = readSnapshot(withEntries([['a', 0, '6', 1]]), { dict: empty })
  assert.equal(result.snapshot.p[0][3].length, 0)
  assert.equal(result.problems.length, 1)
})

test('gt 必须是字符串，否则丢掉该值；快照头的 gt 坏了当空串', () => {
  assert.equal(readSnapshot(withEntries([['a', '值', '6', 1, 42]])).snapshot.p[0][3].length, 0)

  const result = readSnapshot({ ...SNAPSHOT, gt: 42 })
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.gt, '')
  assert.equal(result.problems.length, 1)
})

test('信度位语法不合法的条目被丢掉并记进 problems', () => {
  const result = readSnapshot(withEntries([['a', '好值', 'r42', 1]]))
  assert.equal(result.snapshot.p[0][3].length, 0)
  assert.equal(result.problems.length, 1)
})

test('快照版本高于当前时拒绝参与召回与写入，而不是清空', () => {
  const result = readSnapshot({ ...SNAPSHOT, v: SNAPSHOT_VERSION + 1 })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'upgrade-required')
  assert.equal(result.snapshot, null)
})

test('按编号在某份快照里找人：回退看到旧名，不剧透新名（ADR 0004）', () => {
  const earlier = { v: 1, t: 20, p: [['p7', 0, '老陈', [], '']] }
  const later = { v: 1, t: 50, p: [['p7', 0, '陈老板', [], '']] }
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
