// 条目预设库（设计稿 §8.8、ADR 0021、ADR 0044）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { APPEARANCE_NAMES, PRESET_ENTRIES, buildPresetDefinitions } from '../plugin/lib/presets.js'

test('通用预设：默认 8 条，形象包默认关闭', () => {
  const { definitions } = buildPresetDefinitions()
  assert.equal(Object.keys(definitions).length, 8)
  for (const name of APPEARANCE_NAMES) {
    assert.ok(!Object.values(definitions).some((item) => item.name === name), `不该有 ${name}`)
  }
})

test('打开形象包后加上 14 条形象条目', () => {
  const { definitions } = buildPresetDefinitions({ includeAppearance: true })
  assert.equal(Object.keys(definitions).length, 8 + 14)
  for (const name of APPEARANCE_NAMES) {
    assert.ok(Object.values(definitions).some((item) => item.name === name), `缺 ${name}`)
  }
})

test('姓名和别名不进预设——它们是人物级别的（ADR 0044、§2）', () => {
  const names = PRESET_ENTRIES.map((item) => item.name)
  assert.ok(!names.includes('姓名'))
  assert.ok(!names.includes('别名'))
})

test('每条都有：名字、抓取提示词', () => {
  const { definitions } = buildPresetDefinitions({ includeAppearance: true })
  for (const [code, item] of Object.entries(definitions)) {
    assert.ok(code, '栏目码不能为空')
    assert.ok(item.name && typeof item.name === 'string')
    assert.ok(item.prompt && typeof item.prompt === 'string')
  }
})

test('条目码不重复，且都是单字母', () => {
  const { definitions } = buildPresetDefinitions({ includeAppearance: true })
  const codes = Object.keys(definitions)
  assert.equal(new Set(codes).size, codes.length)
  for (const code of codes) assert.equal([...code].length, 1)
})

test('预设顺序稳定：order 与 definitions 的键顺序一致', () => {
  const { definitions, order } = buildPresetDefinitions()
  assert.deepEqual(order, Object.keys(definitions))
})

// 两个召回标记（ADR 0089 §4 / ADR 0087）：默认都关，玩家在预设面板勾选才开。
// 默认开的话，所有人的人事地物都会被强制执行"必带"或当成约定，预算直接爆。
test('预设定义都带 mustRecall / convention，且默认关闭', () => {
  const { definitions } = buildPresetDefinitions()
  for (const [code, item] of Object.entries(definitions)) {
    assert.equal(item.mustRecall, false, `${code} 的 mustRecall 默认该是 false`)
    assert.equal(item.convention, false, `${code} 的 convention 默认该是 false`)
  }
})
