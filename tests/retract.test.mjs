// 撤回指针（ADR 0102 / 0106）：模型可以说「这个人不再这么认为了」。
//
// 规矩：
//   · 撤回只写 `谁`（持指针的人＝改口的人）＋`序号`；命题说的是谁由程序按序号查（ADR 0106）
//   · 只摘**这一个人**指向那条命题的指针，别人的指针一根不动
//     （A 以为 B 去了 C 地、D 以为 B 去了 F 地，两条认知各自独立）；
//   · 摘到零指针 → 这条命题立即清掉（撤回是显式否定，不等下一轮孤儿清理）；
//   · 只认**在场人物** + **本轮素材里的序号**，其余一律拒。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseWritePayloadBundle } from '../plugin/lib/payload.js'
import { applyRetractions } from '../plugin/lib/retract.js'

const freshSnapshot = () => ({
  v: 1,
  t: 3,
  p: [['p0', 1, '小s', ''], ['p1', 1, '沈清禾', '']],
  gt: '第一天',
  loc: '',
  // 两条「最后已知去向」：1 是旧的（两人都信），2 是新的（只有她自己知道）
  c: [
    [1, 'p1', 'e', '地铁十号线车厢', 2, []],
    [2, 'p1', 'e', '国贸站B口写字楼', 3, []],
  ],
  pt: [
    ['p0', 1, [[0, '', '第一天']], 2],
    ['p1', 1, [[0, '', '第一天']], 2],
    ['p1', 2, [[0, '', '第一天']], 3],
  ],
})

const seqMap = () => new Map([[1, 1], [2, 2]])
const resolvePerson = (name) => ({ 小s: 'p0', 沈清禾: 'p1' })[name] ?? null
const present = () => new Set(['p0', 'p1'])

test('撤回：只摘这个人的指针，别人的不动', () => {
  const snapshot = freshSnapshot()
  const result = applyRetractions({
    snapshot,
    retracts: [{ 谁: '沈清禾', 序号: 1 }],
    seqMap: seqMap(),
    resolvePerson,
    allowedIds: present(),
  })

  assert.deepEqual(result.bad, [])
  assert.equal(result.applied.length, 1)
  assert.equal(result.applied[0].droppedClaim, false, '还有别人指着，命题不该删')
  const pairs = snapshot.pt.map((row) => `${row[0]}:${row[1]}`)
  assert.deepEqual(pairs, ['p0:1', 'p1:2'], '沈清禾对旧说法的指针没了，主角的还在')
  assert.equal(snapshot.c.length, 2, '命题还在')
})

// 这条是 ADR 0106 的根因用例：改动前「关于」既是持指针者又是命题主体，
// 两人同名时测不出区别；换成「主角撤他自己对沈清禾的认知」才能真正验证字段含义。
test('撤回：撤别人的指针时，摘的是那个人自己的认知，不是命题主体的', () => {
  const snapshot = freshSnapshot()
  const result = applyRetractions({
    snapshot,
    retracts: [{ 谁: '小s', 序号: 1 }],
    seqMap: seqMap(),
    resolvePerson,
    allowedIds: present(),
  })

  assert.deepEqual(result.bad, [])
  assert.equal(result.applied.length, 1)
  const pairs = snapshot.pt.map((row) => `${row[0]}:${row[1]}`)
  assert.deepEqual(pairs, ['p1:1', 'p1:2'], '摘的是主角的指针，沈清禾自己那条还在')
})

test('撤回：返回体带上「关于谁」和命题内容，供调试日志直读', () => {
  const snapshot = freshSnapshot()
  const result = applyRetractions({
    snapshot,
    retracts: [{ 谁: '小s', 序号: 1 }],
    seqMap: seqMap(),
    resolvePerson,
    allowedIds: present(),
  })

  assert.equal(result.applied[0].aboutId, 'p1', '命题说的是沈清禾')
  assert.equal(result.applied[0].claimText, '地铁十号线车厢', '内容按存储原样回传（字典下标由调用方解）')
})

test('撤回：摘到零指针时命题立即清掉（清掉也仍带得回关于谁）', () => {
  const snapshot = freshSnapshot()
  const result = applyRetractions({
    snapshot,
    retracts: [
      { 谁: '沈清禾', 序号: 1 },
      { 谁: '小s', 序号: 1 },
    ],
    seqMap: seqMap(),
    resolvePerson,
    allowedIds: present(),
  })

  assert.deepEqual(result.bad, [])
  assert.equal(result.applied.length, 2)
  assert.equal(result.applied[1].droppedClaim, true, '最后一条指针撤掉 → 命题清掉')
  assert.equal(result.applied[1].aboutId, 'p1', '命题没了也要记下「关于谁」')
  assert.deepEqual(snapshot.c.map((claim) => claim[0]), [2], '旧命题没了，新命题还在')
  assert.deepEqual(snapshot.pt.map((row) => `${row[0]}:${row[1]}`), ['p1:2'])
})

test('撤回：不在场的人不给他撤', () => {
  const snapshot = freshSnapshot()
  const result = applyRetractions({
    snapshot,
    retracts: [{ 谁: '小s', 序号: 1 }],
    seqMap: seqMap(),
    resolvePerson,
    allowedIds: new Set(['p1']),
  })

  assert.equal(result.applied.length, 0)
  assert.equal(result.bad.length, 1)
  assert.match(result.bad[0].reason, /不在场/)
  assert.equal(snapshot.pt.length, 3, '一条都没动')
})

test('撤回：序号不在本轮素材里就拒（模型看不见的东西不许动）', () => {
  const snapshot = freshSnapshot()
  const result = applyRetractions({
    snapshot,
    retracts: [{ 谁: '沈清禾', 序号: 9 }],
    seqMap: seqMap(),
    resolvePerson,
    allowedIds: present(),
  })
  assert.equal(result.applied.length, 0)
  assert.match(result.bad[0].reason, /序号/)
  assert.equal(snapshot.pt.length, 3)
})

test('撤回：他本来就没有这条认知时明确拒，不静默跳过', () => {
  const snapshot = freshSnapshot()
  const result = applyRetractions({
    snapshot,
    retracts: [{ 谁: '小s', 序号: 2 }],   // 主角没听说过「在写字楼」
    seqMap: seqMap(),
    resolvePerson,
    allowedIds: present(),
  })
  assert.equal(result.applied.length, 0)
  assert.match(result.bad[0].reason, /没有/)
})

test('撤回：人物解析不出来也要拒', () => {
  const snapshot = freshSnapshot()
  const result = applyRetractions({
    snapshot,
    retracts: [{ 谁: '查无此人', 序号: 1 }],
    seqMap: seqMap(),
    resolvePerson,
    allowedIds: present(),
  })
  assert.equal(result.applied.length, 0)
  assert.match(result.bad[0].reason, /不在档案里/)
})

test('解析：{撤回:[{谁,序号}]} 认得出来，序号字符串能转数字', () => {
  const { retracts } = parseWritePayloadBundle({ 撤回: [{ 谁: '沈清禾', 序号: '2' }] })
  assert.deepEqual(retracts, [{ 谁: '沈清禾', 序号: 2 }])
})

test('解析：只认 `谁`；带旧字段 `关于` 的不再当撤回（ADR 0106）', () => {
  const { retracts } = parseWritePayloadBundle({ 撤回: [{ 关于: '沈清禾', 序号: 1 }] })
  assert.deepEqual(retracts, [], '旧字段不再收，避免和命题的「关于」混用')
})

test('解析：序号不是正整数、或没写谁，就丢掉那一条', () => {
  const { retracts } = parseWritePayloadBundle({
    撤回: [
      { 谁: '沈清禾', 序号: 0 },
      { 谁: '沈清禾', 序号: 'x' },
      { 谁: '', 序号: 1 },
      { 谁: '沈清禾', 序号: 2 },
    ],
  })
  assert.deepEqual(retracts, [{ 谁: '沈清禾', 序号: 2 }])
})

test('解析：没有撤回块就是空数组，老形状不受影响', () => {
  const bundle = parseWritePayloadBundle({ 命题: [{ 关于: '沈清禾', 栏目: '职业', 值: '上班族' }] })
  assert.deepEqual(bundle.retracts, [])
  assert.equal(bundle.actions.length, 1)
})

// 守卫：接线不许漏。撤回必须走 applyRetractions，而且要在写入之后跑（不然序号会被提前删掉的命题搞失效）。
test('index.mjs：写回里接了 applyRetractions', async () => {
  const src = readFileSync(fileURLToPath(new URL('../plugin/index.mjs', import.meta.url)), 'utf8')
  assert.ok(src.includes('applyRetractions('), '没接撤回')
  assert.ok(src.includes('applyWriteActions('), '写入还在')
  assert.ok(
    src.indexOf('applyWriteActions(') < src.indexOf('applyRetractions('),
    '撤回要排在写入之后',
  )
})

// 守卫：调试日志要能直读「谁 → 关于谁 · 命题内容」，否则玩家看不出撤的是谁的哪条认知。
test('index.mjs：撤回日志带上「关于谁」与命题内容', async () => {
  const src = readFileSync(fileURLToPath(new URL('../plugin/index.mjs', import.meta.url)), 'utf8')
  const at = src.indexOf('撤回 ${retraction.applied.length} 条认知')
  assert.ok(at >= 0, '找不到撤回日志')
  const block = src.slice(at, at + 900)
  // 收窄：「关于」这个词在写入段到处都是，要钉的是日志里那个字段名 `关于: nameOfId(`
  assert.match(block, /关于:\s*nameOfId\(/u, '日志缺「关于谁」（要写成 关于: nameOfId(aboutId)）')
  assert.ok(block.includes('decodeValue'), '命题内容要按字典解码，不能直接印下标')
})

// 撤回块被整块丢弃时必须有诊断（2026-11-06 评审 C1）。
// 风险场景：升级时面板存档里还是旧提示词 → 模型仍发 {关于,序号} → 解析层只认「谁」
// → 整个撤回块被过滤成空数组 → 下面 `if (retracts.length)` 直接跳过，
// 玩家和调试都看不出「这次的撤回全丢了」。
test('撤回：解析层整块丢弃时，index.mjs 要记一条 warn（旧字段「关于」的升级路径）', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('../plugin/index.mjs', import.meta.url)), 'utf8')
  // 必须在撤回段里检查「原始块非空但解析结果为空」
  assert.ok(src.includes('writePayload') && src.includes('撤回'), '找不到撤回段')
  const at = src.indexOf('const retracts = Array.isArray')
  assert.ok(at > 0, '找不到 retracts 解析行')
  const before = src.slice(Math.max(0, at - 900), at)
  assert.ok(
    before.includes('撤回') && (before.includes('length') || before.includes('Array.isArray')),
    '要在 retracts 之前检测原始撤回块',
  )
  const after = src.slice(at, at + 900)
  assert.ok(
    after.includes('没被识别') || after.includes('全部丢掉') || after.includes('旧字段'),
    '解析结果为空时要给一条人话诊断',
  )
})

test('撤回：解析层丢弃的条目数要能报出来（parseRetracts 给 dropped 计数）', async () => {
  const { parseWritePayloadBundle } = await import('../plugin/lib/payload.js')
  const bundle = parseWritePayloadBundle({ 撤回: [{ 关于: '沈清禾', 序号: 1 }, { 关于: '小s', 序号: 2 }] })
  assert.deepEqual(bundle.retracts, [], '旧字段不该再被认')
  assert.equal(bundle.retractsDropped, 2, '要报出被丢弃的条数，供上层记日志')
  const ok = parseWritePayloadBundle({ 撤回: [{ 谁: '沈清禾', 序号: 1 }] })
  assert.equal(ok.retractsDropped, 0, '正常条目不算丢弃')
})
