// MVU 字段发现（2026-11-05 收窄）：
// 「人物字段抄进档案」整套已退役（ADR 0091），只剩"认卡里有哪些人物字段"——
// 用来在面板上把卡的形状摊给玩家看，解释"为什么一个字段都没认出来"。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { listPersonFields, surveyStatData } from '../plugin/lib/mvuMap.js'

test('字段发现：人物是对象（键＝人名）也能列出字段', () => {
  const statData = {
    人物: {
      老陈: { 身份: '账房', 好感: 30 },
      李四: { 身份: '船工', 好感: 10 },
    },
  }
  assert.deepEqual(listPersonFields(statData).map((field) => field.key).sort(), ['好感', '身份'])
})

test('字段发现：人物是数组照旧', () => {
  const statData = { 人物: [{ 名字: '老陈', 身份: '账房' }] }
  assert.deepEqual(listPersonFields(statData).map((field) => field.key), ['身份'])
})

test('字段发现：名字字段不算内容字段', () => {
  const statData = { 人物: [{ 名字: '老陈', name: 'x', 身份: '账房' }] }
  assert.deepEqual(listPersonFields(statData).map((field) => field.key), ['身份'])
})

test('诊断：报出 MVU 一级键的形状，好知道为什么认不出人物', () => {
  const info = surveyStatData({ 时间: { 日期: '三年' }, 人物表: { 老陈: { 身份: 'x' } } })
  assert.deepEqual(info.keys.map((item) => item.key), ['时间', '人物表'])
  assert.equal(info.keys[1].kind, 'map')
  assert.equal(info.fields, 0)
})

test('诊断：认出来了就不用额外解释', () => {
  const info = surveyStatData({ 人物: [{ 名字: '老陈', 身份: '账房' }] })
  assert.equal(info.fields, 1)
})
