// 离场记录（flags.left）—— ADR 0025
// 只在「在场 → 离场」那一刻写一条；在场的人不记，看状态就知道。
// 存整局数据；这里只做纯逻辑，不碰酒馆接口。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createLeft, dropLeft, getLeft, setLeft } from '../plugin/lib/gametime.js'
import { GT } from './fixtures/sample.mjs'

test('离场记录：记下离场那一刻的轮次与 gt', () => {
  const left = setLeft(createLeft(), 'p7', 12, GT)
  assert.deepEqual(getLeft(left, 'p7'), { turn: 12, gt: GT })
})

test('离场记录：没有 gt 也照记（注入时把「离场于 X」整段省略）', () => {
  const left = setLeft(createLeft(), 'p7', 12)
  assert.deepEqual(getLeft(left, 'p7'), { turn: 12, gt: '' })
})

test('离场记录：是纯函数，不改原对象；取不到返回 null；回场时清掉', () => {
  const original = createLeft()
  setLeft(original, 'p7', 12, GT)
  assert.deepEqual(original, {})

  assert.equal(getLeft(original, 'p9'), null)
  assert.equal(getLeft(undefined, 'p7'), null)

  const cleared = dropLeft(setLeft(createLeft(), 'p7', 12, GT), 'p7')
  assert.deepEqual(cleared, {})
})

test('离场记录：同一人再次离场时覆盖成新的一次，不新增条目', () => {
  let left = setLeft(createLeft(), 'p7', 12, GT)
  left = setLeft(left, 'p7', 40, '三年六月')
  assert.deepEqual(Object.keys(left), ['p7'])
  assert.deepEqual(getLeft(left, 'p7'), { turn: 40, gt: '三年六月' })
})

test('离场记录：脏数据取出来是 null，不抛错', () => {
  assert.equal(getLeft({ p7: null }, 'p7'), null)
  assert.equal(getLeft({ p7: 'oops' }, 'p7'), null)
})
