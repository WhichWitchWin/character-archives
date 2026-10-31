import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_SETTINGS,
  WRITEBACK_MODES,
  WRITEBACK_SUMMARY,
  WRITEBACK_TITLE,
  resolveSettings,
  writebackMode,
} from '../plugin/lib/settings.js'

test('默认值与设计稿 §8.6 一致', () => {
  assert.equal(DEFAULT_SETTINGS.firstExit.mode, 'auto')
  assert.equal(DEFAULT_SETTINGS.firstExit.nominationTurns, 3)
  assert.equal(DEFAULT_SETTINGS.firstExit.fuzzyTurns, 3)
  assert.equal(DEFAULT_SETTINGS.confidence.enabled, true)
  assert.equal(DEFAULT_SETTINGS.confidence.reopenAs, '7')
  assert.deepEqual(DEFAULT_SETTINGS.confidence.closeOrder, ['turn', 'salience', 'truth', 'source'])
  assert.equal(DEFAULT_SETTINGS.recall.budgetChars, 3000)
  assert.equal(DEFAULT_SETTINGS.recall.budgetMin, 500)
  assert.equal(DEFAULT_SETTINGS.recall.budgetMax, 6000)
  assert.equal(DEFAULT_SETTINGS.recall.level, 'mixed')
  assert.equal(DEFAULT_SETTINGS.recall.algorithm, 'equal-weight')
  assert.equal(DEFAULT_SETTINGS.recall.cooldownTurns, 10)
  assert.equal(DEFAULT_SETTINGS.capacity.keepTurnsOnCompact, 10)
  assert.equal(DEFAULT_SETTINGS.notice.detail, 'standard')
})

test('档案写入方式三档，默认子代理写入（ADR 0007）', () => {
  assert.equal(DEFAULT_SETTINGS.writeback.mode, 'subagent')
  assert.equal(resolveSettings(null).writeback.mode, 'subagent')
  assert.equal(resolveSettings({ writeback: { mode: 'background' } }).writeback.mode, 'background')
  assert.equal(resolveSettings({ writeback: { mode: 'off' } }).writeback.mode, 'off')
})

test('三档都有名字、说明和优缺点，文案里写明不影响酒馆的变量结算', () => {
  assert.deepEqual(WRITEBACK_MODES.map((mode) => mode.id), ['subagent', 'background', 'off'])
  for (const mode of WRITEBACK_MODES) {
    assert.ok(mode.label, '要有名字')
    assert.ok(mode.detail, '要说明这一档做什么')
    assert.ok(mode.pros.length > 0, '要写优点')
    assert.ok(mode.cons.length > 0, '要写缺点')
  }
  assert.equal(WRITEBACK_TITLE, '档案写入方式')
  assert.match(WRITEBACK_SUMMARY, /不影响酒馆自己的变量结算/)
})

test('档位不认识时回落到默认档的文案', () => {
  assert.equal(writebackMode('subagent').label, '子代理写入')
  assert.equal(writebackMode('background').label, '后台写入')
  assert.equal(writebackMode('off').label, '关闭')
  assert.equal(writebackMode('不存在').id, 'subagent')
  assert.equal(writebackMode(undefined).id, 'subagent')
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
  assert.equal(DEFAULT_SETTINGS.recall.budgetChars, 3000)
  assert.equal(DEFAULT_SETTINGS.firstExit.mode, 'auto')
})
