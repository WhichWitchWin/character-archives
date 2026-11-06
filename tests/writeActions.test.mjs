// 写入应用：命题四级匹配 + 指针规则（ADR 0083 阶段四）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyWriteActions } from '../plugin/lib/writeActions.js'
import { TRUTH, SELF } from '../plugin/lib/pointers.js'

const definitions = { a: { name: '位置' }, b: { name: '身份' } }
const resolvePerson = (name) =>
  ({ 老陈: 'p7', 李四: 'p12', 张三: 'p15', 王五: 'p20' })[String(name ?? '').trim()] ?? null

const run = (snapshot, actions, extra = {}) =>
  applyWriteActions({
    snapshot,
    actions,
    definitions,
    turn: 5,
    resolvePerson,
    allowedIds: new Set(['p7', 'p12']),
    ...extra,
  })

test('新建命题并给在场人物建指针', () => {
  const snapshot = { c: [], pt: [] }
  const result = run(snapshot, [
    { 关于: '老陈', 栏目: '位置', 值: '在旧港', 认知: [{ 谁: '李四', 态度: '未定', 来源: '老陈' }] },
  ])
  assert.equal(result.bad.length, 0)
  assert.equal(snapshot.c.length, 1)
  assert.equal(snapshot.c[0][1], 'p7')
  assert.equal(snapshot.c[0][3], '在旧港')
  assert.equal(snapshot.pt.length, 1)
  assert.equal(snapshot.pt[0][0], 'p12')
  assert.equal(snapshot.pt[0][1], 1)
  assert.deepEqual(snapshot.pt[0][2], [[TRUTH.UNKNOWN, 'p7']])
})

test('不在场的人不建指针，而且记进 bad（不然模型以为写成功了）', () => {
  const snapshot = { c: [], pt: [] }
  const result = run(snapshot, [
    { 关于: '老陈', 栏目: '位置', 值: '在旧港', 认知: [{ 谁: '张三', 态度: '真', 来源: '自己' }] },
  ])
  assert.equal(snapshot.c.length, 1, '命题照建')
  assert.equal(snapshot.pt.length, 0, '不在场的人不建指针')
  assert.equal(result.bad.length, 1)
  assert.match(result.bad[0].reason, /不在场/)
})

test('序号指向已有命题时复用它', () => {  const snapshot = { c: [[1, 'p7', 'a', '在旧港', 3, [], 0]], pt: [] }
  const result = run(
    snapshot,
    [{ 关于: '老陈', 栏目: '位置', 值: '在旧港', 序号: 1, 认知: [{ 谁: '李四', 态度: '真', 来源: '自己' }] }],
    { seqMap: new Map([[1, 1]]) },
  )
  assert.equal(result.bad.length, 0)
  assert.equal(snapshot.c.length, 1)
  assert.equal(snapshot.pt[0][1], 1)
  assert.deepEqual(snapshot.pt[0][2], [[TRUTH.TRUE, SELF]])
})

test('序号指向的命题值对不上时退回按值匹配', () => {
  const snapshot = { c: [[1, 'p7', 'a', '在仓库', 3, [], 0]], pt: [] }
  run(
    snapshot,
    [{ 关于: '老陈', 栏目: '位置', 值: '在旧港', 序号: 1, 认知: [] }],
    { seqMap: new Map([[1, 1]]) },
  )
  assert.equal(snapshot.c.length, 2)
  assert.equal(snapshot.c[1][3], '在旧港')
})

test('标点差异不会重复建命题', () => {
  const snapshot = { c: [[1, 'p7', 'a', '在旧港。', 3, [], 0]], pt: [] }
  run(snapshot, [{ 关于: '老陈', 栏目: '位置', 值: '在旧港', 认知: [] }])
  assert.equal(snapshot.c.length, 1)
})

test('已有「自己」那组时，别人报的只追加他述组', () => {
  const snapshot = {
    c: [[1, 'p7', 'a', '在旧港', 3, [], 0]],
    pt: [['p7', 1, [[TRUTH.TRUE, SELF]], 3]],
  }
  run(snapshot, [
    { 关于: '老陈', 栏目: '位置', 值: '在旧港', 认知: [{ 谁: '老陈', 态度: '假', 来源: '李四' }] },
  ])
  assert.deepEqual(snapshot.pt[0][2][0], [TRUTH.TRUE, SELF], '自己那组不动')
  assert.deepEqual(snapshot.pt[0][2][1], [TRUTH.FALSE, 'p12'])
})

test('自己报「自己」能改自我认知', () => {
  const snapshot = {
    c: [[1, 'p7', 'a', '在旧港', 3, [], 0]],
    pt: [['p7', 1, [[TRUTH.TRUE, SELF]], 3]],
  }
  run(snapshot, [
    { 关于: '老陈', 栏目: '位置', 值: '在旧港', 认知: [{ 谁: '老陈', 态度: '未定', 来源: '自己' }] },
  ])
  assert.deepEqual(snapshot.pt[0][2][0], [TRUTH.UNKNOWN, SELF])
})

test('态度不是真/假/未定 → 这条认知被拒', () => {
  const snapshot = { c: [], pt: [] }
  const result = run(snapshot, [
    { 关于: '老陈', 栏目: '位置', 值: '在旧港', 认知: [{ 谁: '李四', 态度: '可能吧', 来源: '老陈' }] },
  ])
  assert.equal(snapshot.pt.length, 0)
  assert.equal(result.bad.length, 1)
  assert.ok(result.bad[0].reason.includes('态度'))
})

test('关于的人不在档案里 → 整条被拒', () => {
  const snapshot = { c: [], pt: [] }
  const result = run(snapshot, [{ 关于: '查无此人', 栏目: '位置', 值: '在旧港', 认知: [] }])
  assert.equal(snapshot.c.length, 0)
  assert.equal(result.bad.length, 1)
  assert.ok(result.bad[0].reason.includes('人物'))
})

test('栏目不存在 → 整条被拒', () => {
  const snapshot = { c: [], pt: [] }
  const result = run(snapshot, [{ 关于: '老陈', 栏目: '不存在', 值: 'x', 认知: [] }])
  assert.equal(snapshot.c.length, 0)
  assert.equal(result.bad.length, 1)
  assert.ok(result.bad[0].reason.includes('栏目'))
})

test('值为空 → 整条被拒', () => {
  const snapshot = { c: [], pt: [] }
  const result = run(snapshot, [{ 关于: '老陈', 栏目: '位置', 值: '  ', 认知: [] }])
  assert.equal(snapshot.c.length, 0)
  assert.equal(result.bad.length, 1)
})

test('不在场的人不能建指针，但命题照建', () => {
  const snapshot = { c: [], pt: [] }
  run(snapshot, [
    { 关于: '张三', 栏目: '位置', 值: '在码头', 认知: [{ 谁: '张三', 态度: '真', 来源: '自己' }] },
  ])
  assert.equal(snapshot.c.length, 1, '命题照建')
  assert.equal(snapshot.pt.length, 0, '指针不给建')
})

test('认知里的「谁」查不到 → 只拒这一条认知', () => {
  const snapshot = { c: [], pt: [] }
  const result = run(snapshot, [
    { 关于: '老陈', 栏目: '位置', 值: '在旧港', 认知: [{ 谁: '查无此人', 态度: '真', 来源: '自己' }] },
  ])
  assert.equal(snapshot.c.length, 1)
  assert.equal(snapshot.pt.length, 0)
  assert.equal(result.bad.length, 1)
})

test('索引词不在值里 → 丢掉', () => {
  const snapshot = { c: [], pt: [] }
  run(snapshot, [
    {
      关于: '老陈',
      栏目: '位置',
      值: '在旧港',
      索引词: [{ 词: '旧港', 类: '地' }, { 词: '码头', 类: '地' }],
      认知: [],
    },
  ])
  assert.deepEqual(snapshot.c[0][5], [{ 词: '旧港', 类: '地' }])
})

test('来源「未知」落成未知来源标记', () => {
  const snapshot = { c: [], pt: [] }
  run(snapshot, [
    { 关于: '老陈', 栏目: '位置', 值: '在旧港', 认知: [{ 谁: '李四', 态度: '未定', 来源: '未知' }] },
  ])
  assert.deepEqual(snapshot.pt[0][2], [[TRUTH.UNKNOWN, '?']])
})

test('同一条认知报两次只留一条指针', () => {
  const snapshot = { c: [], pt: [] }
  run(snapshot, [
    { 关于: '老陈', 栏目: '位置', 值: '在旧港', 认知: [{ 谁: '李四', 态度: '真', 来源: '老陈' }] },
    { 关于: '老陈', 栏目: '位置', 值: '在旧港', 认知: [{ 谁: '李四', 态度: '假', 来源: '老陈' }] },
  ])
  assert.equal(snapshot.pt.length, 1)
  assert.deepEqual(snapshot.pt[0][2], [[TRUTH.FALSE, 'p7']])
})

test('同一人同一条命题、两个来源 → 只建一条指针，两组各记各的', () => {
  const snapshot = { c: [], pt: [] }
  const result = run(snapshot, [
    {
      关于: '老陈',
      栏目: '位置',
      值: '在旧港',
      认知: [
        { 谁: '李四', 态度: '真', 来源: '老陈' },
        { 谁: '李四', 态度: '假', 来源: '张三' },
      ],
    },
  ])
  assert.equal(result.bad.length, 0)
  assert.equal(snapshot.pt.length, 1, '同人同命题只有一条指针')
  assert.deepEqual(snapshot.pt[0][2], [[TRUTH.TRUE, 'p7'], [TRUTH.FALSE, 'p15']], '两个来源各一组')
})

test('值超过 30 字 → 拒', () => {
  const snapshot = { c: [], pt: [] }
  const result = run(snapshot, [
    { 关于: '老陈', 栏目: '位置', 值: '一'.repeat(31), 认知: [{ 谁: '李四', 态度: '真', 来源: '自己' }] },
  ])
  assert.equal(snapshot.c.length, 0)
  assert.equal(result.bad.length, 1)
  assert.ok(result.bad[0].reason.includes('30'))
})

test('来源写了不在人物库里的名字 → 那条认知被拒', () => {
  const snapshot = { c: [], pt: [] }
  const result = run(snapshot, [
    { 关于: '老陈', 栏目: '位置', 值: '在旧港', 认知: [{ 谁: '李四', 态度: '未定', 来源: '客栈掌柜' }] },
  ])
  assert.equal(snapshot.c.length, 1, '命题照建')
  assert.equal(snapshot.pt.length, 0, '指针不建')
  assert.equal(result.bad.length, 1)
  assert.ok(result.bad[0].reason.includes('来源'))
})

// 别人组的名额由设置（cognition.maxOtherSources）决定，默认 3。
// 这里只验「设置真的从入口传到了写指针的地方」——名额算法本身在 pointers.test.mjs。
test('maxOtherSources 传进来时按它限额：传 1 只留最后一组', () => {
  const snapshot = { c: [], pt: [] }
  const result = run(snapshot, [
    {
      关于: '老陈',
      栏目: '位置',
      值: '在旧港',
      认知: [
        { 谁: '李四', 态度: '真', 来源: '老陈' },
        { 谁: '李四', 态度: '假', 来源: '张三' },
      ],
    },
  ], { maxOtherSources: 1 })
  assert.equal(result.bad.length, 0)
  assert.deepEqual(snapshot.pt[0][2], [[TRUTH.FALSE, 'p15']])
})
