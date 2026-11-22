// 回退（B1）：整局数据里的 flags 带轮次的记录，回退后可能指向「未来的轮次」。
// 读数据时按当前轮次清掉，否则面板候选表、冷档、模糊离场会显示回退后才出现的东西。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pruneFutureFlags } from '../plugin/lib/rollback.js'

test('回退清理：seen / draft / fuzzyLeft 里超过当前轮的记录删掉', () => {
  const flags = {
    seen: { p1: 2, p2: 5, p3: 9 },
    draft: { 老陈: 3, 卖花的: 8 },
    fuzzyLeft: { p2: 7 },
  }
  const next = pruneFutureFlags({ flags, turn: 3 })
  assert.deepEqual(next.seen, { p1: 2 })
  assert.deepEqual(next.draft, { 老陈: 3 })
  assert.deepEqual(next.fuzzyLeft, {})
})

test('回退清理：离场记录里 turn 超过当前轮的删掉', () => {
  const flags = { left: { p1: { turn: 2, gt: '昨天' }, p2: { turn: 6, gt: '明天' } } }
  const next = pruneFutureFlags({ flags, turn: 3 })
  assert.deepEqual(next.left, { p1: { turn: 2, gt: '昨天' } })
})

test('回退清理：主角回场标记超过当前轮的清掉', () => {
  const flags = { playerBack: { turn: 8, gt: '明天' } }
  assert.deepEqual(pruneFutureFlags({ flags, turn: 3 }), {})
})

test('回退清理：当前轮拿不到（null）时原样返回', () => {
  const flags = { seen: { p1: 9 } }
  assert.deepEqual(pruneFutureFlags({ flags, turn: null }), flags)
})

test('回退清理：不修改原对象', () => {
  const flags = { seen: { p1: 9 } }
  const next = pruneFutureFlags({ flags, turn: 3 })
  assert.deepEqual(flags.seen, { p1: 9 }, '原对象不许被改')
  assert.notEqual(next, flags)
})

// 手动豁免标记带轮次（ADR 0118）：回退到第 5 轮后，第 12 轮打的标记指向的
// 「第 12 轮那条指针」已经不存在；而命题号是「最大 +1」会复用，残留标记会让
// 一条本该冷却的新认知被误豁免一次。
test('回退清理：未来打的手动豁免标记要丢掉', () => {
  const flags = { manualFree: { 'pt:p1:9': 12, 'pt:p1:3': 4 } }
  const next = pruneFutureFlags({ flags, turn: 5 })
  assert.deepEqual(Object.keys(next.manualFree), ['pt:p1:3'], '只留当前轮及以前的')
})

test('回退清理：豁免标记是旧的布尔值（没带轮次）时也留着', () => {
  const flags = { manualFree: { 'pt:p1:9': true } }
  assert.deepEqual(pruneFutureFlags({ flags, turn: 5 }).manualFree, { 'pt:p1:9': true })
})
