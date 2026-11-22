// 面板「给他补一条认知」：校验纯逻辑（handle 只负责接线与落盘）
//
// 为什么单独抽出来：这三个拒绝理由都要说人话给玩家看（找不到人 / 找不到命题 / 已经记着），
// 而"判定"和"改数据"分开之后，边界情况能在这里单测，不用开酒馆。
import test from 'node:test'
import assert from 'node:assert/strict'

import { cognitionRefusal } from '../plugin/lib/pointers.js'

const persons = [['p1', 1, '老陈', ''], ['p2', 1, '李天天', '']]
const claims = [[1, 'p1', 'a', '在旧港', 1, [], 0], [2, 'p2', 'a', '天使投资人', 1, [], 0]]

test('补认知：人不在档 → 拒绝并说清', () => {
  const reason = cognitionRefusal({ persons, claims, pointers: [], personId: 'p9', claimId: 1 })
  assert.match(reason, /找不到这个人/)
})

test('补认知：命题不存在 → 拒绝', () => {
  const reason = cognitionRefusal({ persons, claims, pointers: [], personId: 'p1', claimId: 99 })
  assert.match(reason, /找不到这条命题/)
})

test('补认知：命题编号不是正整数 → 拒绝', () => {
  assert.match(cognitionRefusal({ persons, claims, pointers: [], personId: 'p1', claimId: 'abc' }), /编号/)
  assert.match(cognitionRefusal({ persons, claims, pointers: [], personId: 'p1', claimId: 0 }), /编号/)
})

test('补认知：他已经记着这条 → 拒绝（别重复加）', () => {
  const pointers = [['p1', 1, [[2, '']], 1]]
  assert.match(cognitionRefusal({ persons, claims, pointers, personId: 'p1', claimId: 1 }), /已经记着/)
})

test('补认知：人/命题都在、还没记过 → 放行（返回 null）', () => {
  assert.equal(cognitionRefusal({ persons, claims, pointers: [], personId: 'p2', claimId: 1 }), null)
})
