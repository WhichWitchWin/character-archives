import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_SETTINGS, resolveSettings } from '../plugin/lib/settings.js'

test('默认值与设计稿 §8.6 一致', () => {
  assert.equal(DEFAULT_SETTINGS.firstExit.mode, 'auto')
  assert.equal(DEFAULT_SETTINGS.firstExit.nominationTurns, 5)
  assert.equal(DEFAULT_SETTINGS.firstExit.fuzzyTurns, 3)
  assert.equal(DEFAULT_SETTINGS.confidence.enabled, true)
  assert.equal(DEFAULT_SETTINGS.confidence.reopenAs, '7')
  assert.deepEqual(DEFAULT_SETTINGS.confidence.closeOrder, ['turn', 'salience', 'truth', 'source'])
  assert.equal(DEFAULT_SETTINGS.recall.budgetChars, 2000)
  assert.equal(DEFAULT_SETTINGS.recall.level, 'mixed')
  assert.equal(DEFAULT_SETTINGS.recall.algorithm, 'equal-weight')
  assert.equal(DEFAULT_SETTINGS.recall.cooldownTurns, 10)
  assert.equal(DEFAULT_SETTINGS.capacity.keepTurnsOnCompact, 10)
  assert.equal(DEFAULT_SETTINGS.notice.detail, 'standard')
})

test('没保存过时返回一份默认值', () => {
  assert.deepEqual(resolveSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(resolveSettings(undefined), DEFAULT_SETTINGS)
})

test('只覆盖给出过的字段，其余回落默认', () => {
  const settings = resolveSettings({ recall: { budgetChars: 1200 } })
  assert.equal(settings.recall.budgetChars, 1200)
  assert.equal(settings.recall.level, 'mixed')          // 未给出的保持默认
  assert.equal(settings.firstExit.fuzzyTurns, 3)        // 别的区块不受影响
})

test('返回的是深拷贝，改它不会污染默认值', () => {
  const settings = resolveSettings(null)
  settings.recall.budgetChars = 1
  settings.firstExit.mode = 'manual'
  assert.equal(DEFAULT_SETTINGS.recall.budgetChars, 2000)
  assert.equal(DEFAULT_SETTINGS.firstExit.mode, 'auto')
})
