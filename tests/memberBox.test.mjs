// 后台成员（member）交卷盒：宿主调用插件工具时只传 args（issue/ADR 0100）。
//
// 这一组测试锁住三个行为（都是真出现过的坑）：
//   1. 工具的第二个参数是 undefined，交卷仍要落进「这一轮定的盒子」；
//   2. 同一轮交两次要合并，不许后交覆盖先交；
//   3. 没有派发就提交，要明确报错，不许静默丢。

import test from 'node:test'
import assert from 'node:assert/strict'

import { beginMemberRun, endMemberRun, submitMemberPayload } from '../plugin/lib/memberBox.js'

const freshBox = () => ({ payload: null, merged: false, submissions: [] })

test('后台成员交卷：宿主只传一个参数也要落进这一轮的盒子', () => {
  const box = freshBox()
  beginMemberRun(box)
  try {
    const result = submitMemberPayload({ 命题: [{ 关于: '示例甲', 栏目: '职业', 值: '管家' }] })
    assert.deepEqual(result, { ok: true })
    assert.deepEqual(box.payload, { 命题: [{ 关于: '示例甲', 栏目: '职业', 值: '管家' }] })
    assert.equal(box.submissions.length, 1)
    assert.equal(box.merged, false, '第一次提交不算合并')
  } finally {
    endMemberRun(box)
  }
})

test('后台成员交卷：同一轮交两次要合并，不覆盖先交的', () => {
  const box = freshBox()
  beginMemberRun(box)
  try {
    submitMemberPayload({ 回头测试: { 通过: ['示例甲'] } })
    submitMemberPayload({ 命题: [{ 关于: '示例甲' }] })
    assert.deepEqual(box.payload, { 回头测试: { 通过: ['示例甲'] }, 命题: [{ 关于: '示例甲' }] })
    assert.equal(box.merged, true)
    assert.equal(box.submissions.length, 2)
  } finally {
    endMemberRun(box)
  }
})

test('后台成员交卷：没有派发就提交，要明确报错而不是静默丢弃', () => {
  endMemberRun()   // 清掉上一条测试可能留下的状态
  const result = submitMemberPayload({ 命题: [] })
  assert.equal(result.ok, false)
  assert.match(String(result.error), /没有正在运行/)
})

test('后台成员交卷：一轮结束后不再写入上一轮的盒子', () => {
  const first = freshBox()
  const second = freshBox()
  beginMemberRun(first)
  submitMemberPayload({ a: 1 })
  endMemberRun(first)
  beginMemberRun(second)
  try {
    submitMemberPayload({ b: 2 })
    assert.deepEqual(first.payload, { a: 1 }, '上一轮的盒子不该再被写')
    assert.deepEqual(second.payload, { b: 2 })
  } finally {
    endMemberRun(second)
  }
})

// 守卫：接线不许退回「从 execute 第二个参数里找盒子」。
// 宿主是 `tool.execute(structuredClone(args ?? {}))`，第二个参数永远没有——
// 退回旧写法就会静默丢掉整轮结算（ADR 0100）。
test('后台成员交卷：index.mjs 靠派发时定的盒子，不靠 execute 的第二参数', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('../plugin/index.mjs', import.meta.url)), 'utf8')
  assert.ok(src.includes('beginMemberRun(box)'), '派发前没定盒子')
  assert.ok(src.includes('endMemberRun(box)'), '任务结束没清盒子')
  assert.ok(src.includes('submitMemberPayload(args)'), '工具没走 memberBox')
  // 只锁「成员交卷盒」这条线：`archive_query` 那个工具确实从 execution 拿 gameId（另一个接口），别误伤
  assert.ok(!src.includes('memberBox(execution'), '不许再拿 execute 的第二个参数去找交卷盒')
})
