// 写入素材：命题 + 指针（ADR 0083 阶段二）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildWritePrompt } from '../plugin/lib/followup.js'
import { TRUTH, SELF, UNKNOWN_SOURCE } from '../plugin/lib/pointers.js'

const definitions = { a: { name: '位置' }, b: { name: '身份' } }
const textOf = (claim) => claim[3]
const nameOf = (id) => ({ p12: '李四', p15: '张三' })[id] ?? id

const row = (claim, pointer) => ({ claim, pointer })
const claimRow = (id, personId, code, text) => [id, personId, code, text, 3, [], 0]

test('写入素材带当前时间与地点', () => {
  const text = buildWritePrompt({ gt: '永安三年·冬', loc: '临安·旧港', people: [], definitions, textOf })
  assert.ok(text.includes('永安三年·冬'))
  assert.ok(text.includes('临安·旧港'))
})

// 新人物一条命题都没有时，素材里只列人名 → 模型会直接返回空数组，一个人都建不出来。
test('一条命题都没有的在场人物：把还空着的栏目名告诉他', () => {
  const text = buildWritePrompt({
    people: [{ id: 'p7', name: '老陈', status: 1, claims: [] }],
    definitions,
    textOf,
  })
  assert.ok(text.includes('【老陈 · 在场】'))
  assert.ok(text.includes('这些栏目还空着：位置、身份'), text)
})

test('有命题的人物：不再列「还空着」提示', () => {
  const text = buildWritePrompt({
    people: [
      {
        id: 'p7',
        name: '老陈',
        status: 1,
        claims: [row(claimRow(1, 'p7', 'a', '在旧港'), ['p7', 1, [[TRUTH.TRUE, SELF]], 3])],
      },
    ],
    definitions,
    textOf,
  })
  assert.ok(!text.includes('还空着'))
})

test('不在场的人（只读段）：不列「还空着」提示——他们这轮不建指针', () => {
  const text = buildWritePrompt({
    people: [],
    mentioned: [{ id: 'p15', name: '张三', status: 0, claims: [] }],
    definitions,
    textOf,
  })
  assert.ok(text.includes('【正文提到、但不在场】'))
  assert.ok(!text.includes('还空着'))
})

test('只列勾选的栏目', () => {
  const text = buildWritePrompt({
    people: [{ id: 'p7', name: '老陈', status: 1, claims: [] }],
    definitions,
    checkedCodes: new Set(['a']),
    textOf,
  })
  assert.ok(text.includes('这些栏目还空着：位置'))
  assert.ok(!text.includes('身份'))
})

test('在场人物按人分组，值行带指针描述', () => {
  const text = buildWritePrompt({
    people: [
      {
        id: 'p7',
        name: '老陈',
        status: 1,
        claims: [
          row(claimRow(1, 'p7', 'a', '在旧港'), ['p7', 1, [[TRUTH.TRUE, SELF]], 3]),
          row(claimRow(2, 'p7', 'b', '账房'), ['p7', 2, [[TRUTH.UNKNOWN, 'p12']], 3]),
        ],
      },
    ],
    definitions,
    textOf,
    nameOf,
  })
  assert.ok(text.includes('【老陈 · 在场】'))
  assert.ok(text.includes('1. 在旧港 ｜ 他自己确认过'))
  assert.ok(text.includes('2. 账房 ｜ 他听李四说的，拿不准'))
})

test('指针四种渲染：自己假、别人真、别人假、未知来源', () => {
  const text = buildWritePrompt({
    people: [
      {
        id: 'p7',
        name: '老陈',
        status: 1,
        claims: [
          row(claimRow(1, 'p7', 'a', '甲'), ['p7', 1, [[TRUTH.FALSE, SELF]], 3]),
          row(claimRow(2, 'p7', 'a', '乙'), ['p7', 2, [[TRUTH.TRUE, 'p12']], 3]),
          row(claimRow(3, 'p7', 'a', '丙'), ['p7', 3, [[TRUTH.FALSE, 'p12']], 3]),
          row(claimRow(4, 'p7', 'a', '丁'), ['p7', 4, [[TRUTH.TRUE, UNKNOWN_SOURCE]], 3]),
        ],
      },
    ],
    definitions,
    textOf,
    nameOf,
  })
  assert.ok(text.includes('1. 甲 ｜ 他认为这是错的'))
  assert.ok(text.includes('2. 乙 ｜ 他听李四说的，信了'))
  assert.ok(text.includes('3. 丙 ｜ 他听李四说的，认为是假的'))
  assert.ok(text.includes('4. 丁 ｜ 他听说的，信了'))
})

test('多个来源用分号连起来', () => {
  const text = buildWritePrompt({
    people: [
      {
        id: 'p7',
        name: '老陈',
        status: 1,
        claims: [row(claimRow(1, 'p7', 'a', '在旧港'), ['p7', 1, [[TRUTH.TRUE, SELF], [TRUTH.FALSE, 'p12']], 3])],
      },
    ],
    definitions,
    textOf,
    nameOf,
  })
  assert.ok(text.includes('他自己确认过；他听李四说的，认为是假的'))
})

test('同一条命题在两个人物下面用同一个序号', () => {
  const shared = claimRow(1, 'p9', 'a', '在旧港')
  const text = buildWritePrompt({
    people: [
      { id: 'p7', name: '老陈', status: 1, claims: [row(shared, ['p7', 1, [[TRUTH.TRUE, SELF]], 3])] },
      { id: 'p12', name: '李四', status: 1, claims: [row(shared, ['p12', 1, [[TRUTH.UNKNOWN, 'p7']], 3])] },
    ],
    definitions,
    textOf,
    nameOf,
  })
  assert.equal(text.split('1. 在旧港').length - 1, 2)
})

test('不同栏目里的序号连续递增', () => {
  const text = buildWritePrompt({
    people: [
      {
        id: 'p7',
        name: '老陈',
        status: 1,
        claims: [
          row(claimRow(1, 'p7', 'a', '在旧港'), ['p7', 1, [[TRUTH.TRUE, SELF]], 3]),
          row(claimRow(2, 'p7', 'b', '账房'), ['p7', 2, [[TRUTH.TRUE, SELF]], 3]),
        ],
      },
    ],
    definitions,
    textOf,
    nameOf,
  })
  assert.ok(text.includes('1. 在旧港'))
  assert.ok(text.includes('2. 账房'))
})

test('不在场的人单独一段，不带指针描述', () => {
  const text = buildWritePrompt({
    people: [],
    mentioned: [{ id: 'p15', name: '张三', claims: [row(claimRow(5, 'p15', 'a', '在码头'), null)] }],
    definitions,
    textOf,
    nameOf,
  })
  assert.ok(text.includes('【正文提到、但不在场】'))
  assert.ok(text.includes('张三'))
  assert.ok(text.includes('在码头'))
  assert.ok(!text.includes('确认过'))
})

test('没勾选的栏目不出现', () => {
  const text = buildWritePrompt({
    people: [
      {
        id: 'p7',
        name: '老陈',
        status: 1,
        claims: [
          row(claimRow(1, 'p7', 'a', '在旧港'), ['p7', 1, [[TRUTH.TRUE, SELF]], 3]),
          row(claimRow(2, 'p7', 'b', '账房'), ['p7', 2, [[TRUTH.TRUE, SELF]], 3]),
        ],
      },
    ],
    definitions,
    checkedCodes: new Set(['a']),
    textOf,
    nameOf,
  })
  assert.ok(text.includes('在旧港'))
  assert.ok(!text.includes('账房'))
})
