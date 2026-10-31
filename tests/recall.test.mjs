// 召回打分（设计稿 §7.10）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MATCH,
  SAME_NAME_GAP,
  TIER,
  clueScore,
  consistencyScore,
  matchScore,
  priorScore,
  recencyScore,
  sameNameAmbiguous,
  tierOf,
  totalScore,
} from '../plugin/lib/recall.js'

test('阈值与设计稿一致', () => {
  assert.equal(TIER.full, 0.8)
  assert.equal(TIER.brief, 0.5)
  assert.equal(TIER.candidate, 0.3)
  assert.equal(SAME_NAME_GAP, 0.1)
  assert.equal(MATCH.name, 1.0)
  assert.equal(MATCH.alias, 0.9)
  assert.equal(MATCH.singleName, 0.6)
  assert.equal(MATCH.clue, 0.5)
})

test('关联线索递减累加，封顶 1.0', () => {
  assert.equal(clueScore(0), 0)
  assert.equal(clueScore(1), 0.5)
  assert.equal(clueScore(2), 0.75)
  assert.equal(clueScore(3), 0.875)
  // 递减累加永远到不了 1，只是无限接近；「封顶」保证不超 1
  assert.ok(clueScore(20) > 0.999 && clueScore(20) <= 1)
})

test('匹配：取最强的一项当底，再叠加线索，封顶 1.0', () => {
  assert.equal(matchScore(), 0)
  assert.equal(matchScore({ clues: 2 }), 0.75)
  assert.equal(matchScore({ name: true }), 1)
  assert.equal(matchScore({ alias: true }), 0.9)
  assert.equal(matchScore({ alias: true, clues: 1 }), 1)     // 0.9 + 0.5 封顶
  assert.equal(matchScore({ singleName: true }), 0.6)
  assert.equal(matchScore({ singleName: true, clues: 1 }), 1) // 0.6 + 0.5 = 1.1 封顶
})

test('一致性：对上 1 条 0.4、2 条 0.7、3 条以上 1.0，一条都没有是 0', () => {
  assert.equal(consistencyScore(0), 0)
  assert.equal(consistencyScore(1), 0.4)
  assert.equal(consistencyScore(2), 0.7)
  assert.equal(consistencyScore(3), 1)
  assert.equal(consistencyScore(9), 1)
})

test('先验：关键度在全册中的分位', () => {
  const all = [1, 2, 3]
  assert.equal(priorScore(1, all), 0)
  assert.equal(priorScore(2, all), 0.5)
  assert.equal(priorScore(3, all), 1)
  assert.equal(priorScore(5, [5]), 1)      // 只有一个人
  assert.equal(priorScore(5, []), 1)
})

test('时效：每差 1 轮衰减约 1%', () => {
  assert.equal(recencyScore(10, 10), 1)
  assert.ok(Math.abs(recencyScore(110, 10) - Math.exp(-1)) < 1e-9)
  assert.equal(recencyScore(10, 20), 1)    // 轮次比上次还早时按 0 差处理，不放大
})

test('总分是四项等权平均', () => {
  assert.equal(totalScore({ match: 1, consistency: 1, prior: 1, recency: 1 }), 1)
  assert.equal(totalScore({ match: 1, consistency: 0, prior: 0, recency: 0 }), 0.25)
  assert.equal(totalScore({}), 0)
})

test('分档：0.80 全量、0.50 简版、0.30 候选、以下不召回', () => {
  assert.equal(tierOf(0.8), 'full')
  assert.equal(tierOf(0.79), 'brief')
  assert.equal(tierOf(0.5), 'brief')
  assert.equal(tierOf(0.49), 'candidate')
  assert.equal(tierOf(0.3), 'candidate')
  assert.equal(tierOf(0.29), 'none')
})

test('只靠单字名命中时，最多到候选，不真召回（单字名规则）', () => {
  assert.equal(tierOf(0.9), 'full')
  assert.equal(tierOf(0.9, { weakOnly: true }), 'candidate')
  assert.equal(tierOf(0.2, { weakOnly: true }), 'none')
})

test('同名消歧：分差小于 0.10 视为分不清', () => {
  assert.equal(sameNameAmbiguous(0.8, 0.85), true)
  assert.equal(sameNameAmbiguous(0.8, 0.9), false)
  assert.equal(sameNameAmbiguous(0.5, 0.4), false)
})
