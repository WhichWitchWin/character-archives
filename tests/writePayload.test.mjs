// 写入 payload：一条动作 = 一条命题 + 若干指针（ADR 0083 阶段三）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseWritePayload } from '../plugin/lib/payload.js'

test('顶层数组，每条一条命题', () => {
  const actions = parseWritePayload([
    {
      关于: 'B',
      栏目: '位置',
      值: '在旧港',
      序号: 3,
      索引词: [{ 词: '旧港', 类: '地' }],
      认知: [{ 谁: 'C', 态度: '未知', 来源: 'A' }],
    },
  ])
  assert.equal(actions.length, 1)
  assert.equal(actions[0].关于, 'B')
  assert.equal(actions[0].栏目, '位置')
  assert.equal(actions[0].值, '在旧港')
  assert.equal(actions[0].序号, 3)
  assert.deepEqual(actions[0].索引词, [{ 词: '旧港', 类: '地' }])
  assert.deepEqual(actions[0].认知, [{ 谁: 'C', 态度: '未知', 来源: 'A' }])
})

test('包在 {命题: [...]} 里也认', () => {
  const actions = parseWritePayload({ 命题: [{ 关于: 'B', 栏目: '位置', 值: '在旧港' }] })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].值, '在旧港')
})

test('认知数组丢掉非对象与空「谁」', () => {
  const actions = parseWritePayload([
    { 关于: 'B', 栏目: '位置', 值: '在旧港', 认知: [{ 谁: 'C' }, null, { 谁: '' }, 'x'] },
  ])
  assert.equal(actions[0].认知.length, 1)
  assert.equal(actions[0].认知[0].谁, 'C')
})

test('没给认知时留空数组', () => {
  const actions = parseWritePayload([{ 关于: 'B', 栏目: '位置', 值: '在旧港' }])
  assert.deepEqual(actions[0].认知, [])
})

test('缺字段的条目也保留，交给校验层拒', () => {
  const actions = parseWritePayload([{ 关于: 'B' }, { 栏目: '位置' }, {}])
  assert.equal(actions.length, 3)
})

test('非数组非对象返回空', () => {
  assert.deepEqual(parseWritePayload(null), [])
  assert.deepEqual(parseWritePayload('x'), [])
  assert.deepEqual(parseWritePayload(42), [])
})

test('值两端空白被裁掉', () => {
  const actions = parseWritePayload([{ 关于: ' B ', 栏目: ' 位置 ', 值: ' 在旧港 ' }])
  assert.equal(actions[0].关于, 'B')
  assert.equal(actions[0].栏目, '位置')
  assert.equal(actions[0].值, '在旧港')
})

test('序号写成字符串也认', () => {
  const actions = parseWritePayload([{ 关于: 'B', 栏目: '位置', 值: '在旧港', 序号: '3' }])
  assert.equal(actions[0].序号, 3)
})

test('序号不是正整数就不带', () => {
  const bad = parseWritePayload([{ 关于: 'B', 栏目: '位置', 值: '在旧港', 序号: 0 }])
  assert.equal(bad[0].序号, undefined)
  const worse = parseWritePayload([{ 关于: 'B', 栏目: '位置', 值: '在旧港', 序号: 'x' }])
  assert.equal(worse[0].序号, undefined)
})

// 判人/写入统一交对象：写入用 {命题:[…]}（工具 schema 是 type:'object'）
test('写入：{命题:[…]} 对象形状能解析', () => {
  const actions = parseWritePayload({
    命题: [{
      关于: 'B',
      栏目: '位置',
      值: '在旧港',
      认知: [{ 谁: 'C', 态度: '真', 来源: '自己' }],
    }],
  })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].关于, 'B')
  assert.equal(actions[0].栏目, '位置')
  assert.equal(actions[0].值, '在旧港')
  assert.equal(actions[0].认知[0].谁, 'C')
})

test('写入：空 {命题:[]} 解析成 0 条', () => {
  assert.deepEqual(parseWritePayload({ 命题: [] }), [])
})

test('写入：{} 空对象解析成 0 条（模型主动交空）', () => {
  assert.deepEqual(parseWritePayload({}), [])
})

test('写入：顶层数组仍兼容（老形状不炸）', () => {
  const actions = parseWritePayload([{ 关于: 'B', 栏目: '位置', 值: '在旧港', 认知: [] }])
  assert.equal(actions.length, 1)
})
