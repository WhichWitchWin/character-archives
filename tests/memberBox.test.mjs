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
  // 载荷换成合法形状：`{a:1}` 这种无关键现在会被形状守卫退回（ADR 0109），测不到路由
  submitMemberPayload({ 命题: [] })
  endMemberRun(first)
  beginMemberRun(second)
  try {
    submitMemberPayload({ 撤回: [] })
    assert.deepEqual(first.payload, { 命题: [] }, '上一轮的盒子不该再被写')
    assert.deepEqual(second.payload, { 撤回: [] })
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

// ── 形状守卫（ADR 0109）──
// 2026-11-12 那次静默失效：模型把 JSON 塞进 `{parameter:"{…}"}` 交上来，
// 盒子照收、工具照回 ok，下一轮继续这么交，24 轮全空。所以：
//   1. 剥得开的壳照收（剥壳在解析层做，这里只判能不能收）；
//   2. 剥不开的形状**不入盒**并明确报错，让模型自己改。
test('后台成员交卷：套了壳的载荷照收，原始形状留痕给解析层剥', () => {
  const box = freshBox()
  beginMemberRun(box)
  try {
    const wrapped = { parameter: JSON.stringify({ 命题: [{ 关于: '示例甲', 栏目: '职业', 值: '管家' }] }) }
    const result = submitMemberPayload(wrapped)
    assert.deepEqual(result, { ok: true })
    assert.deepEqual(box.payload, wrapped, '原始形状要原样留着，/debug 才看得出模型套了壳')
  } finally {
    endMemberRun(box)
  }
})

test('后台成员交卷：剥不开的形状要退回，且不入盒', () => {
  const box = freshBox()
  beginMemberRun(box)
  try {
    const result = submitMemberPayload({ foo: 42 })
    assert.equal(result.ok, false)
    assert.match(String(result.error), /形状不对/)
    assert.equal(box.payload, null, '脏载荷不许合并进盒子')
    assert.deepEqual(box.submissions, [], '也别留档成「交过」')
  } finally {
    endMemberRun(box)
  }
})

// 退回必须留痕：不留的话 /debug 的「交卷次数」还是 0，人类会按 ADR 0100 的读法
// 误判成「模型压根没交」，等于把「看不见」从解析层搬到了工具层。
test('后台成员交卷：怪形状退回要单独留痕，别和「没交」混成一样', () => {
  const box = freshBox()
  beginMemberRun(box)
  try {
    assert.equal(submitMemberPayload({ foo: 42 }).ok, false)
    assert.equal(box.rejected.length, 1, '退回要记一条')
    assert.match(String(box.rejected[0].载荷), /foo/, '记载荷前 600 字，够看清模型交了什么')
    assert.ok(String(box.rejected[0].载荷).length <= 600, '截断，别撑爆调试日志')
  } finally {
    endMemberRun(box)
  }
})

test('后台成员交卷：顶层数组不进盒（放了就等于静默丢内容）', () => {
  const box = freshBox()
  beginMemberRun(box)
  try {
    assert.equal(submitMemberPayload([{ 建档: [{ 姓名: '示例甲' }] }]).ok, false)
    assert.equal(box.payload, null)
  } finally {
    endMemberRun(box)
  }
})
