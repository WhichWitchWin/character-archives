// 模糊离场 + 最后确认轮次（ADR 0030 / 0039）：救活模糊离场与面板「冷档」。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fuzzyLeaveIds, markSeen } from '../plugin/lib/fuzzy.js'
import { STATUS } from '../plugin/lib/snapshot.js'

const P = (id, status, name = '某人') => [id, status, name, [], '']

test('markSeen：本轮在场或被提到的人刷新到当前轮，不动别人', () => {
  const seen = { p1: 3, p2: 5 }
  const next = markSeen(seen, ['p1', 'p3'], 10)
  assert.deepEqual(next, { p1: 10, p2: 5, p3: 10 })
  assert.deepEqual(seen, { p1: 3, p2: 5 }, '不改原对象')
})

test('fuzzyLeaveIds：连续 N 轮没出现、这轮又不在场上 → 判离场', () => {
  const persons = [P('p1', STATUS.PRESENT), P('p2', STATUS.PRESENT), P('p3', STATUS.OFFLINE)]
  const seen = { p1: 10, p2: 5, p3: 1 }
  const ids = fuzzyLeaveIds(persons, { seen, presentIds: new Set(['p1']), turn: 10, turns: 3 })
  assert.deepEqual(ids, ['p2'], 'p1 这轮在场；p3 本来就不在场；p2 连续 5 轮没出现')
})

test('fuzzyLeaveIds：没有 seen 基准的人不判（刚建档会被误伤）', () => {
  const persons = [P('p1', STATUS.PRESENT)]
  const ids = fuzzyLeaveIds(persons, { seen: {}, presentIds: new Set(), turn: 10, turns: 3 })
  assert.deepEqual(ids, [])
})

test('fuzzyLeaveIds：轮数 0 等于关掉判定', () => {
  const persons = [P('p1', STATUS.PRESENT)]
  const ids = fuzzyLeaveIds(persons, { seen: { p1: 1 }, presentIds: new Set(), turn: 10, turns: 0 })
  assert.deepEqual(ids, [])
})

test('fuzzyLeaveIds：还没数够轮数就不判', () => {
  const persons = [P('p1', STATUS.PRESENT)]
  const ids = fuzzyLeaveIds(persons, { seen: { p1: 8 }, presentIds: new Set(), turn: 10, turns: 3 })
  assert.deepEqual(ids, [], '只差 2 轮')
})
