// 手动补写：面板上一个「补写这一轮」按钮，兜住自动写入失败（ADR 0111）。
//
// 为什么要有：自动写回是「射后不管」的后台任务，模型偶尔交空、或者写回中途失败，
// 那一轮的内容就永久缺了——玩家只能回退重跑（会连带重算 MVU），代价太大。
//
// 这里只放**纯判断与一句话回执**（不碰 ctx、不碰文件），方便单测：
//   1. 什么时候不许补（正在生成/结算、还没结算过、写入方式是「关闭」）；
//   2. 补完怎么用一句人话告诉玩家补到了什么。
//
// 真正的补写动作在 index.mjs 的 handle 里，复用自动结算那套 `runWriteback`（D6）。

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { retryRefusal, retrySummary } from '../plugin/lib/retryWriteback.js'

test('补写：正在生成或结算时拒绝（会跟后台任务打架）', () => {
  const verdict = retryRefusal({ turnState: { turn: 6, busy: true }, mode: 'background' })
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /正在|等/)
})

test('补写：这一局还没结算过任何一轮时拒绝', () => {
  assert.equal(retryRefusal({ turnState: { turn: 0, busy: false }, mode: 'background' }).ok, false)
  assert.match(retryRefusal({ turnState: { turn: 0 }, mode: 'background' }).reason, /还没有/)
  assert.equal(retryRefusal({ turnState: null, mode: 'background' }).ok, false)
})

test('补写：读不到轮次时说「读不到」，别说成「还没结算过」（老宿主会误导）', () => {
  assert.match(retryRefusal({ turnState: null, mode: 'background' }).reason, /读不到/)
  assert.match(retryRefusal({ turnState: {}, mode: 'background' }).reason, /读不到/)
  // 布尔/字符串冒充轮次一律当读不到（Number(true) === 1，不能放行）
  assert.match(retryRefusal({ turnState: { turn: true }, mode: 'background' }).reason, /读不到/)
  assert.match(retryRefusal({ turnState: { turn: '6' }, mode: 'background' }).reason, /读不到/)
})

// 宿主只在「前台生成/后台结算」时把 busy 置真；**插件自己的自动写回**它不知道
// （onTurnSettled 的处理器它不等）。所以还得有我们自己的 in-flight 标记，否则同一轮会并发跑两遍写回。
test('补写：同一轮的自动写回还在跑时拒绝（busy 覆盖不到这一种）', () => {
  const verdict = retryRefusal({ turnState: { turn: 6, busy: false }, mode: 'background', inFlight: true })
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /还在跑|等/)
  assert.equal(retryRefusal({ turnState: { turn: 6, busy: false }, mode: 'background', inFlight: false }).ok, true)
})

test('补写：写入方式是「关闭」时拒绝，并指路去哪儿打开', () => {
  const verdict = retryRefusal({ turnState: { turn: 6, busy: false }, mode: 'off' })
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /关闭/)
})

test('补写：最新一轮已结算完、写入没关就允许', () => {
  for (const mode of ['background', 'subagent']) {
    const verdict = retryRefusal({ turnState: { turn: 6, busy: false, settled: true }, mode })
    assert.deepEqual(verdict, { ok: true, reason: '' }, mode)
  }
  // 结算失败（busy=false 但 settled=false）也允许补——这正是这个按钮存在的理由
  assert.equal(retryRefusal({ turnState: { turn: 6, busy: false, settled: false }, mode: 'background' }).ok, true)
})

test('补写回执：一句话说清补到了什么', () => {
  const text = retrySummary({ judgeActions: 3, created: 1, writeActions: 2, bad: 1 })
  assert.match(text, /判定 3 条/)
  assert.match(text, /建档 1 人/)
  assert.match(text, /写入 2 条/)
  assert.match(text, /拒 1 条/)
})

test('补写回执：拿不到计数也不炸（写回中途失败时就是空的）', () => {
  const text = retrySummary(undefined)
  assert.equal(typeof text, 'string')
  assert.ok(text.length > 0)
  // 「没读出可写的内容」会让人以为解析失败；真实情况多半是「模型这轮没给动作」
  assert.doesNotMatch(text, /没读出/)
  assert.match(text, /没有新内容|没给|没写/)
})

test('补写回执：负数/非整数不进文案（别显示「判定 -1 条」）', () => {
  const text = retrySummary({ judgeActions: -1, created: 3, writeActions: -2, bad: 0 })
  assert.doesNotMatch(text, /-1|-2/)
  assert.match(text, /建档 3 人/)
})
