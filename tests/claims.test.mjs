// 命题表：全局一份的「有人提过 / 有人信过的一句话」（ADR 0081 / 0083）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createClaims,
  addClaim,
  claimsOf,
  findClaim,
  findClaimLoose,
  claimById,
  dropClaim,
  pruneOrphanClaims,
} from '../plugin/lib/claims.js'

test('新命题表是空数组', () => {
  assert.deepEqual(createClaims(), [])
})

test('addClaim 追加一条命题，id 从 1 开始自增', () => {
  const claims = createClaims()
  const a = addClaim(claims, { personId: 'p7', code: 'a', text: '在旧港', turn: 5 })
  const b = addClaim(claims, { personId: 'p7', code: 'a', text: '在仓库', turn: 8 })
  assert.equal(claims.length, 2)
  assert.equal(a[0], 1)
  assert.equal(b[0], 2)
  assert.equal(a[1], 'p7')
  assert.equal(a[2], 'a')
  assert.equal(a[3], '在旧港')
  assert.equal(a[4], 5)
  assert.deepEqual(a[5], [])
})

test('addClaim 带上索引词', () => {
  const claims = createClaims()
  const claim = addClaim(claims, {
    personId: 'p7',
    code: 'a',
    text: '5点在仓库',
    turn: 3,
    words: [{ 词: '仓库', 类: '地' }],
  })
  assert.deepEqual(claim[5], [{ 词: '仓库', 类: '地' }])
})

test('addClaim 没给索引词时留空数组', () => {
  const claims = createClaims()
  const claim = addClaim(claims, { personId: 'p7', code: 'a', text: '账房', turn: 5 })
  assert.deepEqual(claim[5], [])
})

test('claimsOf 只返回该人物的命题', () => {
  const claims = createClaims()
  addClaim(claims, { personId: 'p7', code: 'a', text: '在旧港', turn: 5 })
  addClaim(claims, { personId: 'p12', code: 'a', text: '在码头', turn: 6 })
  assert.equal(claimsOf(claims, 'p7').length, 1)
  assert.equal(claimsOf(claims, 'p7')[0][3], '在旧港')
})

test('claimsOf 给了栏目就再按栏目筛', () => {
  const claims = createClaims()
  addClaim(claims, { personId: 'p7', code: 'a', text: '在旧港', turn: 5 })
  addClaim(claims, { personId: 'p7', code: 'b', text: '账房', turn: 5 })
  assert.equal(claimsOf(claims, 'p7', 'a').length, 1)
  assert.equal(claimsOf(claims, 'p7', 'a')[0][2], 'a')
})

test('findClaim 精确匹配人物 + 栏目 + 内容', () => {
  const claims = createClaims()
  addClaim(claims, { personId: 'p7', code: 'a', text: '在旧港', turn: 5 })
  assert.ok(findClaim(claims, { personId: 'p7', code: 'a', text: '在旧港' }))
  assert.equal(findClaim(claims, { personId: 'p7', code: 'a', text: '在仓库' }), null)
  assert.equal(findClaim(claims, { personId: 'p12', code: 'a', text: '在旧港' }), null)
  assert.equal(findClaim(claims, { personId: 'p7', code: 'b', text: '在旧港' }), null)
})

test('findClaimLoose 用调用方给的宽松键匹配', () => {
  const claims = createClaims()
  addClaim(claims, { personId: 'p7', code: 'a', text: '在旧港。', turn: 5 })
  const keyOf = (text) => String(text).replace(/[。，、！？\s]/gu, '')
  assert.equal(findClaim(claims, { personId: 'p7', code: 'a', text: '在旧港' }), null)
  assert.ok(findClaimLoose(claims, { personId: 'p7', code: 'a', text: '在旧港', keyOf }))
})

test('dropClaim 删掉整条（永久删除人物时用）', () => {
  const claims = createClaims()
  const c = addClaim(claims, { personId: 'p7', code: 'a', text: '找B复仇', turn: 5 })
  assert.equal(dropClaim(claims, c[0]), true)
  assert.equal(claims.length, 0)
})

test('dropClaim 查不到 id 时返回 false', () => {
  const claims = createClaims()
  assert.equal(dropClaim(claims, 999), false)
})

test('claimById 查得到，查不到返回 null', () => {
  const claims = createClaims()
  const c = addClaim(claims, { personId: 'p7', code: 'a', text: '在旧港', turn: 5 })
  assert.equal(claimById(claims, c[0])[3], '在旧港')
  assert.equal(claimById(claims, 999), null)
})

test('addClaim 拒绝空人物 / 空栏目 / 空内容', () => {
  const claims = createClaims()
  assert.equal(addClaim(claims, { personId: '', code: 'a', text: 'x', turn: 1 }), null)
  assert.equal(addClaim(claims, { personId: 'p7', code: '', text: 'x', turn: 1 }), null)
  assert.equal(addClaim(claims, { personId: 'p7', code: 'a', text: '', turn: 1 }), null)
  assert.equal(claims.length, 0)
})

// ── 孤儿命题清理（P22②）──

test('pruneOrphanClaims：零指针的命题摘掉，有指针的保留', () => {
  const claims = createClaims()
  const kept = addClaim(claims, { personId: 'p7', code: 'a', text: '在旧港', turn: 3 })
  const orphan = addClaim(claims, { personId: 'p7', code: 'b', text: '没人知道的事', turn: 4 })
  const pointers = [['p7', kept[0], [[0, '']], 5]]
  const result = pruneOrphanClaims(claims, pointers)
  assert.deepEqual(result.removed, [orphan[0]])
  assert.equal(claims.length, 1)
  assert.equal(claims[0][0], kept[0])
})

test('pruneOrphanClaims：本轮新建的命题豁免（防写入中途失败）', () => {
  const claims = createClaims()
  const fresh = addClaim(claims, { personId: 'p7', code: 'a', text: '刚建还没挂指针', turn: 9 })
  const result = pruneOrphanClaims(claims, [], { turn: 9 })
  assert.deepEqual(result.removed, [], '本轮新建的不摘')
  assert.equal(claims.length, 1)
  // 下一轮它还是零指针，就会被摘
  const next = pruneOrphanClaims(claims, [], { turn: 10 })
  assert.deepEqual(next.removed, [fresh[0]])
  assert.equal(claims.length, 0)
})

test('pruneOrphanClaims：不传 turn 时不豁免（手动调用场景）', () => {
  const claims = createClaims()
  addClaim(claims, { personId: 'p7', code: 'a', text: '孤儿', turn: 9 })
  const result = pruneOrphanClaims(claims, [])
  assert.equal(result.removed.length, 1)
  assert.equal(claims.length, 0)
})

test('pruneOrphanClaims：没有指针表 / 空表都不炸', () => {
  const claims = createClaims()
  addClaim(claims, { personId: 'p7', code: 'a', text: '孤儿', turn: 1 })
  assert.equal(pruneOrphanClaims(claims, null).removed.length, 1)
  const empty = createClaims()
  assert.deepEqual(pruneOrphanClaims(empty, [], { turn: 1 }).removed, [])
})
