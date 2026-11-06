// MVU 解析（ADR 0005、§8.8）：时间只记录不解析、拿不到就省略
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  extractGt,
  extractLoc,
  extractPeople,
  extractPresent,
  parseMvu,
  readStatData,
} from '../plugin/lib/mvu.js'

// 按实测到的真卡结构造样例（值都是假数据）
const statData = {
  时间: { 日期: '永安三年·冬', 时刻: '申时', 时段: '傍晚' },
  地点: { 城市: '临安', 区域: '旧港', 场所: '码头' },
  人物: [
    { 名字: '老陈', 身份: '账房', 关系: '旧友', 好感: '60', 怀疑: '10', 冷却: { 关系: 0, 好感: 2 } },
    { 名字: '林昭', 身份: '学徒', 关系: '同乡', 好感: '35' },
    { 身份: '没有名字的人' },
  ],
  在场: ['老陈'],
}

test('readStatData：两层都兼容，取不到返回 null', () => {
  assert.deepEqual(readStatData({ stat_data: statData }), statData)
  assert.deepEqual(readStatData(statData), statData)     // 直接摊在 variables 上
  assert.equal(readStatData(null), null)
  assert.equal(readStatData({}), null)
  assert.equal(readStatData({ 别的东西: 1 }), null)
})

test('时间：原样拼，不解析；日期里已含时刻就不重复', () => {
  assert.equal(extractGt(statData), '永安三年·冬 申时 傍晚')
  assert.equal(extractGt({ 时间: { 日期: '三年五月十二日 申时', 时刻: '申时' } }), '三年五月十二日 申时')
  assert.equal(extractGt({ 时间: { 日期: '永安三年·冬' } }), '永安三年·冬')
  assert.equal(extractGt({}), '')
  assert.equal(extractGt(null), '')
})

test('在场名单：字符串数组；对象数组也认；空的给空数组', () => {
  assert.deepEqual(extractPresent(statData), ['老陈'])
  assert.deepEqual(extractPresent({ 在场: [{ 名字: '老陈' }, '林昭'] }), ['老陈', '林昭'])
  assert.deepEqual(extractPresent({}), [])
  assert.deepEqual(extractPresent(null), [])
})

test('人物：每人取名字，字段原样带出；没名字的跳过；嵌套对象跳过', () => {
  const people = extractPeople(statData)
  assert.deepEqual(people.map((p) => p.name), ['老陈', '林昭'])
  assert.equal(people[0].fields.身份, '账房')
  assert.equal(people[0].fields.好感, '60')
  assert.equal(people[0].fields.冷却, undefined, '嵌套对象这一版不抄')
})

test('parseMvu：一次取三样；没有 stat_data 时 ok=false 且全空', () => {
  const result = parseMvu({ stat_data: statData })
  assert.equal(result.ok, true)
  assert.equal(result.gt, '永安三年·冬 申时 傍晚')
  assert.deepEqual(result.present, ['老陈'])
  assert.equal(result.people.length, 2)

  const none = parseMvu({})
  assert.equal(none.ok, false)
  assert.deepEqual(none.people, [])
  assert.equal(none.gt, '')
})

test('地点：对象就拼起来，字符串直接用，没有给空串', () => {
  assert.equal(extractLoc({ 地点: { 城市: '临安', 区域: '旧港', 场所: '码头' } }), '临安·旧港·码头')
  assert.equal(extractLoc({ 地点: { 场所: '码头' } }), '码头')
  assert.equal(extractLoc({ 地点: '旧港码头' }), '旧港码头')
  assert.equal(extractLoc({}), '')
  assert.equal(extractLoc(null), '')
})

test('parseMvu 顺带把地点也取出来', () => {
  assert.equal(parseMvu({ stat_data: statData }).loc, '临安·旧港·码头')
})
