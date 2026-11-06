// 导出包：只有一个出入口——档案包，自带预设与字典（ADR 0050、ADR 0052）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BUNDLE_VERSION,
  FORMAT,
  buildArchiveExport,
  importBundle,
  validateBundle,
} from '../plugin/lib/exportBundle.js'

const definitions = {
  a: { name: '身份职业', prompt: '社会定位', mustRecall: false, convention: false },
  b: { name: '未了事项', prompt: '承诺与债务', mustRecall: false, convention: false },
}
const order = ['a', 'b']
const dict = { v: 1, d: ['旧港码头'], t: ['地点'] }
const snapshot = {
  v: 1,
  t: 40,
  gt: '永安三年·冬',
  p: [['p7', 0, '老陈', '']],
  c: [[1, 'p7', 'a', '在旧港当账房', 10, []]],
  pt: [['p7', 1, [[0, '']], 10]],
}
const archive = (extra = {}) => buildArchiveExport({ definitions, order, snapshot, dict, ...extra })

test('导出档案必须带条目定义——没有定义就报错（否则码没法解释）', () => {
  assert.throws(() => buildArchiveExport({ definitions: {}, order: [], snapshot, dict }), /条目定义/)
})

test('导出档案：预设、字典、人物册、轮次、时间都在包里', () => {
  const bundle = archive()
  assert.equal(bundle.format, FORMAT)
  assert.equal(bundle.version, BUNDLE_VERSION)
  assert.equal(bundle.kind, 'archive')
  assert.deepEqual(Object.keys(bundle.preset.entries), ['a', 'b'])
  assert.deepEqual(bundle.preset.order, ['a', 'b'])
  assert.deepEqual(bundle.archive.dict.d, ['旧港码头'])
  assert.deepEqual(bundle.archive.persons, snapshot.p)
  assert.equal(bundle.archive.turn, 40)
  assert.equal(bundle.archive.gt, '永安三年·冬')
})

test('完整包：带人物编号计数器、快照版本、统计信息', () => {
  const bundle = archive({ nextId: 8 })
  assert.equal(bundle.archive.nextId, 8, '不带 nextId，导入后新建人物会撞号')
  assert.equal(bundle.archive.snapshotVersion, 1)
  assert.equal(bundle.archive.stats.persons, 1)
  assert.equal(bundle.archive.stats.claims, 1)
  assert.equal(bundle.archive.stats.pointers, 1)
})

test('完整包：栏目定义原样带走（含 prompt / 两个召回标记）', () => {
  assert.deepEqual(archive().preset.entries.a, definitions.a)
})

test('校验：好包通过；不是对象 / 格式不对 / 版本太新都拒', () => {
  assert.equal(validateBundle(archive()).ok, true)
  assert.equal(validateBundle(null).ok, false)
  assert.match(validateBundle(null).reason, /不是对象|空/)
  assert.match(validateBundle({ format: 'other' }).reason, /格式/)
  assert.match(validateBundle({ format: FORMAT, version: 99 }).reason, /版本/)
})

test('校验：只认档案包——单独的预设包已经砍掉（ADR 0052）', () => {
  const presetOnly = {
    format: FORMAT,
    version: BUNDLE_VERSION,
    kind: 'preset',
    preset: { name: '我的预设', entries: definitions, order },
  }
  const result = validateBundle(presetOnly)
  assert.equal(result.ok, false)
  assert.match(result.reason, /类型|只认档案/)
})

test('校验：档案包缺预设或缺字典都拒', () => {
  const noPreset = {
    format: FORMAT,
    version: BUNDLE_VERSION,
    kind: 'archive',
    archive: { persons: [], dict: { d: [] } },
  }
  assert.match(validateBundle(noPreset).reason, /预设/)

  const noDict = {
    format: FORMAT,
    version: BUNDLE_VERSION,
    kind: 'archive',
    preset: { entries: definitions },
    archive: { persons: [] },
  }
  assert.match(validateBundle(noDict).reason, /字典/)
})

test('导入：给出人物册、字典、计数器、轮次、时间', () => {
  const result = importBundle(archive({ nextId: 8 }))
  assert.equal(result.ok, true)
  assert.deepEqual(Object.keys(result.plan.entries), ['a', 'b'])
  assert.deepEqual(result.plan.order, ['a', 'b'])
  assert.deepEqual(result.plan.persons, snapshot.p)
  assert.deepEqual(result.plan.dict.d, ['旧港码头'])
  assert.equal(result.plan.nextId, 8)
  assert.equal(result.plan.turn, 40)
  assert.equal(result.plan.gt, '永安三年·冬')
})

test('导入：当前局已经有档案时默认拒绝（免得把现有档案覆盖掉）', () => {
  const result = importBundle(archive(), { hasExisting: true })
  assert.equal(result.ok, false)
  assert.match(result.reason, /已经有档案/)
})

test('导入：玩家确认（force）之后才允许覆盖', () => {
  assert.equal(importBundle(archive(), { hasExisting: true, force: true }).ok, true)
})

test('导入：坏包直接拒，原因来自 validateBundle', () => {
  const result = importBundle({ format: 'other' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /格式/)
})

test('导入：计数器缺失时按现有编号兜底，绝不给 0', () => {
  const bundle = archive()
  delete bundle.archive.nextId
  assert.ok(importBundle(bundle).plan.nextId >= 2)
})

test('导出的东西能 JSON 序列化再解析回来，内容不丢', () => {
  const bundle = archive()
  const round = JSON.parse(JSON.stringify(bundle))
  assert.deepEqual(round, bundle)
  assert.equal(validateBundle(round).ok, true)
})
