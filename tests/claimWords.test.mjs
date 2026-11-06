// 索引词搬到命题上（ADR 0081「索引词跟着命题走」）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CLAIM_WORDS_INDEX,
  wordsOfClaim,
  withClaimWords,
  collectWordsFromClaims,
} from '../plugin/lib/indexWords.js'

const claim = (words = undefined) => {
  const row = [1, 'p7', 'a', '在旧港码头', 3]
  if (words !== undefined) row[CLAIM_WORDS_INDEX] = words
  return row
}

test('索引词在命题里是第 6 位', () => {
  assert.equal(CLAIM_WORDS_INDEX, 5)
})

test('wordsOfClaim 读出索引词并规整成 {词, 类}', () => {
  const row = claim([{ 词: '旧港', 类: '地' }, '码头'])
  assert.deepEqual(wordsOfClaim(row), [
    { 词: '旧港', 类: '地' },
    { 词: '码头', 类: null },
  ])
})

test('wordsOfClaim 去重、丢掉空词', () => {
  const row = claim([{ 词: '旧港' }, { 词: '旧港', 类: '地' }, '', null])
  assert.deepEqual(wordsOfClaim(row), [{ 词: '旧港', 类: null }])
})

test('wordsOfClaim 没有索引词时返回空数组', () => {
  assert.deepEqual(wordsOfClaim(claim()), [])
  assert.deepEqual(wordsOfClaim(null), [])
})

test('withClaimWords 写到第 6 位，不改原命题', () => {
  const row = claim()
  const next = withClaimWords(row, [{ 词: '旧港', 类: '地' }])
  assert.deepEqual(next[CLAIM_WORDS_INDEX], [{ 词: '旧港', 类: '地' }])
  assert.equal(row[CLAIM_WORDS_INDEX], undefined)
})

test('withClaimWords 空词时把第 6 位清掉', () => {
  const row = claim([{ 词: '旧港', 类: '地' }])
  const next = withClaimWords(row, [])
  assert.equal(next[CLAIM_WORDS_INDEX], undefined)
})

test('collectWordsFromClaims 只收该人物的命题', () => {
  const claims = [
    [1, 'p7', 'a', '在旧港码头', 3, [{ 词: '旧港', 类: '地' }]],
    [2, 'p12', 'a', '在码头', 4, [{ 词: '码头', 类: '地' }]],
  ]
  assert.deepEqual([...collectWordsFromClaims({ claims, personId: 'p7' })], ['旧港'])
})

test('collectWordsFromClaims 跳过未勾选的栏目', () => {
  const claims = [
    [1, 'p7', 'a', '在旧港码头', 3, [{ 词: '旧港', 类: '地' }]],
    [2, 'p7', 'b', '账房先生', 3, [{ 词: '账房', 类: '物件' }]],
  ]
  const words = collectWordsFromClaims({ claims, personId: 'p7', checkedCodes: new Set(['a']) })
  assert.deepEqual([...words], ['旧港'])
})

