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
import { applySettingPatch, describeSettings } from '../plugin/lib/settingsView.js'

test('默认值与设计稿 §8.6 一致', () => {
  assert.equal(DEFAULT_SETTINGS.firstExit.mode, 'auto')
  assert.equal(DEFAULT_SETTINGS.firstExit.nominationTurns, 3)
  assert.equal(DEFAULT_SETTINGS.firstExit.fuzzyTurns, 3)
  // 信度组已删（2026-11-05）：命题＋指针模型用「来源组」表达"来自谁、可不可信"，
  // 那套开关（启用／编辑算用户／编辑改真值／关闭排序／重开归为）从来没有业务代码读过
  assert.equal(DEFAULT_SETTINGS.confidence, undefined)
  assert.equal(DEFAULT_SETTINGS.recall.budgetChars, 3000)
  assert.equal(DEFAULT_SETTINGS.recall.budgetMin, 1000)
  assert.equal(DEFAULT_SETTINGS.recall.budgetMax, 6000)
  assert.equal(DEFAULT_SETTINGS.recall.cooldownTurns, 10)
  // 容量组已删（ADR 0079）：纯自持后酒馆的 256KB / 8MB 上限不再约束我们
  assert.equal(DEFAULT_SETTINGS.capacity, undefined)
  // 「提示详细程度」「调试开关」两组已删（2026-11-05）：前者从来没接线，后者从来没生效
  assert.equal(DEFAULT_SETTINGS.notice, undefined)
  assert.equal(DEFAULT_SETTINGS.debug, undefined)
})

test('档案写入方式三档，默认跟随后台（ADR 0096）', () => {
  assert.equal(DEFAULT_SETTINGS.writeback.mode, 'background')
  assert.equal(resolveSettings(null).writeback.mode, 'background')
  assert.equal(resolveSettings({ writeback: { mode: 'subagent' } }).writeback.mode, 'subagent')
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
  assert.equal(writebackMode('subagent').label, '子代理')
  assert.equal(writebackMode('background').label, '跟随后台')
  assert.equal(writebackMode('off').label, '关闭')
  assert.equal(writebackMode('不存在').id, 'background')
  assert.equal(writebackMode(undefined).id, 'background')
})

test('没保存过时返回一份默认值', () => {
  assert.deepEqual(resolveSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(resolveSettings(undefined), DEFAULT_SETTINGS)
})

test('只覆盖给出过的字段，其余回落默认', () => {
  const settings = resolveSettings({ recall: { budgetChars: 1200 } })
  assert.equal(settings.recall.budgetChars, 1200)
  assert.equal(settings.recall.cooldownTurns, 10)       // 未给出的保持默认
  assert.equal(settings.firstExit.fuzzyTurns, 3)        // 别的区块不受影响
})

test('返回的是深拷贝，改它不会污染默认值', () => {
  const settings = resolveSettings(null)
  settings.recall.budgetChars = 1
  settings.firstExit.mode = 'manual'
  assert.equal(DEFAULT_SETTINGS.recall.budgetChars, 3000)
  assert.equal(DEFAULT_SETTINGS.firstExit.mode, 'auto')
})

// ── 存储：快照保留轮数（2026-11-05）──
// 原来是硬编码 200（store.js 的 DEFAULT_KEEP_TURNS），玩家改不了。
// 下限 100：再少就没法回退到几章之前；上限 1000：50 人的局约 40MB，再多也没人退那么远。

test('存储：保留轮数默认 200、范围 100～1000', () => {
  assert.equal(DEFAULT_SETTINGS.storage.keepTurns, 200)
  const item = describeSettings(resolveSettings())
    .flatMap((section) => section.groups)
    .flatMap((group) => group.items)
    .find((entry) => entry.path === 'storage.keepTurns')
  assert.ok(item, '要有 storage.keepTurns 这一项')
  assert.equal(item.type, 'number')
  assert.equal(item.min, 100)
  assert.equal(item.max, 1000)
})

test('存储：超范围的值被夹紧，不合法的不进设置', () => {
  const base = resolveSettings()
  assert.equal(applySettingPatch(base, { 'storage.keepTurns': 50 }).storage.keepTurns, 100)
  assert.equal(applySettingPatch(base, { 'storage.keepTurns': 5000 }).storage.keepTurns, 1000)
  assert.equal(applySettingPatch(base, { 'storage.keepTurns': 300 }).storage.keepTurns, 300)
})
