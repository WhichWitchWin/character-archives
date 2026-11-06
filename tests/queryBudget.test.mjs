// 正文模型查档案的次数上限（2026-11-06）
//
// 起因：`archive_query` 不限次数，模型一轮能连查十几次，把上下文预算吃光。
// 定死每轮 2 次，账本按「局 + 轮」记，换轮自动清零。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MAX_QUERY_PER_TURN, createQueryCounter } from '../plugin/lib/queryBudget.js'

test('默认每轮 2 次', () => {
  assert.equal(MAX_QUERY_PER_TURN, 2)
})

test('同一轮：前 2 次给，第 3 次拒', () => {
  const counter = createQueryCounter()
  assert.equal(counter.take('g1', 5), true)
  assert.equal(counter.take('g1', 5), true)
  assert.equal(counter.take('g1', 5), false, '第 3 次该拒')
  assert.equal(counter.used('g1', 5), 2, '被拒的那次不记账')
})

test('轮次一变就清零', () => {
  const counter = createQueryCounter()
  counter.take('g1', 5)
  counter.take('g1', 5)
  assert.equal(counter.take('g1', 5), false)
  assert.equal(counter.take('g1', 6), true, '下一轮重新有 2 次')
  assert.equal(counter.used('g1', 6), 1)
  assert.equal(counter.used('g1', 5), 0, '旧轮次查不到')
})

test('不同局各记各的，互不影响', () => {
  const counter = createQueryCounter()
  assert.equal(counter.take('g1', 3), true)
  assert.equal(counter.take('g1', 3), true)
  assert.equal(counter.take('g2', 3), true, '另一局不受影响')
})

test('没有局号就当拒（查不到档案，也不该占名额以外的逻辑）', () => {
  const counter = createQueryCounter()
  assert.equal(counter.take('', 1), false)
  assert.equal(counter.take(null, 1), false)
})

test('轮次认不出（null/undefined）按 0 算，不会每次都当成新轮', () => {
  const counter = createQueryCounter()
  assert.equal(counter.take('g1', undefined), true)
  assert.equal(counter.take('g1', null), true)
  assert.equal(counter.take('g1', undefined), false, '认不出轮次时仍要限住')
})

test('上限可以调（但非法值回落 2）', () => {
  const one = createQueryCounter(1)
  assert.equal(one.take('g1', 1), true)
  assert.equal(one.take('g1', 1), false)
  const broken = createQueryCounter(0)
  assert.equal(broken.limit, 2, '0 不是合法上限，回落到 2')
})
