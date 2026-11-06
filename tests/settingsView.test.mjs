// 设置界面：字段元数据 + 改值校验（§8.6）
//
// 界面只负责画，字段说明、范围、选项都在这里；改值也在这里夹紧——
// 玩家手滑输入 99999，不能让它流进算法里。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GROUP_SCOPE, applySettingPatch, describeSettings, findSetting, parseNumberInput } from '../plugin/lib/settingsView.js'
import { DEFAULT_SETTINGS, resolveSettings } from '../plugin/lib/settings.js'

test('全部设置都是全局级一段（首次离场也已并入，ADR 0096）', () => {
  const sections = describeSettings(resolveSettings())
  assert.equal(sections.length, 1, `应该只剩全局一段，实际 ${sections.length} 段`)
  assert.deepEqual(sections.map((s) => s.scope), ['global'])
  for (const section of sections) {
    assert.ok(section.title, '段要有标题')
    assert.ok(section.hint, '段要有说明')
    assert.ok(section.groups.length, `${section.title} 下面是空的`)
    for (const group of section.groups) {
      assert.ok(group.title, '分组要有标题')
      assert.ok(Array.isArray(group.items) && group.items.length, `${group.title} 没有条目`)
    }
  }
  const all = sections.flatMap((section) => section.groups.flatMap((group) => group.items))
  assert.ok(all.length >= 15, `一共只列了 ${all.length} 项`)
})

test('每一项都带：路径、标签、控件类型、当前值、默认值、说明', () => {
  const sections = describeSettings(resolveSettings())
  const all = sections.flatMap((section) => section.groups.flatMap((group) => group.items))
  for (const item of all) {
    assert.ok(item.label, `${item.path} 缺标签`)
    assert.ok(['switch', 'number', 'select', 'text', 'list', 'codes'].includes(item.type), `${item.path} 类型不对`)
    assert.notEqual(item.value, undefined, `${item.path} 没有当前值`)
    assert.notEqual(item.default, undefined, `${item.path} 没有默认值`)
    assert.ok(item.hint, `${item.path} 缺说明`)
    if (item.type === 'number') {
      assert.equal(typeof item.min, 'number', `${item.path} 缺 min`)
      assert.equal(typeof item.max, 'number', `${item.path} 缺 max`)
    }
    if (item.type === 'select') {
      assert.ok(Array.isArray(item.options) && item.options.length, `${item.path} 缺选项`)
    }
  }
})

test('findSetting 能按路径取到单项；不存在的路径返回 null', () => {
  const item = findSetting('recall.cooldownTurns')
  assert.ok(item)
  assert.equal(item.type, 'number')
  assert.equal(item.min, 0)
  assert.equal(item.max, 20)
  assert.equal(findSetting('不存在的路径'), null)
})

test('describeSettings 会把默认值一并带出来（界面用来显示「已改过」）', () => {
  const settings = resolveSettings()
  const sections = describeSettings(settings, DEFAULT_SETTINGS)
  const groups = sections.flatMap((section) => section.groups)
  const item = groups.flatMap((group) => group.items).find((entry) => entry.path === 'firstExit.fuzzyTurns')
  assert.equal(item.value, 3)
  assert.equal(item.default, DEFAULT_SETTINGS.firstExit.fuzzyTurns)
})

test('改值：数字超出范围会被夹到边界', () => {
  const next = applySettingPatch(resolveSettings(), { 'recall.cooldownTurns': 999 })
  assert.equal(next.recall.cooldownTurns, 20)
  const low = applySettingPatch(resolveSettings(), { 'recall.cooldownTurns': -5 })
  assert.equal(low.recall.cooldownTurns, 0)
})

test('改值：数字不是数字就当没改', () => {
  const before = resolveSettings()
  const next = applySettingPatch(before, { 'recall.budgetChars': 'abc' })
  assert.equal(next.recall.budgetChars, before.recall.budgetChars)
})

test('改值：下拉只接受合法选项，非法值忽略', () => {
  const ok = applySettingPatch(resolveSettings(), { 'writeback.mode': 'off' })
  assert.equal(ok.writeback.mode, 'off')
  const bad = applySettingPatch(resolveSettings(), { 'writeback.mode': '乱写' })
  assert.equal(bad.writeback.mode, 'background')
})

test('改值：开关只接受布尔，字符串 true/false 也认', () => {
  assert.equal(applySettingPatch(resolveSettings(), { 'recall.cooldownOn': false }).recall.cooldownOn, false)
  assert.equal(applySettingPatch(resolveSettings(), { 'recall.cooldownOn': 'false' }).recall.cooldownOn, false)
  assert.equal(applySettingPatch(resolveSettings(), { 'recall.cooldownOn': 'true' }).recall.cooldownOn, true)
  assert.equal(applySettingPatch(resolveSettings(), { 'recall.cooldownOn': '啥' }).recall.cooldownOn, true)
})

test('改值：不认识的键直接忽略，不往设置里塞垃圾', () => {
  const next = applySettingPatch(resolveSettings(), { '乱写的键': 1, 'a.b.c': 2 })
  assert.equal(next['乱写的键'], undefined)
  assert.equal(next.a, undefined)
})

test('改值：不修改传进来的对象（纯函数）', () => {
  const before = resolveSettings()
  const snapshot = structuredClone(before)
  applySettingPatch(before, { 'recall.budgetChars': 1200 })
  assert.deepEqual(before, snapshot)
})

test('多选型：设置页不再有勾选栏目这一项（挪到预设表里了）', () => {
  const all = describeSettings(resolveSettings()).flatMap((section) =>
    section.groups.flatMap((group) => group.items),
  )
  assert.ok(!all.some((item) => item.type === 'codes'), '不该再有 codes 型的设置项')
})

// 「本局勾选哪些栏目」设置组已删（2026-11-05）：预设表里每个栏目本来就有勾选框，
// 两处改同一份 checkedCodes，重复且容易让人以为不是一回事。
test('设置里不再有「本局勾选哪些栏目」这一组', () => {
  const all = describeSettings(resolveSettings()).flatMap((section) =>
    section.groups.flatMap((group) => group.items),
  )
  assert.deepEqual(all.filter((item) => item.path === 'checkedCodes').map((item) => item.path), [])
})

// 容量组已删（ADR 0079）：快照和整局数据都写自持区文件，酒馆里只剩几十字节的指针，
// 没有"快满了"这回事。这两项以前就没人读——是纯死设置。
test('设置里不再有容量组', () => {
  const all = describeSettings(resolveSettings()).flatMap((section) =>
    section.groups.flatMap((group) => group.items),
  )
  const left = all.filter((item) => item.path.startsWith('capacity.'))
  assert.deepEqual(left.map((item) => item.path), [], '容量项应该全删了')
  const groups = describeSettings(resolveSettings()).flatMap((section) => section.groups)
  assert.ok(!groups.some((group) => group.title === '容量'), '不该再有「容量」这一组')
})

test('旧存档里残留的 capacity 字段不影响运行', () => {
  // 删了默认值之后，老数据里的 capacity 只是被忽略，不该让面板炸掉
  const settings = resolveSettings({ capacity: { hintPercent: 60, keepTurnsOnCompact: 10 } })
  const sections = describeSettings(settings)
  assert.ok(sections.length >= 1, '全局级一段还在')
  const all = sections.flatMap((section) => section.groups.flatMap((group) => group.items))
  assert.ok(all.length >= 15, '其他设置项还在')
})

// ---------- 数值输入：前端和后端共用同一把尺子 ----------
// 以前两个毛病：① 输入框清空后 Number('') 是 0，会被当成"玩家想设成 0"；
// ② Number('0x10') 是 16，绕过了肉眼以为的数字校验。

test('数值输入：空串不是 0，判不合法（好让界面恢复原值）', () => {
  assert.equal(parseNumberInput('', { min: 1, max: 10 }).ok, false)
  assert.equal(parseNumberInput('   ', { min: 1, max: 10 }).ok, false)
  assert.equal(parseNumberInput(null, { min: 1, max: 10 }).ok, false)
})

test('数值输入：超出上下限就夹到边界', () => {
  assert.deepEqual(parseNumberInput('99999', { min: 500, max: 6000 }), { ok: true, value: 6000 })
  assert.deepEqual(parseNumberInput('0', { min: 1, max: 10 }), { ok: true, value: 1 })
  assert.deepEqual(parseNumberInput('-5', { min: 0, max: 20 }), { ok: true, value: 0 })
})

test('数值输入：小数四舍五入到整数', () => {
  assert.deepEqual(parseNumberInput('3.6', { min: 1, max: 10 }), { ok: true, value: 4 })
  assert.deepEqual(parseNumberInput('3.4', { min: 1, max: 10 }), { ok: true, value: 3 })
})

test('数值输入：不是纯数字的一律不合法（含科学计数法与十六进制）', () => {
  for (const bad of ['abc', '1e999', '0x10', '12abc', '1,000', '--5', '1.2.3', '+5', '5-']) {
    assert.equal(parseNumberInput(bad, { min: 0, max: 100 }).ok, false, `「${bad}」不该通过`)
  }
})

test('数值输入：前后空格容忍（手滑多敲一个空格不算错）', () => {
  assert.deepEqual(parseNumberInput(' 5 ', { min: 0, max: 100 }), { ok: true, value: 5 })
})

test('数值输入：没给 min/max 就不设上下限，但仍是整数', () => {
  assert.deepEqual(parseNumberInput('7', {}), { ok: true, value: 7 })
  assert.deepEqual(parseNumberInput('7.5', {}), { ok: true, value: 8 })
})

test('数值输入：非法值带回原因（界面能提示，不是静默吞掉）', () => {
  const result = parseNumberInput('abc', { min: 0, max: 10 })
  assert.equal(result.ok, false)
  assert.equal(typeof result.reason, 'string')
  assert.ok(result.reason.length > 0)
})

// ---------- 认知组（P20） ----------
// 四项都是全局级；界面按 schema 自动画，所以元数据写错就等于界面错。

test('认知组：一条全局级分组，四条，排在「改名」之后', () => {
  const groups = describeSettings(resolveSettings()).flatMap((section) => section.groups)
  const index = groups.findIndex((group) => group.title === '认知')
  assert.ok(index > 0, '要有「认知」这一组')
  assert.equal(groups[index - 1].title, '改名', '「认知」放在「改名」组之后')
  assert.equal(groups[index].scope, 'global')
  assert.ok(groups[index].hint, '分组要有说明')
  assert.deepEqual(groups[index].items.map((item) => item.path), [
    'cognition.defaultAttitude',
    'cognition.eyewitnessTrue',
    'cognition.conflictDisplay',
    'cognition.maxOtherSources',
  ])
  assert.equal(GROUP_SCOPE.cognition, 'global')
})

test('认知组：两个下拉的选项值与默认值对得上', () => {
  const attitude = findSetting('cognition.defaultAttitude')
  assert.equal(attitude.type, 'select')
  assert.deepEqual(attitude.options.map((option) => option.value), ['未定', '真', '假'])

  const display = findSetting('cognition.conflictDisplay')
  assert.equal(display.type, 'select')
  assert.deepEqual(display.options.map((option) => option.value), ['all', 'self', 'latest'])
})

test('认知组：亲见是开关，来源组上限是 1～8 的数字', () => {
  assert.equal(findSetting('cognition.eyewitnessTrue').type, 'switch')
  const number = findSetting('cognition.maxOtherSources')
  assert.equal(number.type, 'number')
  assert.equal(number.min, 1)
  assert.equal(number.max, 8)
})

test('认知组：改值走同一把尺子（夹紧 + 非法选项忽略）', () => {
  const base = resolveSettings()
  assert.equal(applySettingPatch(base, { 'cognition.maxOtherSources': 0 }).cognition.maxOtherSources, 1)
  assert.equal(applySettingPatch(base, { 'cognition.maxOtherSources': 99 }).cognition.maxOtherSources, 8)
  assert.equal(applySettingPatch(base, { 'cognition.maxOtherSources': 5 }).cognition.maxOtherSources, 5)
  assert.equal(applySettingPatch(base, { 'cognition.defaultAttitude': '假' }).cognition.defaultAttitude, '假')
  assert.equal(applySettingPatch(base, { 'cognition.defaultAttitude': '乱写' }).cognition.defaultAttitude, '未定')
  assert.equal(applySettingPatch(base, { 'cognition.eyewitnessTrue': 'false' }).cognition.eyewitnessTrue, false)
})

test('改值走同一把尺子：超范围被夹紧，空串不改', () => {
  const settings = resolveSettings()
  const clamped = applySettingPatch(settings, { 'recall.budgetChars': 999999 })
  assert.equal(clamped.recall.budgetChars, 6000)
  const untouched = applySettingPatch(settings, { 'recall.budgetChars': '' })
  assert.equal(untouched.recall.budgetChars, settings.recall.budgetChars, '空串不该把值改成 0')
})

// 两个跨插件开关先隐藏（2026-11-06 用户要求）。
// 事实：crossPluginRead / crossPluginWrite 只出现在设置定义与渲染里，**没有任何业务逻辑读过**，
// 点了也不生效。所以隐藏它们没有任何功能损失；定义留着，以后要恢复把 hidden 去掉即可。
test('可见性：两个跨插件开关不出现在面板上，其余照常', () => {
  const sections = describeSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS)
  const paths = sections.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.path)))
  assert.ok(!paths.includes('visibility.crossPluginRead'), '跨插件读不该再出现')
  assert.ok(!paths.includes('visibility.crossPluginWrite'), '跨插件写不该再出现')
  assert.ok(paths.includes('visibility.toolFollows'), '查询工具那个开关要留着')
})

test('可见性：隐藏后组里只剩查询工具一项，且标题还在', () => {
  const sections = describeSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS)
  const group = sections.flatMap((s) => s.groups).find((g) => g.title === '可见性')
  assert.ok(group, '可见性这一组要留着')
  assert.deepEqual(group.items.map((i) => i.path), ['visibility.toolFollows'])
})

test('可见性：隐藏只影响展示，findSetting 仍能按路径找到它们', () => {
  assert.ok(findSetting('visibility.crossPluginRead'), '定义要保留，方便以后恢复')
  assert.ok(findSetting('visibility.crossPluginWrite'))
})

// 分组名从「首次离场」改成「离场」（2026-11-06 用户要求）。
test('设置分组：这一组叫「离场」，不再叫「首次离场」', () => {
  const sections = describeSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS)
  const titles = sections.flatMap((s) => s.groups.map((g) => g.title))
  assert.ok(titles.includes('离场'), '要有「离场」这一组')
  assert.ok(!titles.includes('首次离场'), '不该再叫「首次离场」')
})

// 「离场」组里两个没接线的开关也隐藏（2026-11-06 用户选 A）。
// 查证：firstExit.mode / firstExit.nominationTurns 只出现在设置页渲染代码里，
// 没有任何业务逻辑读过——选自动还是手动，程序行为完全一样。
// 只有 fuzzyTurns 是真的在起作用（fuzzyLeaveIds 用它判连续 N 轮没露面）。
test('离场组：只留「模糊离场判定轮数」，另外两项隐藏', () => {
  const sections = describeSettings(DEFAULT_SETTINGS, DEFAULT_SETTINGS)
  const group = sections.flatMap((s) => s.groups).find((g) => g.title === '离场')
  assert.ok(group, '「离场」这一组要留着')
  assert.deepEqual(group.items.map((i) => i.path), ['firstExit.fuzzyTurns'], '只留真正起作用的那一项')
})

test('离场组：隐藏只影响展示，定义仍在（findSetting 找得到）', () => {
  assert.ok(findSetting('firstExit.mode'), 'mode 定义要保留')
  assert.ok(findSetting('firstExit.nominationTurns'), 'nominationTurns 定义要保留')
  assert.ok(findSetting('firstExit.fuzzyTurns'))
})
