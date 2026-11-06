// 已删除名单（ADR 0066）
//
// 玩家**手动**删掉的人：程序据此拒绝模型重建，面板据此给「恢复 / 永久删除」。
//
// 为什么不靠"模型自觉别重建"：玩家删人是明确意图，得说了算。
// 只从快照里拿掉的话，下一轮正文里他还在 → 判定又会报建档 → 人就回来了。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deletedNamesOf, filterDeletedPersonActions, splitPersons, idSet } from '../plugin/lib/deleted.js'

test('deletedNamesOf：姓名、别名、称呼都算，去空去重', () => {
  const set = deletedNamesOf([
    { name: '老陈', aliases: ['陈账房'], call: '陈哥' },
    { name: '沈九', aliases: ['九爷', ''] },
    { name: '' },
    null,
  ])
  assert.deepEqual([...set].sort(), ['九爷', '沈九', '老陈', '陈哥', '陈账房'].sort())
})

test('判定动作：被删过的人不再允许建档', () => {
  const { kept, blocked } = filterDeletedPersonActions(
    [
      { 动作: '建档', 姓名: '老陈', 状态: '在场' },
      { 动作: '建档', 姓名: '林昭', 状态: '在场' },
      { 动作: '模糊建档', 姓名: '陈账房' },
      { 动作: '改状态', 人物: '老陈', 状态: '离场' },
    ],
    [{ name: '老陈', aliases: ['陈账房'] }],
  )
  assert.deepEqual(kept.map((item) => [item.动作, item.姓名 ?? item.人物]), [
    ['建档', '林昭'],
    ['改状态', '老陈'],
  ])
  assert.deepEqual(blocked.map((item) => item.姓名), ['老陈', '陈账房'])
})

test('判定动作：别名命中也算（模型用别名报建档）', () => {
  const { kept, blocked } = filterDeletedPersonActions(
    [{ 动作: '建档', 姓名: '陈账房' }],
    [{ name: '老陈', aliases: ['陈账房'] }],
  )
  assert.equal(kept.length, 0)
  assert.equal(blocked.length, 1)
})

test('判定动作：改状态不受名单影响（人删了就删了，改状态无意义但不该误伤别人）', () => {
  const { kept } = filterDeletedPersonActions(
    [{ 动作: '改状态', 人物: '老陈', 状态: '离场' }],
    [{ name: '老陈' }],
  )
  assert.equal(kept.length, 1)
})

test('名单为空 / 动作不是数组都不炸', () => {
  assert.deepEqual(filterDeletedPersonActions([{ 动作: '建档', 姓名: '甲' }], []).kept.length, 1)
  assert.deepEqual(filterDeletedPersonActions(null, null), { kept: [], blocked: [] })
})

test('建档记录：删下来的人要留全（姓名/别名/值/状态），恢复才补得回去', () => {
  const record = {
    id: 'p3',
    name: '老陈',
    aliases: ['陈账房'],
    call: '陈哥',
    status: 0,
    entries: [['a', '账房', '1', 3]],
    turn: 7,
    at: '2026-11-02T00:00:00.000Z',
  }
  const again = deletedNamesOf([record])
  assert.ok(again.has('老陈'))
  assert.ok(again.has('陈账房'))
  assert.ok(again.has('陈哥'))
})

// 把人物从快照里挑出来（删人／恢复都要用）——抽成纯函数，好测，
// 也免得调用处再把 readSnapshotAt 的包装对象当成快照本身（B2 的根因）。
test('splitPersons：按编号挑出要移除的，剩下的原样保留', () => {
  const snapshot = {
    p: [
      ['p1', 1, '沈清禾'],
      ['p2', 0, '菜袋女人'],
      ['p3', 1, '老头'],
    ],
  }
  const { removed, kept } = splitPersons(snapshot, ['p2'])
  assert.deepEqual(removed.map((person) => person[2]), ['菜袋女人'])
  assert.deepEqual(kept.map((person) => person[2]), ['沈清禾', '老头'])
})

test('splitPersons：编号对不上时，一个都删不掉（不能悄悄把整本册子清空）', () => {
  const snapshot = { p: [['p1', 1, '沈清禾'], ['p2', 0, '菜袋女人']] }
  const { removed, kept } = splitPersons(snapshot, ['p9'])
  assert.equal(removed.length, 0)
  assert.equal(kept.length, 2, '一个都不能少')
})

test('splitPersons：快照里没有人（读错了）时也不能当成"全删了"', () => {
  const { removed, kept } = splitPersons({ p: [] }, ['p1'])
  assert.equal(removed.length, 0)
  assert.equal(kept.length, 0)
})

test('splitPersons：容忍各种脏输入', () => {
  assert.deepEqual(splitPersons(null, null), { removed: [], kept: [] })
  assert.deepEqual(splitPersons({ p: '不是数组' }, ['p1']), { removed: [], kept: [] })
  assert.deepEqual(splitPersons({ p: [['p1', 1, '甲']] }, 'p1').removed.length, 1, '单个编号也认')
})

// 回归：调用处传进来的是 **Set**，不是数组（B2 的第二个坑：
// `Array.isArray(Set)` 是 false → 整个 Set 被当成一个元素 → 谁都匹配不上）。
test('splitPersons：也要认 Set（调用处传的就是 Set）', () => {
  const snapshot = { p: [['p1', 1, '沈清禾'], ['p2', 0, '菜袋女人']] }
  const { removed, kept } = splitPersons(snapshot, new Set(['p2']))
  assert.deepEqual(removed.map((person) => person[2]), ['菜袋女人'])
  assert.deepEqual(kept.map((person) => person[2]), ['沈清禾'])
})

test('splitPersons：认 Set 时也不能把整个 Set 当一个元素', () => {
  const snapshot = { p: [['p1', 1, '甲'], ['p2', 0, '乙'], ['p3', 0, '丙']] }
  const { removed } = splitPersons(snapshot, new Set(['p1', 'p3']))
  assert.deepEqual(removed.map((person) => person[2]), ['甲', '丙'])
})

test('idSet：数组、Set、单个值都归一成 Set', () => {
  assert.deepEqual([...idSet(['p1', 'p2'])], ['p1', 'p2'])
  assert.deepEqual([...idSet(new Set(['p1', 'p2']))], ['p1', 'p2'])
  assert.deepEqual([...idSet('p1')], ['p1'])
  assert.deepEqual([...idSet(null)], [])
  assert.deepEqual([...idSet(['', null])], [], '空的要滤掉')
})
