// 在场名单（anchors）与暂存批（pending）—— ADR 0005
// 两者都放整局数据；这里只做纯逻辑，不碰酒馆接口。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addPendingBatch,
  createAnchors,
  createPending,
  dropAnchor,
  dropPending,
  getAnchor,
  isPendingExhausted,
  markPendingFailed,
  setAnchor,
} from '../plugin/lib/gametime.js'
import { GT } from './fixtures/sample.mjs'

test('在场名单：记下人物最后一次出现的轮次与当时的 gt', () => {
  let anchors = createAnchors()
  anchors = setAnchor(anchors, 'p7', 20, GT)
  assert.deepEqual(getAnchor(anchors, 'p7'), { turn: 20, gt: GT })
})

test('在场名单：同一人物再次出现时覆盖，不新增', () => {
  let anchors = setAnchor(setAnchor(createAnchors(), 'p7', 20, GT), 'p7', 24, '三年五月二十')
  assert.deepEqual(Object.keys(anchors), ['p7'])
  assert.deepEqual(getAnchor(anchors, 'p7'), { turn: 24, gt: '三年五月二十' })
})

test('在场名单：是纯函数，不改原对象；取不到返回 null；可单独删除', () => {
  const original = createAnchors()
  setAnchor(original, 'p7', 20, GT)
  assert.deepEqual(original, {})

  assert.equal(getAnchor(original, 'p9'), null)
  assert.equal(getAnchor(undefined, 'p7'), null)

  const removed = dropAnchor(setAnchor(createAnchors(), 'p7', 20, GT), 'p7')
  assert.deepEqual(removed, {})
})

test('暂存批：同一轮的所有值共享一条 gt', () => {
  const pending = addPendingBatch(createPending(), {
    turn: 20,
    gt: GT,
    reason: 'mvu-rescue',
    values: [['p1', 'a', '旧港', '6'], ['p1', 'b', '受伤', '7'], ['p2', 'a', '在店里', '6']],
  })
  assert.equal(pending.length, 1)
  assert.equal(pending[0].gt, GT)
  assert.equal(pending[0].values.length, 3)
  assert.equal(pending[0].fails, 0)
  assert.equal(createPending().length, 0)
})

test('暂存批：新的一批追加在后面，互不影响', () => {
  let pending = addPendingBatch(createPending(), { turn: 20, gt: GT, reason: 'mvu-rescue', values: [] })
  pending = addPendingBatch(pending, { turn: 21, gt: '三年五月十三日', reason: 'fuzzy-exit', values: [] })
  assert.deepEqual(pending.map((batch) => batch.turn), [20, 21])
})

test('暂存批：写入失败累加次数，到 7 轮算耗尽', () => {
  let [batch] = addPendingBatch(createPending(), { turn: 20, gt: GT, reason: 'mvu-rescue', values: [] })
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    batch = markPendingFailed(batch)
    assert.equal(isPendingExhausted(batch), false)
  }
  batch = markPendingFailed(batch)
  assert.equal(batch.fails, 7)
  assert.equal(isPendingExhausted(batch), true)
})

test('暂存批：写入成功或作废后按轮次删除', () => {
  const pending = addPendingBatch(
    addPendingBatch(createPending(), { turn: 20, gt: GT, reason: 'mvu-rescue', values: [] }),
    { turn: 21, gt: '三年五月十三日', reason: 'fuzzy-exit', values: [] },
  )
  assert.deepEqual(dropPending(pending, 20).map((batch) => batch.turn), [21])
  assert.deepEqual(dropPending(pending, 99).map((batch) => batch.turn), [20, 21])
})
