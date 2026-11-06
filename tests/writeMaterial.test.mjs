// 写入素材组装：从快照里挑出「跟当前场景有关」的命题（ADR 0083 阶段二）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildWriteMaterial } from '../plugin/lib/writeMaterial.js'

const person = (id, name, status = 1) => [id, status, name, [], '']

const claim = (id, personId, code, text, words = []) => [id, personId, code, text, 3, words, 0]
const pointer = (personId, claimId, states = [[0, '']]) => [personId, claimId, states, 3]

const baseSnapshot = () => ({
  p: [person('p7', '老陈'), person('p12', '李四'), person('p15', '张三', 0)],
  c: [
    claim(1, 'p7', 'a', '在旧港', [{ 词: '旧港', 类: '地' }]),
    claim(2, 'p7', 'a', '在仓库'),
    claim(3, 'p15', 'a', '在码头'),
    claim(4, 'p12', 'b', '账房'),
  ],
  pt: [
    pointer('p7', 1),
    pointer('p7', 2),
    pointer('p12', 1, [[2, 'p7']]),
    pointer('p12', 4),
  ],
  gt: '',
  loc: '',
})

const run = (over = {}) =>
  buildWriteMaterial({
    snapshot: baseSnapshot(),
    presentIds: new Set(['p7', 'p12']),
    mentionedIds: new Set(['p15']),
    checkedCodes: new Set(['a', 'b']),
    hitWords: new Set(),
    turn: 10,
    ...over,
  })

const idsOf = (rows) => rows.map((row) => row.claim[0])

test('关于自己的命题总给', () => {
  const material = run()
  const laochen = material.people.find((item) => item.id === 'p7')
  assert.ok(idsOf(laochen.claims).includes(1))
  assert.ok(idsOf(laochen.claims).includes(2))
})

test('关于在场其他人的命题给', () => {
  const material = run()
  const lisi = material.people.find((item) => item.id === 'p12')
  assert.ok(idsOf(lisi.claims).includes(1))
})

test('关于不在场、又没命中索引词的命题不给', () => {
  const material = run()
  const laochen = material.people.find((item) => item.id === 'p7')
  assert.equal(idsOf(laochen.claims).includes(3), false)
})

test('索引词命中的命题给', () => {
  const snapshot = baseSnapshot()
  // p7 知道一条关于 p15（不在场）的命题，只能靠索引词带出来
  snapshot.c.push(claim(5, 'p15', 'a', '在旧港码头', [{ 词: '旧港', 类: '地' }]))
  snapshot.pt.push(pointer('p7', 5))
  const material = run({ snapshot, hitWords: new Set(['旧港']) })
  const laochen = material.people.find((item) => item.id === 'p7')
  assert.ok(idsOf(laochen.claims).includes(5))
})

test('地点相关的命题给', () => {
  const snapshot = baseSnapshot()
  snapshot.c.push(claim(5, 'p15', 'a', '在旧港码头', [{ 词: '旧港', 类: '地' }]))
  snapshot.pt.push(pointer('p7', 5))
  snapshot.loc = '临安·旧港·码头'
  const material = run({ snapshot })
  const laochen = material.people.find((item) => item.id === 'p7')
  assert.ok(idsOf(laochen.claims).includes(5))
})

test('没勾的栏目不给', () => {
  const material = run({ checkedCodes: new Set(['a']) })
  const lisi = material.people.find((item) => item.id === 'p12')
  assert.equal(idsOf(lisi.claims).includes(4), false)
})

test('提到但不在场的人只读列出', () => {
  const material = run()
  assert.equal(material.mentioned.length, 1)
  assert.equal(material.mentioned[0].id, 'p15')
  assert.equal(material.mentioned[0].name, '张三')
  assert.equal(material.mentioned[0].claims[0].pointer, null)
})

test('在场的人不会重复出现在「不在场」里', () => {
  const material = run({ mentionedIds: new Set(['p7', 'p15']) })
  assert.equal(material.mentioned.length, 1)
  assert.equal(material.mentioned[0].id, 'p15')
})

test('同一条命题在两个人下面共用一个序号', () => {
  const material = run()
  const laochen = material.people.find((item) => item.id === 'p7')
  const lisi = material.people.find((item) => item.id === 'p12')
  const a = laochen.claims.find((row) => row.claim[0] === 1)
  const b = lisi.claims.find((row) => row.claim[0] === 1)
  assert.equal(material.seqOf(a.claim[0]), material.seqOf(b.claim[0]))
})

test('序号从 1 开始连续', () => {
  const material = run()
  const numbers = [...new Set([...material.seqMap.keys()])].sort((x, y) => x - y)
  assert.equal(numbers[0], 1)
  assert.equal(numbers.length, material.seqMap.size)
})

test('没有在场人物时返回空列表', () => {
  const material = run({ presentIds: new Set() })
  assert.deepEqual(material.people, [])
})
