// 条目锁 / 值锁（ROADMAP M5-6、ADR 0037 / 0038）
//
// 三层：人物 → 条目（栏目）→ 值（命题）。锁只管**写入**，召回照常。
// 关键规则：**不允许「子比父宽」**——人物锁上时，他下面的条目与值一律算锁住。
// 为什么：否则面板会出现「人物锁着、某个条目显示未锁」，玩家以为能改、实际不能。
//
// 存储（都在整局数据里，不回退、不写快照）：
//   flags.lock        = { p7: true }        人物锁（已有）
//   flags.lockEntries = { "p7:a": true }    条目锁
//   flags.lockClaims  = { 12: true }        值锁（命题 id，全局唯一一份）
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  entryLockKey,
  isPersonLocked,
  isEntryLocked,
  isClaimLocked,
  lockReasonFor,
  toggleFlag,
} from '../plugin/lib/locks.js'

const NONE = { lock: {}, lockEntries: {}, lockClaims: {} }

test('条目锁的键是「人物:栏目码」', () => {
  assert.equal(entryLockKey('p7', 'a'), 'p7:a')
})

test('什么都没锁：三层都不算锁住', () => {
  assert.equal(isPersonLocked(NONE, 'p7'), false)
  assert.equal(isEntryLocked(NONE, { personId: 'p7', code: 'a' }), false)
  assert.equal(isClaimLocked(NONE, { claimId: 12, ownerId: 'p7' }), false)
  assert.equal(lockReasonFor(NONE, { personId: 'p7', code: 'a', claimId: 12 }), null)
})

test('条目锁只锁这一栏，同一人的别的栏不受影响', () => {
  const locks = { ...NONE, lockEntries: { 'p7:a': true } }
  assert.equal(isEntryLocked(locks, { personId: 'p7', code: 'a' }), true)
  assert.equal(isEntryLocked(locks, { personId: 'p7', code: 'b' }), false)
  assert.equal(isEntryLocked(locks, { personId: 'p8', code: 'a' }), false)
})

test('值锁按命题 id 命中，与是谁的命题无关', () => {
  const locks = { ...NONE, lockClaims: { 12: true } }
  assert.equal(isClaimLocked(locks, { claimId: 12, ownerId: 'p7' }), true)
  assert.equal(isClaimLocked(locks, { claimId: 13, ownerId: 'p7' }), false)
})

test('父锁压子：人物锁上时，他的条目与值都算锁住（不允许子比父宽）', () => {
  const locks = { ...NONE, lock: { p7: true } }
  assert.equal(isEntryLocked(locks, { personId: 'p7', code: 'a' }), true)
  assert.equal(isClaimLocked(locks, { claimId: 12, ownerId: 'p7' }), true)
  // 别人不受影响
  assert.equal(isEntryLocked(locks, { personId: 'p8', code: 'a' }), false)
})

test('父锁压子：即使条目/值没单独锁，也报「随人物锁」', () => {
  const locks = { ...NONE, lock: { p7: true } }
  assert.equal(lockReasonFor(locks, { personId: 'p7', code: 'a', claimId: 12 }), 'person')
})

test('锁因按「最上层」报：人物 > 条目 > 值', () => {
  const locks = { lock: { p7: true }, lockEntries: { 'p7:a': true }, lockClaims: { 12: true } }
  assert.equal(lockReasonFor(locks, { personId: 'p7', code: 'a', claimId: 12 }), 'person')
  const entryOnly = { ...NONE, lockEntries: { 'p7:a': true }, lockClaims: { 12: true } }
  assert.equal(lockReasonFor(entryOnly, { personId: 'p7', code: 'a', claimId: 12 }), 'entry')
  const claimOnly = { ...NONE, lockClaims: { 12: true } }
  assert.equal(lockReasonFor(claimOnly, { personId: 'p7', code: 'a', claimId: 12 }), 'claim')
})

test('切换：没有就加、有就删（返回切换后的状态）', () => {
  const bucket = {}
  assert.equal(toggleFlag(bucket, 'p7:a'), true)
  assert.equal(bucket['p7:a'], true)
  assert.equal(toggleFlag(bucket, 'p7:a'), false)
  assert.equal('p7:a' in bucket, false)
})

test('缺字段的老整局数据当作没锁（不炸）', () => {
  const bare = { lock: { p7: true } }
  assert.equal(isEntryLocked(bare, { personId: 'p7', code: 'a' }), true)
  assert.equal(isClaimLocked(bare, { claimId: 12, ownerId: 'p8' }), false)
  assert.equal(lockReasonFor(undefined, { personId: 'p7', code: 'a', claimId: 12 }), null)
})
