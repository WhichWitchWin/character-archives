// 交卷载荷被模型套了一层壳（ADR 0109）。
//
// 真实现象（2026-11-12）：交卷工具的 schema 里没有 properties，模型手里没有字段名可用，
// 就把整份 JSON 当字符串塞进一个自己编的键里——`{parameter:"{…}"}`、`{parent:"{}", https:"{…}"}`。
// 解析器只认顶层键，于是判定阶段「0 条动作」、写入阶段「0 条值动作」，
// 而交卷工具还回 ok，模型以为交成功了，下一轮继续这么交。
//
// 这组测试锁住两件事：
//   1. unwrapPayload 能把壳剥掉（扁平形状原样放行，绝不误伤正常交卷）；
//   2. acceptShape 能判断「这个形状认不认得」，让交卷工具可以拒收回执、逼模型自纠。

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  acceptShape,
  normalizeSubmission,
  parseJudgePayload,
  parseWritePayloadBundle,
  unwrapPayload,
} from '../plugin/lib/payload.js'

const inner = {
  改状态: [{ 姓名: '示例甲', 状态: '离场' }],
  命题: [
    {
      关于: '示例甲',
      栏目: '最后已知去向',
      值: '旧港码头',
      认知: [{ 谁: '示例甲', 来源: '自己', 态度: '真' }],
    },
  ],
}

const writeCount = (payload) => parseWritePayloadBundle(payload).actions.length

test('解包：扁平对象原样返回，不复制、不动', () => {
  assert.equal(unwrapPayload(inner), inner)
})

test('解包：{"parameter":"{…}"} 这种包装能剥掉', () => {
  const unwrapped = unwrapPayload({ parameter: JSON.stringify(inner) })
  assert.deepEqual(unwrapped, inner)
  assert.equal(writeCount(unwrapped), 1)
  assert.deepEqual(
    parseJudgePayload(unwrapped).map((item) => item.动作),
    ['改状态'],
  )
})

test('解包：{"parent":"{}","https":"{…}"} 双键包装取有内容那个', () => {
  // 另一局实测：外层键名换成了 parent + https，内容在第二个字符串里
  const unwrapped = unwrapPayload({ parent: '{} ', https: JSON.stringify(inner) })
  assert.deepEqual(unwrapped, inner)
})

test('解包：```json 围栏一起剥', () => {
  const unwrapped = unwrapPayload({ parameter: '```json\n' + JSON.stringify(inner) + '\n```' })
  assert.deepEqual(unwrapped, inner)
})

test('解包：单元素数组包装也认', () => {
  assert.deepEqual(unwrapPayload([JSON.stringify(inner)]), inner)
})

test('解包：套了两层也剥到能认的为止', () => {
  const once = { parameter: JSON.stringify(inner) }
  assert.deepEqual(unwrapPayload({ parameter: JSON.stringify(once) }), inner)
})

test('解包：最多剥 4 层，再深就原样返回（文档与代码要对得上）', () => {
  const wrap = (layers) => {
    let value = inner
    for (let i = 0; i < layers; i++) value = { parameter: JSON.stringify(value) }
    return value
  }
  assert.deepEqual(unwrapPayload(wrap(4)), inner, '4 层要剥得开')
  assert.notDeepEqual(unwrapPayload(wrap(5)), inner, '第 5 层不再剥（上限 4）')
})

test('解包：剥完是空对象就认「模型主动交空」，不当故障', () => {
  const unwrapped = unwrapPayload({ parameter: '{}' })
  assert.deepEqual(unwrapped, {})
  assert.equal(writeCount(unwrapped), 0)
  assert.equal(acceptShape({ parameter: '{}' }), true)
})

test('解包：剥不开的垃圾原样返回，不乱猜', () => {
  const junk = { foo: 42, bar: '这不是 JSON' }
  assert.equal(unwrapPayload(junk), junk)
  assert.equal(writeCount(junk), 0)
})

test('形状判定：认得的都放行', () => {
  assert.equal(acceptShape({}), true, '主动交空')
  assert.equal(acceptShape(inner), true, '扁平对象')
  assert.equal(acceptShape({ 通过: ['示例甲'] }), true, '回头测试写在顶层')
  assert.equal(acceptShape({ parameter: JSON.stringify(inner) }), true, '套了壳但能剥开')
  assert.equal(acceptShape([JSON.stringify(inner)]), true, '单元素数组包装')
})

test('形状判定：剥不开的形状不放行（好让交卷工具退回给模型）', () => {
  assert.equal(acceptShape({ foo: 42 }), false)
  assert.equal(acceptShape({ parameter: '随便一句话' }), false)
  assert.equal(acceptShape(null), false)
  assert.equal(acceptShape('字符串'), false)
})

// 交卷工具入口（子代理档 + 后台成员档共用这个守卫，ADR 0109）
test('交卷入口守卫：形状认得就原样放行', () => {
  assert.deepEqual(normalizeSubmission(inner), { ok: true, value: inner })
  assert.deepEqual(normalizeSubmission({}), { ok: true, value: {} })
})

test('交卷入口守卫：形状不认就退回，错误话说清楚怎么改', () => {
  const bad = normalizeSubmission({ foo: 42 })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /形状不对/)
  assert.match(bad.error, /不要/)
})

test('交卷入口守卫：顶层数组不进盒（盒子里没地方放，退回让模型重交）', () => {
  // parseJudgePayload 的老形状认数组，但交卷盒只收对象：放着不管就等于静默丢内容
  assert.equal(normalizeSubmission([{ 建档: [] }]).ok, false)
  assert.equal(normalizeSubmission(null).ok, false)
})
