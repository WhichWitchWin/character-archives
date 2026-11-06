// 解析模型交回来的 payload（按阶段两种形状，ADR 0064）
//
// 判定阶段：{ 建档:[…], 改状态:[…], 模糊建档:[…] }
// 写入阶段：{ "人名": [ {栏目, 值, 来源, …}, … ] }
//
// 为什么改成这样：原来一个扁平数组，十几个动作挤在一起，「谁的动作」要靠 `人物` 字段
// 自己看；按人／按用途分块之后，人和值的关系一眼能看出来。
//
// 解析出来仍然是**扁平的内部动作**，下游（validatePersonActions / validateValueActions）不用改。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseJudgePayload, parseWritePayload } from '../plugin/lib/payload.js'

test('判定：建档/改状态/模糊建档三块都能翻成动作', () => {
  const actions = parseJudgePayload({
    建档: [{ 姓名: '值班店长张', 别名: '挂钥匙串的张姐', 状态: '在场' }],
    改状态: [{ 姓名: '老陈', 状态: '离场' }],
    模糊建档: ['卖炭翁', '沈九'],
  })
  assert.deepEqual(actions, [
    { 动作: '建档', 姓名: '值班店长张', 别名: '挂钥匙串的张姐', 状态: '在场' },
    { 动作: '改状态', 人物: '老陈', 状态: '离场' },
    { 动作: '模糊建档', 姓名: '卖炭翁' },
    { 动作: '模糊建档', 姓名: '沈九' },
  ])
})

test('判定：空对象 / 缺块 / 脏值都不炸', () => {
  assert.deepEqual(parseJudgePayload({}), [])
  assert.deepEqual(parseJudgePayload(null), [])
  assert.deepEqual(parseJudgePayload({ 建档: '不是数组' }), [])
  assert.deepEqual(parseJudgePayload({ 模糊建档: [{ 姓名: '甲' }, '乙', ''] }), [
    { 动作: '模糊建档', 姓名: '甲' },
    { 动作: '模糊建档', 姓名: '乙' },
  ])
})

test('判定解析兼容老格式：直接给数组就原样当动作列表', () => {
  assert.deepEqual(parseJudgePayload([{ 动作: '建档', 姓名: '甲' }]), [{ 动作: '建档', 姓名: '甲' }])
})

// ── 回头测试独立成动作（ADR 0062）──
// 模型必须先表态"哪些称呼能喊得回"，程序再核对：建档的人必须在「通过」名单里。
test('判定 payload：回头测试块能解析成动作', () => {
  const actions = parseJudgePayload({
    回头测试: {
      通过: ['沈清禾', '值班店长张'],
      不通过: [{ 称呼: '老头', 原因: '蓝色夹克是拎板凳老人的标配，不是反常' }],
    },
    建档: [{ 姓名: '值班店长张', 状态: '在场' }],
  })
  const look = actions.find((item) => item.动作 === '回头测试')
  assert.ok(look, '要有回头测试动作')
  assert.deepEqual(look.通过, ['沈清禾', '值班店长张'])
  assert.deepEqual(look.不通过, [{ 称呼: '老头', 原因: '蓝色夹克是拎板凳老人的标配，不是反常' }])
})

test('判定 payload：回头测试放在顶层（不在动作数组里）也能解析', () => {
  const actions = parseJudgePayload({
    通过: ['沈清禾'],
    不通过: ['老头'],
  })
  const look = actions.find((item) => item.动作 === '回头测试')
  assert.ok(look)
  assert.deepEqual(actions.filter((item) => item.动作 === '模糊建档').map((item) => item.姓名), ['老头'])
  assert.deepEqual(actions[0].通过, ['沈清禾'])
  assert.deepEqual(actions[0].不通过, [{ 称呼: '老头', 原因: '' }])
})

test('判定 payload：不通过也接受字符串写法', () => {
  const actions = parseJudgePayload({ 回头测试: { 通过: [], 不通过: ['老头', '摊主'] } })
  assert.deepEqual(actions[0].不通过, [{ 称呼: '老头', 原因: '' }, { 称呼: '摊主', 原因: '' }])
})

// ── 模糊建档兜底：模型没报这个块时，把「回头测试·不通过」的称呼收进候选 ──
test('没报模糊建档：用回头测试不通过兜底', () => {
  const actions = parseJudgePayload({
    回头测试: {
      通过: ['老陈'],
      不通过: [
        { 称呼: '前台小姐', 原因: '标配' },
        { 称呼: '穿校服的学生', 原因: '成群' },
      ],
    },
    建档: [{ 姓名: '老陈', 状态: '在场' }],
  })
  assert.deepEqual(
    actions.filter((item) => item.动作 === '模糊建档').map((item) => item.姓名),
    ['前台小姐', '穿校服的学生'],
  )
})

test('报了模糊建档：只收模型报的，不用回头测试兜底', () => {
  const actions = parseJudgePayload({
    回头测试: { 通过: ['老陈'], 不通过: [{ 称呼: '前台小姐', 原因: '标配' }] },
    模糊建档: ['卖炭翁'],
  })
  assert.deepEqual(
    actions.filter((item) => item.动作 === '模糊建档').map((item) => item.姓名),
    ['卖炭翁'],
  )
})

test('报了空的模糊建档数组：算「报了」，不兜底', () => {
  const actions = parseJudgePayload({
    回头测试: { 通过: [], 不通过: [{ 称呼: '摊主', 原因: '标配' }] },
    模糊建档: [],
  })
  assert.equal(actions.some((item) => item.动作 === '模糊建档'), false)
})

test('既没回头测试也没模糊建档：不凭空造候选', () => {
  assert.deepEqual(parseJudgePayload({ 建档: [] }), [])
})

test('判定：改名块能翻成动作', () => {
  const actions = parseJudgePayload({
    改名: [{ 姓名: '老陈', 新姓名: '陈守义' }],
  })
  assert.deepEqual(actions, [{ 动作: '改名', 姓名: '老陈', 新姓名: '陈守义' }])
})

test('判定：改名块里的脏值不会炸', () => {
  assert.deepEqual(parseJudgePayload({ 改名: '不是数组' }), [])
  assert.deepEqual(parseJudgePayload({ 改名: ['字符串', null, {}] }), [
    { 动作: '改名', 姓名: undefined, 新姓名: undefined },
  ])
})
