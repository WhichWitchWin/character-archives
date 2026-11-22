// 条目眼 / 值眼（M5-10、ADR 0114）：眼睛决定「念不念」，只管召回，不影响写入。
//
// 三层：人物 → 条目（栏目）→ 值（命题）。与锁同一套继承规则：**不允许子比父宽**。
// 与锁的区别是方向：锁＝不写、眼＝不念；两者正交，四种组合都合法（ADR 0037 的口径）。
//
// 存储（整局数据，不写快照）：
//   flags.hidden        = { p7: true }      人物眼（已有）
//   flags.hiddenEntries = { "p7:a": true }  条目眼
//   flags.hiddenClaims  = { "12": true }    值眼（命题 id）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  entryEyeKey,
  isPersonHidden,
  isEntryHidden,
  isClaimHidden,
  hiddenReasonFor,
  dropClaimHides,
} from '../plugin/lib/eyes.js'

const NONE = { hidden: {}, hiddenEntries: {}, hiddenClaims: {} }

test('条目眼的键是「人物:栏目码」', () => {
  assert.equal(entryEyeKey('p7', 'a'), 'p7:a')
})

test('什么都没闭：三层都不算隐藏', () => {
  assert.equal(isPersonHidden(NONE, 'p7'), false)
  assert.equal(isEntryHidden(NONE, { personId: 'p7', code: 'a' }), false)
  assert.equal(isClaimHidden(NONE, { claimId: 12 }), false)
  assert.equal(hiddenReasonFor(NONE, { personId: 'p7', code: 'a', claimId: 12 }), null)
})

test('条目眼只闭这一栏，别的栏与别人不受影响', () => {
  const flags = { ...NONE, hiddenEntries: { 'p7:a': true } }
  assert.equal(isEntryHidden(flags, { personId: 'p7', code: 'a' }), true)
  assert.equal(isEntryHidden(flags, { personId: 'p7', code: 'b' }), false)
  assert.equal(isEntryHidden(flags, { personId: 'p8', code: 'a' }), false)
})

test('值眼按命题 id 命中', () => {
  const flags = { ...NONE, hiddenClaims: { 12: true } }
  assert.equal(isClaimHidden(flags, { claimId: 12 }), true)
  assert.equal(isClaimHidden(flags, { claimId: 13 }), false)
})

test('父闭子闭：人物眼上时，他的条目与值都算隐藏', () => {
  const flags = { ...NONE, hidden: { p7: true } }
  assert.equal(isEntryHidden(flags, { personId: 'p7', code: 'a' }), true)
  assert.equal(isClaimHidden(flags, { claimId: 12, ownerId: 'p7' }), true)
  assert.equal(isEntryHidden(flags, { personId: 'p8', code: 'a' }), false)
})

test('眼因按最上层报：人物 > 条目 > 值', () => {
  const all = { hidden: { p7: true }, hiddenEntries: { 'p7:a': true }, hiddenClaims: { 12: true } }
  assert.equal(hiddenReasonFor(all, { personId: 'p7', code: 'a', claimId: 12 }), 'person')
  const entryOnly = { ...NONE, hiddenEntries: { 'p7:a': true }, hiddenClaims: { 12: true } }
  assert.equal(hiddenReasonFor(entryOnly, { personId: 'p7', code: 'a', claimId: 12 }), 'entry')
  const claimOnly = { ...NONE, hiddenClaims: { 12: true } }
  assert.equal(hiddenReasonFor(claimOnly, { personId: 'p7', code: 'a', claimId: 12 }), 'claim')
})

test('命题 id 会复用：删命题时值眼的号要一并清掉', () => {
  const { bucket, dropped } = dropClaimHides({ 12: true, 13: true }, [12])
  assert.equal(dropped, 1)
  assert.deepEqual(bucket, { 13: true })
  assert.deepEqual(dropClaimHides(undefined, [1]).bucket, {})
})

test('缺字段的老数据当作没闭眼（不炸）', () => {
  const bare = { hidden: { p7: true } }
  assert.equal(isEntryHidden(bare, { personId: 'p7', code: 'a' }), true)
  assert.equal(isClaimHidden(bare, { claimId: 12 }), false)
  assert.equal(hiddenReasonFor(undefined, { personId: 'p7', code: 'a' }), null)
})
