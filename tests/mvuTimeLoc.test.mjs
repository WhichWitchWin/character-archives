// MVU 映射收敛（2026-11-05）：人物字段映射退役，只留「时间来源／地点来源」两个兜底。
//
// 兜底的意思：程序先按卡的通用形状自己抓；**抓不到**才用玩家指定的字段。
// 自己抓到了就绝不覆盖——否则玩家随手选一个字段，反而会把好数据顶掉。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { extractGt, extractLoc, listLeafPaths, parseMvu, pickPath } from '../plugin/lib/mvu.js'

// ── 路径枚举：给面板下拉用 ──

test('路径枚举：摊出所有叶子路径，跳过人物数组', () => {
  const statData = {
    时间: { 日期: '永安三年·冬', 时刻: '申时' },
    地点: { 城市: '临安', 区域: '旧港' },
    人物: [{ 名字: '老陈' }],
  }
  assert.deepEqual(
    listLeafPaths(statData).map((item) => item.path).sort(),
    ['地点.城市', '地点.区域', '时间.日期', '时间.时刻'].sort(),
  )
})

test('路径枚举：纯数字也算叶子（有些卡的时间就是数字）', () => {
  const statData = { 世界: { 第几天: 12 } }
  assert.deepEqual(listLeafPaths(statData).map((item) => item.path), ['世界.第几天'])
})

test('按路径取值：字符串、数字都认，取不到给空串', () => {
  const statData = { 世界: { 时间: '三年五月', 天数: 12 } }
  assert.equal(pickPath(statData, '世界.时间'), '三年五月')
  assert.equal(pickPath(statData, '世界.天数'), '12')
  assert.equal(pickPath(statData, '世界.没有'), '')
  assert.equal(pickPath(statData, ''), '')
  assert.equal(pickPath(null, '世界.时间'), '')
})

// ── 时间兜底 ──

test('时间：自己抓得到时，玩家选的字段不生效（别顶掉好数据）', () => {
  const statData = { 时间: { 日期: '三年五月' }, 世界: { 当前时间: '别的时间' } }
  assert.equal(extractGt(statData, '世界.当前时间'), '三年五月')
})

test('时间：自己抓不到才用玩家选的字段', () => {
  const statData = { 世界: { 当前时间: '三年五月' } }
  assert.equal(extractGt(statData, '世界.当前时间'), '三年五月')
})

test('时间：什么都没选、也抓不到 → 空串（不编造）', () => {
  assert.equal(extractGt({ 世界: { 当前时间: '三年五月' } }), '')
  assert.equal(extractGt({}), '')
})

// ── 地点兜底 ──

test('地点：自己抓得到时（对象拼成 ·），玩家选的不生效', () => {
  const statData = { 地点: { 城市: '临安', 区域: '旧港' }, 世界: { 位置: '别处' } }
  assert.equal(extractLoc(statData, '世界.位置'), '临安·旧港')
})

test('地点：自己抓不到才用玩家选的字段', () => {
  const statData = { 世界: { 位置: '临安·旧港·码头' } }
  assert.equal(extractLoc(statData, '世界.位置'), '临安·旧港·码头')
})

test('地点：字符串形状照旧', () => {
  assert.equal(extractLoc({ 地点: '临安' }), '临安')
})

// ── 接进 parseMvu：一张卡两样都靠映射 ──

test('parseMvu：整张卡没有 时间／地点 时，两个兜底一起生效', () => {
  const variables = {
    stat_data: {
      世界: { 当前时间: '三年五月', 位置: '临安·旧港' },
      在场: ['老陈'],
    },
  }
  const parsed = parseMvu(variables, { timePath: '世界.当前时间', locPath: '世界.位置' })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.gt, '三年五月')
  assert.equal(parsed.loc, '临安·旧港')
})

test('parseMvu：不传映射时行为不变（回归）', () => {
  const parsed = parseMvu({ stat_data: { 时间: { 日期: '三年五月' }, 地点: '旧港' } })
  assert.equal(parsed.gt, '三年五月')
  assert.equal(parsed.loc, '旧港')
})
