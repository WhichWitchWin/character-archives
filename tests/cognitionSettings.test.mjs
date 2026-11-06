// 认知口径（P20）：模型拿不准时给什么态度、亲见算不算真、一件事显示几种说法、来源组上限。
//
// 为什么单独一个文件：这四项都是**全局级**、都影响注入给模型的文本，
// 跟「召回预算」那种只管长度的设置不是一类，放一起容易看漏。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_SETTINGS, SCOPE, resolveSettings, splitSettings } from '../plugin/lib/settings.js'

test('认知组默认值：未定 / 亲见不自动算真 / 全显示 / 最多 3 个别人来源', () => {
  assert.equal(DEFAULT_SETTINGS.cognition.defaultAttitude, '未定')
  // 2026-11-06：默认改成关——亲见不自动算真，让模型按正文里他自己的表现判断信不信
  assert.equal(DEFAULT_SETTINGS.cognition.eyewitnessTrue, false)
  assert.equal(DEFAULT_SETTINGS.cognition.conflictDisplay, 'all')
  assert.equal(DEFAULT_SETTINGS.cognition.maxOtherSources, 3)
})

test('认知组只有这四项（不留没人读的死设置）', () => {
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS.cognition).sort(), [
    'conflictDisplay',
    'defaultAttitude',
    'eyewitnessTrue',
    'maxOtherSources',
  ])
})

test('认知组是全局级：所有局、所有卡共用一份', () => {
  assert.equal(SCOPE.cognition, 'global')
  const parts = splitSettings({ cognition: { conflictDisplay: 'self' } })
  assert.deepEqual(parts.global.cognition, { conflictDisplay: 'self' })
  assert.deepEqual(parts.game, {})
  assert.deepEqual(parts.card, {})
})

test('resolveSettings 叠默认：只覆盖给出过的字段，其余回落默认', () => {
  const settings = resolveSettings({ cognition: { defaultAttitude: '真' } })
  assert.equal(settings.cognition.defaultAttitude, '真')
  assert.equal(settings.cognition.eyewitnessTrue, false)
  assert.equal(settings.cognition.conflictDisplay, 'all')
  assert.equal(settings.cognition.maxOtherSources, 3)
  // 别的组不受影响
  assert.equal(settings.recall.budgetChars, 3000)
})

test('没保存过时认知组是默认的一份深拷贝，改了不污染默认值', () => {
  const settings = resolveSettings(null)
  assert.deepEqual(settings.cognition, DEFAULT_SETTINGS.cognition)
  settings.cognition.maxOtherSources = 8
  assert.equal(DEFAULT_SETTINGS.cognition.maxOtherSources, 3)
})
