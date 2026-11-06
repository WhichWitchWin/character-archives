// 每轮发什么：判定素材与写入素材（docs/每轮发什么.md）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildCombinedPrompt, buildContextText, buildJudgePrompt, buildWritePrompt } from '../plugin/lib/followup.js'

const definitions = {
  a: { name: '身份职业' },
  b: { name: '当前处境' },
  c: { name: '未了事项' },
}
const checked = new Set(['a', 'b', 'c'])
const textOf = (claim) => String(claim[3])
const nameOf = (id) => String(id)

// 命题：[id, 人物, 栏目, 内容, 起始轮, 结束轮, 索引词, 约定轮次]
const claim = (id, code, text, personId = 'p7') => [id, personId, code, text, 10, [], 0]
// 一行素材：命题 + 他对它的指针（null = 只读，不给指针）
const row = (c, pointer = null) => ({ claim: c, pointer })
const selfTrue = (personId, claimId) => [personId, claimId, [[0, '']], 10]

test('判定素材：抬头、当前时间、本轮提到的人（带状态）、正文', () => {
  const text = buildJudgePrompt({
    gt: '永安三年·冬',
    mentioned: [
      { id: 'p7', name: '老陈', status: 0 },
      { id: 'p12', name: '林昭', status: 1 },
    ],
    body: '老陈推门进来。',
  })
  assert.ok(text.startsWith('【判定】'))
  assert.ok(text.includes('【当前游戏内时间】永安三年·冬'))
  assert.ok(text.includes('【本轮提到的人】'))
  assert.ok(text.includes('· 老陈 —— 离场'))
  assert.ok(text.includes('· 林昭 —— 在场'))
  assert.ok(text.includes('【本轮正文】'))
  assert.ok(text.includes('老陈推门进来。'))
})

test('判定素材：没有 gt 就省略那一行；没人被提到就省略整段', () => {
  const noGt = buildJudgePrompt({ gt: '', mentioned: [], body: '正文' })
  assert.ok(!noGt.includes('当前游戏内时间'))
  assert.ok(!noGt.includes('本轮提到的人'))
  assert.ok(noGt.includes('正文'))
})

test('判定素材：模糊建档只给名字，不给轮次和次数', () => {
  const text = buildJudgePrompt({ mentioned: [], draft: { 卖炭翁: 30, 沈九: 33 }, body: '正文' })
  assert.ok(text.includes('【模糊建档】卖炭翁、沈九'))
  assert.ok(!text.includes('30'))
  assert.ok(!text.includes('33'))
})

test('判定素材：模糊建档为空时整段省略', () => {
  const text = buildJudgePrompt({ mentioned: [], draft: {}, body: '正文' })
  assert.ok(!text.includes('模糊建档'))
})

test('写入素材：每人标题带状态，只列有内容的栏目', () => {
  const text = buildWritePrompt({
    gt: '永安三年·冬',
    people: [{
      id: 'p7',
      name: '老陈',
      status: 0,
      claims: [row(claim(1, 'a', '旧港码头的账房'), selfTrue('p7', 1))],
    }],
    definitions,
    checkedCodes: checked,
    textOf,
    nameOf,
  })
  assert.ok(text.startsWith('【写入】'))
  assert.ok(text.includes('【老陈 · 离场】'))
  assert.ok(text.includes('· 身份职业'))
  assert.ok(text.includes('  1. 旧港码头的账房 ｜ 他自己确认过'))
  assert.ok(!text.includes('· 当前处境'), '空栏目不再列出来')
})

test('写入素材：值带序号，按出现顺序从 1 数', () => {
  const text = buildWritePrompt({
    people: [{
      id: 'p7', name: '老陈', status: 0,
      claims: [row(claim(1, 'c', '欠林澈一条命')), row(claim(2, 'c', '还欠一条'))],
    }],
    definitions, checkedCodes: checked, textOf, nameOf,
  })
  assert.ok(text.includes('  1. 欠林澈一条命'))
  assert.ok(text.includes('  2. 还欠一条'))
})

test('写入素材：新建档的人注明栏目全空', () => {
  const text = buildWritePrompt({
    people: [{ id: 'p12', name: '沈九', status: 1, claims: [], fresh: true }],
    definitions, checkedCodes: checked, textOf, nameOf,
  })
  assert.ok(text.includes('【沈九 · 在场】（本轮新建档，栏目全空）'))
})

test('写入素材：没有 gt 就省略当前时间那一行', () => {
  const text = buildWritePrompt({
    gt: '',
    people: [{ id: 'p7', name: '老陈', status: 0, claims: [] }],
    definitions, checkedCodes: checked, textOf, nameOf,
  })
  assert.ok(!text.includes('当前游戏内时间'))
})

test('写入素材：没勾的栏目不列', () => {
  const text = buildWritePrompt({
    people: [{
      id: 'p7', name: '老陈', status: 0,
      claims: [row(claim(1, 'a', '账房')), row(claim(2, 'c', '欠钱'))],
    }],
    definitions,
    checkedCodes: new Set(['a']),
    textOf,
    nameOf,
  })
  assert.ok(text.includes('· 身份职业'))
  assert.ok(!text.includes('· 未了事项'))
})

test('素材里绝不出现人物编号（编号是引擎概念，模型不需要也不该看到）', () => {
  const judge = buildJudgePrompt({
    mentioned: [{ id: 'p7', name: '老陈', status: 0 }],
    body: '正文',
  })
  assert.ok(!judge.includes('p7'))
  const write = buildWritePrompt({
    people: [{ id: 'p7', name: '老陈', status: 0, claims: [] }],
    definitions, checkedCodes: checked, textOf, nameOf,
  })
  assert.ok(!write.includes('p7'))
})

test('栏目没有名字时也不许回落成条目码（内部码不给模型看）', () => {
  const text = buildWritePrompt({
    people: [{
      id: 'p1',
      name: '老陈',
      status: 1,
      claims: [row([1, 'p1', 'q', '某值', 10, [], 0])],
    }],
    definitions: { q: {} },          // 故意没有 name
    checkedCodes: new Set(['q']),
    textOf,
    nameOf,
  })
  assert.ok(text.includes('（未命名栏目）'), '应该显示占位名')
  assert.ok(!/· q/.test(text), '不该把条目码当栏目名')
})

// ── 合并素材（判人 + 写入一次发）──
// 后台结算档每轮只能发一次消息，判人和写入必须合并成一次调用。
test('合并素材：判人段 + 写入段一次发出去', () => {
  const text = buildCombinedPrompt({
    gt: '永安三年·冬',
    mentioned: [{ id: 'p7', name: '老陈', status: 0 }],
    draft: { 卖炭翁: 3 },
    body: '老陈推门进来。',
    people: [{
      id: 'p7', name: '老陈', status: 0,
      claims: [row(claim(1, 'a', '旧港码头的账房'))],
    }],
    definitions, checkedCodes: checked, textOf, nameOf,
  })
  assert.ok(text.includes('【判定】'), '要有判人段')
  assert.ok(text.includes('【本轮正文】'))
  assert.ok(text.includes('【模糊建档】卖炭翁'))
  assert.ok(text.includes('【写入】'), '要有写入段')
  assert.ok(text.includes('【老陈 · 离场】'))
  assert.ok(text.includes('1. 旧港码头的账房'))
})

test('合并素材：当前时间只出现一次（按生产形状带写入模板）', () => {
  const text = buildCombinedPrompt({
    gt: '永安三年·冬',
    mentioned: [], draft: {}, body: '正文',
    people: [{ id: 'p7', name: '老陈', status: 1, claims: [] }],
    definitions, checkedCodes: checked, textOf, nameOf,
    writeTemplate: '【写入】\n\n【当前游戏内时间】{{GT}}\n\n{{PEOPLE}}',
  })
  assert.equal((text.match(/当前游戏内时间/g) ?? []).length, 1, '时间只出现一次')
  assert.ok(!/【当前游戏内时间】\s*\n\s*\n/.test(text), '不许留一行空的时间标题')
})

test('合并素材：人物编号不出现在任何一段', () => {
  const text = buildCombinedPrompt({
    mentioned: [{ id: 'p7', name: '老陈', status: 0 }],
    draft: {}, body: '正文',
    people: [{ id: 'p7', name: '老陈', status: 0, claims: [] }],
    definitions, checkedCodes: checked, textOf, nameOf,
  })
  assert.ok(!text.includes('p7'))
})

// ---------- 动态上下文里的「认知口径」（P20） ----------
// 口径以前写死在系统提示词里（未定 / 亲见算真），玩家改不了。
// 现在每轮随工单发，提示词只指路到工单开头（ADR 0095 同一个理由：提示词能缓存，口径要能改）。

const cognitionOf = (patch = {}) => ({
  defaultAttitude: '未定',
  eyewitnessTrue: true,
  conflictDisplay: 'all',
  maxOtherSources: 3,
  ...patch,
})

test('动态上下文：带认知口径时出现【认知口径】，两条都在【栏目定义】之后', () => {
  const text = buildContextText({
    viewpoint: '第二人称',
    playerName: '林澈',
    entriesText: '· 身份职业：码头的账房',
    cognition: cognitionOf(),
  })
  assert.ok(text.includes('【认知口径】'))
  assert.ok(text.includes('· 模型判断不了某事真假时，态度给「未定」。'))
  assert.ok(text.includes('· 主角亲眼见到的，可以直接给「真」。'))
  assert.ok(
    text.indexOf('【栏目定义】') < text.indexOf('【认知口径】'),
    '认知口径排在栏目定义之后',
  )
})

test('动态上下文：默认态度跟着设置变', () => {
  const text = buildContextText({ cognition: cognitionOf({ defaultAttitude: '真' }) })
  assert.ok(text.includes('· 模型判断不了某事真假时，态度给「真」。'))
  assert.ok(!text.includes('态度给「未定」'))
})

test('动态上下文：亲见不自动算真——按正文里他自己的表现判断信不信', () => {
  const on = buildContextText({ cognition: cognitionOf({ eyewitnessTrue: true }) })
  const off = buildContextText({ cognition: cognitionOf({ eyewitnessTrue: false }) })
  assert.ok(on.includes('· 主角亲眼见到的，可以直接给「真」。'))
  // 其他角色亲见这条必须明写：只写「主角」，NPC 亲见就成了悬空规则，
  // 模型只能自己发挥（要么一律未定，要么把主角那条泛化给所有人）——两种都不稳定。
  assert.ok(
    on.includes('· 其他角色自己亲眼确认过、有自己判断的，按他们自己的判断给「真」或「假」。'),
    '要写清其他角色自己的判断怎么给，别只提主角',
  )
  assert.ok(!off.includes('可以直接给「真」'))
  // 关掉 ≠ 一律未定：要让模型看正文里这个人自己的表现（2026-11-06 改口径）
  assert.ok(
    off.includes('· 谁亲眼见到都不自动算「真」：按正文里他自己的表现判断'),
    '关掉之后要说清「还是按正文判断」，不是一律未定',
  )
  assert.ok(off.includes('他明确信了、或这话本来就是他说的，给「真」'), '要写清什么情况给真')
  assert.ok(off.includes('他明确不信、怀疑、觉得是假的，给「假」'), '要写清什么情况给假')
  assert.ok(off.includes('看不出来，给「未定」'), '看不出来才落到默认态度')
})

test('动态上下文：口径里告知来源组上限（免得模型报一堆再被默默丢掉）', () => {
  const five = buildContextText({ cognition: cognitionOf({ maxOtherSources: 5 }) })
  assert.ok(five.includes('· 一条命题最多给 5 个「谁知道」'), '上限要随设置变')
  // 不合法/缺省一律按 3：跟存储侧 setEntry 的兜底保持一致
  const broken = buildContextText({ cognition: cognitionOf({ maxOtherSources: 0 }) })
  assert.ok(broken.includes('· 一条命题最多给 3 个「谁知道」'))
})

test('动态上下文：不传认知口径时整段不出现（向后兼容）', () => {
  for (const text of [buildContextText(), buildContextText({ entriesText: '· 身份职业：账房' })]) {
    assert.ok(!text.includes('【认知口径】'))
    assert.ok(!text.includes('态度给'), '没有设置来源时不该凭空给口径')
  }
})

test('动态上下文：约定规则不再随工单发（已回到系统提示词，ADR 0106）', () => {
  const cases = [
    ['完全不传', undefined],
    ['空对象', {}],
    ['不传 definitions', { cognition: cognitionOf() }],
    ['有约定栏目', { definitions: { a: { name: '未了事项', convention: true } } }],
    ['栏目表带标记', { entriesText: '· 未了事项【约定】 —— 尚未兑现的承诺' }],
  ]
  for (const [label, input] of cases) {
    const text = input === undefined ? buildContextText() : buildContextText(input)
    assert.ok(!text.includes('【约定规则】'), `${label} 不该再随工单发约定规则`)
    assert.ok(!text.includes('`没完成`'), `${label} 不该出现状态枚举`)
  }
})
