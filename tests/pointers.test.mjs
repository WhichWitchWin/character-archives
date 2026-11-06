// 指针表：每个角色一份的「他对某条命题的态度」（ADR 0081 / 0083）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createPointers,
  addPointer,
  pointerOf,
  pointersOf,
  pointersTo,
  setEntry,
  hasSelf,
  selfEntry,
  dropPointer,
  touchPointer,
  conventionOf,
  CONVENTION,
  TRUTH,
  SELF,
} from '../plugin/lib/pointers.js'

test('新指针表是空数组', () => {
  assert.deepEqual(createPointers(), [])
})

test('addPointer 建一条空指针，状态组为空', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  assert.equal(pointers.length, 1)
  assert.equal(p[0], 'p7')
  assert.equal(p[1], 3)
  assert.deepEqual(p[2], [])
  assert.equal(p[3], 10)
})

test('addPointer 同一人同一命题不重复建，返回已有的', () => {
  const pointers = createPointers()
  const a = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  const b = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 12 })
  assert.equal(pointers.length, 1)
  assert.equal(a, b)
})

test('setEntry 加「自己」那组，永远排第一', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  setEntry(p, { state: TRUTH.TRUE, source: 'p9' })
  setEntry(p, { state: TRUTH.TRUE, source: SELF })
  assert.deepEqual(p[2][0], [TRUTH.TRUE, SELF])
})

test('setEntry 同来源再报一次是更新，不新增', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p9' })
  setEntry(p, { state: TRUTH.FALSE, source: 'p9' })
  assert.equal(p[2].length, 1)
  assert.deepEqual(p[2][0], [TRUTH.FALSE, 'p9'])
})

test('setEntry 不同来源各自独立', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  setEntry(p, { state: TRUTH.TRUE, source: SELF })
  setEntry(p, { state: TRUTH.FALSE, source: 'p9' })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p11' })
  assert.equal(p[2].length, 3)
})

test('别人组最多 3 组，超了丢最早的', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p1' })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p2' })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p3' })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p4' })
  const sources = p[2].map((entry) => entry[1])
  assert.equal(sources.length, 3)
  assert.equal(sources.includes('p1'), false)
  assert.deepEqual(sources, ['p2', 'p3', 'p4'])
})

test('「自己」那组不占别人的 3 组名额', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  setEntry(p, { state: TRUTH.TRUE, source: SELF })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p1' })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p2' })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p3' })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p4' })
  assert.equal(p[2].length, 4)
  assert.deepEqual(p[2][0], [TRUTH.TRUE, SELF])
})

test('hasSelf / selfEntry 判「自己」那组', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  assert.equal(hasSelf(p), false)
  assert.equal(selfEntry(p), null)
  setEntry(p, { state: TRUTH.FALSE, source: SELF })
  assert.equal(hasSelf(p), true)
  assert.deepEqual(selfEntry(p), [TRUTH.FALSE, SELF])
})

test('pointerOf 找不到返回 null', () => {
  const pointers = createPointers()
  addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  assert.ok(pointerOf(pointers, 'p7', 3))
  assert.equal(pointerOf(pointers, 'p7', 4), null)
  assert.equal(pointerOf(pointers, 'p12', 3), null)
})

test('pointersOf 按人物筛', () => {
  const pointers = createPointers()
  addPointer(pointers, { personId: 'p7', claimId: 1, turn: 10 })
  addPointer(pointers, { personId: 'p7', claimId: 2, turn: 10 })
  addPointer(pointers, { personId: 'p12', claimId: 1, turn: 10 })
  assert.equal(pointersOf(pointers, 'p7').length, 2)
})

test('pointersTo 按命题筛', () => {
  const pointers = createPointers()
  addPointer(pointers, { personId: 'p7', claimId: 1, turn: 10 })
  addPointer(pointers, { personId: 'p12', claimId: 1, turn: 10 })
  addPointer(pointers, { personId: 'p7', claimId: 2, turn: 10 })
  assert.equal(pointersTo(pointers, 1).length, 2)
})

test('dropPointer 删掉整条', () => {
  const pointers = createPointers()
  addPointer(pointers, { personId: 'p7', claimId: 1, turn: 10 })
  assert.equal(dropPointer(pointers, 'p7', 1), true)
  assert.equal(pointers.length, 0)
})

test('dropPointer 找不到返回 false', () => {
  const pointers = createPointers()
  assert.equal(dropPointer(pointers, 'p7', 1), false)
})

test('addPointer 拒绝空人物 / 非整数命题 id', () => {
  const pointers = createPointers()
  assert.equal(addPointer(pointers, { personId: '', claimId: 1, turn: 1 }), null)
  assert.equal(addPointer(pointers, { personId: 'p7', claimId: 'x', turn: 1 }), null)
  assert.equal(pointers.length, 0)
})

test('setEntry 拒绝非法状态', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  assert.equal(setEntry(p, { state: 9, source: SELF }), null)
  assert.equal(p[2].length, 0)
})

// ── 来源组带游戏时间（ADR 0086）──

test('setEntry：给了 gt 就写成三格；同来源再写会刷新时间', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  assert.deepEqual(setEntry(p, { state: TRUTH.TRUE, source: SELF, gt: '三年五月' }), [TRUTH.TRUE, SELF, '三年五月'])
  assert.deepEqual(setEntry(p, { state: TRUTH.UNKNOWN, source: SELF, gt: '三年六月' }), [TRUTH.UNKNOWN, SELF, '三年六月'])
  assert.equal(p[2].length, 1, '自己那组只有一条')
})

test('setEntry：没给 gt 就还是两格（非 MVU 卡）', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  assert.deepEqual(setEntry(p, { state: TRUTH.TRUE, source: 'p8' }), [TRUTH.TRUE, 'p8'])
})

// ── 最后变动轮（ADR 0086）──

test('touchPointer：第 4 格推到当前轮，非法入参不动', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  assert.equal(touchPointer(p, 25), true)
  assert.equal(p[3], 25)
  assert.equal(touchPointer(p, -1), false)
  assert.equal(p[3], 25)
})

// ── 约定状态跟着来源组走（ADR 0087）──

test('约定状态：跟着来源组一起写，能读出来', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  const group = setEntry(p, { state: TRUTH.TRUE, source: SELF, gt: '三年五月', convention: CONVENTION.DONE })
  assert.deepEqual(group, [TRUTH.TRUE, SELF, '三年五月', CONVENTION.DONE])
  assert.equal(conventionOf(group), CONVENTION.DONE)
  assert.equal(conventionOf([TRUTH.TRUE, SELF]), null, '没有这一格时读 null')
})

test('约定状态：没有 gt 时第 3 格用空串占位，第 4 格才是状态', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  const group = setEntry(p, { state: TRUTH.TRUE, source: SELF, convention: CONVENTION.PENDING })
  assert.deepEqual(group, [TRUTH.TRUE, SELF, '', CONVENTION.PENDING])
})

test('约定状态：非法值不写（退化成普通两组）', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  const group = setEntry(p, { state: TRUTH.TRUE, source: SELF, convention: 9 })
  assert.deepEqual(group, [TRUTH.TRUE, SELF])
})

// ── 别人组上限走设置（P20：cognition.maxOtherSources）──
// 写死 3 的时候，玩家既不能收紧（省字数）也不能放宽（多留一个来源）。
// 现在上限由设置传进来；**不传时行为跟以前完全一样**（默认 3）。

test('别人组上限可传：传 1 只留最新那一组', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p1', maxOtherSources: 1 })
  setEntry(p, { state: TRUTH.UNKNOWN, source: 'p2', maxOtherSources: 1 })
  assert.deepEqual(p[2].map((entry) => entry[1]), ['p2'])
})

test('别人组上限可传：传 5 能挂住 5 组', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  for (const source of ['p1', 'p2', 'p3', 'p4', 'p5']) {
    setEntry(p, { state: TRUTH.UNKNOWN, source, maxOtherSources: 5 })
  }
  assert.deepEqual(p[2].map((entry) => entry[1]), ['p1', 'p2', 'p3', 'p4', 'p5'])
})

test('上限放宽后「自己」那组仍永远第 0 位，且不占别人名额', () => {
  const pointers = createPointers()
  const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
  setEntry(p, { state: TRUTH.TRUE, source: SELF, maxOtherSources: 5 })
  for (const source of ['p1', 'p2', 'p3', 'p4', 'p5']) {
    setEntry(p, { state: TRUTH.UNKNOWN, source, maxOtherSources: 5 })
  }
  assert.equal(p[2].length, 6)
  assert.deepEqual(p[2][0], [TRUTH.TRUE, SELF])
})

test('上限传得不合法（0／负数／小数／不是数字）时按默认 3 处理', () => {
  for (const bad of [0, -1, 2.5, '5', null, undefined]) {
    const pointers = createPointers()
    const p = addPointer(pointers, { personId: 'p7', claimId: 3, turn: 10 })
    for (const source of ['p1', 'p2', 'p3', 'p4']) {
      setEntry(p, { state: TRUTH.UNKNOWN, source, maxOtherSources: bad })
    }
    assert.equal(p[2].length, 3, `maxOtherSources=${String(bad)} 应按默认 3 处理`)
  }
})

