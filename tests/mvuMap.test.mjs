// MVU 字段发现（2026-11-05 收窄）
//
// 「人物字段抄进档案」整套已退役（ADR 0091）：模型每轮读正文写命题＋指针，
// MVU 再抄一遍只会两边打架。这里只剩"把 stat_data 里的人物字段摊平"——
// 面板用它解释"为什么一个字段都没认出来"。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { listPersonFields } from '../plugin/lib/mvuMap.js'

const statData = {
  时间: { 日期: '永安三年·冬' },
  地点: { 城市: '临安', 场所: '码头' },
  神: { 暴露度: 3 },
  人物: [
    { 名字: '老陈', 身份: '账房', 关系: '旧友', 好感: '60', 冷却: { 关系: 0 } },
    { 名字: '林昭', 身份: '学徒', 关系: '同乡' },
  ],
  在场: ['老陈'],
}

test('摊平：只列人物里的简单值字段，跳过名字与嵌套对象', () => {
  const fields = listPersonFields(statData)
  assert.deepEqual(fields.map((f) => f.key).sort(), ['关系', '好感', '身份'].sort())
  const identity = fields.find((f) => f.key === '身份')
  assert.equal(identity.sample, '账房')
  assert.equal(identity.count, 2, '两个人都有的字段')
})