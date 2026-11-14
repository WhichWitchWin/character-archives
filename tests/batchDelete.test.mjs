// 批量删除命题 / 认知（ADR 0112）。
//
// 面板上「他是什么样」的命题行和「他的认知」的认知行都要能多选删除。
// 两条纪律沿用单条删除（不能因为批量就松）：
//   ① 删命题 → 连带摘掉**所有**指向它的指针；
//   ② 删认知只摘指针；如果某条命题会被摘到「零指针」，那条**跳过**——
//      零指针命题下一轮会被 `pruneOrphanClaims` 当孤儿清掉，而面板承诺「命题本身不动」。
//
// 纯逻辑：不碰 ctx、不碰文件。

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dropCognitions, dropClaims } from '../plugin/lib/batchDelete.js'

const claim = (id, text) => [id, 'p1', 'e1', text, 1, []]
const pointer = (personId, claimId) => [personId, claimId, [0, '', '']]

test('批量删命题：命题没了，指向它的指针也一起没了', () => {
  const claims = [claim(1, '甲'), claim(2, '乙'), claim(3, '丙')]
  const pointers = [pointer('p1', 1), pointer('p2', 1), pointer('p3', 2)]
  const result = dropClaims({ claims, pointers, ids: [1, 2] })
  assert.deepEqual(result.removedClaims.slice().sort(), [1, 2])
  assert.equal(result.removedPointers, 3)
  assert.deepEqual(claims.map((item) => item[0]), [3])
  assert.deepEqual(pointers, [])
})

test('批量删命题：不存在的 id 跳过，重复 id 只算一次', () => {
  const claims = [claim(1, '甲')]
  const pointers = [pointer('p1', 1)]
  const result = dropClaims({ claims, pointers, ids: [1, 1, 99, 'x', 0, -3] })
  assert.deepEqual(result.removedClaims, [1])
  assert.equal(result.removedPointers, 1)
  assert.deepEqual(claims, [])
})

test('批量删命题：一个都没命中就是空结果，不炸', () => {
  const result = dropClaims({ claims: [], pointers: [], ids: [] })
  assert.deepEqual(result, { removedClaims: [], removedPointers: 0 })
  assert.deepEqual(dropClaims({ claims: [claim(1, '甲')], pointers: [], ids: [null] }).removedClaims, [])
})

test('批量删认知：只摘指定人的指针，命题本身不动', () => {
  const claims = [claim(1, '甲'), claim(2, '乙')]
  // 两条命题各有两个人知道，所以摘掉 p1 之后还剩 p2，不会变孤儿
  const pointers = [pointer('p1', 1), pointer('p2', 1), pointer('p1', 2), pointer('p2', 2)]
  const result = dropCognitions({ pointers, personId: 'p1', ids: [1, 2] })
  assert.deepEqual(result.removed, [1, 2])
  assert.deepEqual(result.skipped, [])
  assert.deepEqual(pointers, [pointer('p2', 1), pointer('p2', 2)], 'p1 的两条都没了，p2 的不动')
  assert.deepEqual(claims.map((item) => item[0]), [1, 2], '命题表一个字都不该少')
})

test('批量删认知：会把某条命题摘成「零指针」的那条要跳过（不然变孤儿被清掉）', () => {
  const pointers = [pointer('p2', 1)]
  const result = dropCognitions({ pointers, personId: 'p2', ids: [1] })
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.skipped, [{ claimId: 1, reason: 'last-cognition' }])
  assert.equal(pointers.length, 1, '跳过就是真的不动')
})

test('批量删认知：没有这条认知时不算跳过、也不算删掉', () => {
  const pointers = [pointer('p2', 9)]
  const result = dropCognitions({ pointers, personId: 'p1', ids: [9] })
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.skipped, [], '别人知道不等于「最后一条」，不该报跳过')
  assert.equal(pointers.length, 1)
})

// 脏数据才可能出现「同一个人对同一条命题挂了两个指针」；正常写入按「人＋命题」去重。
// 但既然要删就得删干净——旧接口用 findIndex 只摘一条，面板上会「删了还在」。
test('批量删认知：同一个人重复挂的指针要一次摘到底', () => {
  const pointers = [pointer('p1', 1), pointer('p2', 1), pointer('p1', 1)]
  const result = dropCognitions({ pointers, personId: 'p1', ids: [1] })
  assert.deepEqual(result.removed, [1])
  assert.deepEqual(pointers, [pointer('p2', 1)], 'p1 的两条都得没')
})

// 批量入口不能信外部输入：只认「数字」或「纯数字字符串」。
// `Number()` 太宽松——true→1、[5]→5、'0x10'→16、'1e2'→100，都能把不相干的命题删掉。
test('批量删：id 只认数字或纯数字字符串，别的写法一律不认', () => {
  const claims = [1, 5, 16, 100].map((id) => claim(id, `命题${id}`))
  const pointers = []
  const dirty = [true, [5], '0x10', '1e2', ' 7 ', null, {}, 'x']
  const result = dropClaims({ claims, pointers, ids: dirty })
  assert.deepEqual(result.removedClaims, [], '脏写法一条都不该删')
  assert.deepEqual(claims.map((item) => item[0]), [1, 5, 16, 100])

  const ok = dropClaims({ claims, pointers, ids: ['5', 16] })
  assert.deepEqual(ok.removedClaims, [5, 16], '数字与纯数字字符串都认')
})
