// 人物级动作：建档 / 改状态 / 模糊建档（设计稿 §2、ADR 0024、ADR 0035）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyPersonActions, resolvePersonByName, validatePersonActions } from '../plugin/lib/actions.js'

// 人物：[编号, 状态, 姓名, 别名串]
const person = (id, status, name, aliases = '') => [id, status, name, aliases]

const run = (actions, options = {}) =>
  validatePersonActions(actions, { persons: [], draft: {}, ...options })

test('建档：姓名必填，别名可以不给', () => {
  const { valid, rejected } = run([{ 动作: '建档', 姓名: '沈九' }])
  assert.equal(rejected.length, 0)
  assert.equal(valid[0].type, 'create')
  assert.equal(valid[0].name, '沈九')
  assert.deepEqual(valid[0].aliases, [])
})

test('建档：状态默认在场，写「离场」就是离场', () => {
  assert.equal(run([{ 动作: '建档', 姓名: '沈九' }]).valid[0].status, 1)
  assert.equal(run([{ 动作: '建档', 姓名: '沈九', 状态: '离场' }]).valid[0].status, 0)
})

test('建档：姓名为空被拒', () => {
  const { valid, rejected } = run([{ 动作: '建档', 姓名: '   ' }])
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /姓名/)
})

test('建档：与主角同名被拒（ADR 0024）', () => {
  const { valid, rejected } = run([{ 动作: '建档', 姓名: '林澈' }], { mainNames: ['林澈'] })
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /主角/)
})

test('建档：本轮被提到的已建档人物，不许重复建（那是同一个人）', () => {
  const persons = [person('p7', 0, '老陈', '陈先生,陈账房')]
  const known = new Set(['老陈', '陈先生', '陈账房'])
  assert.equal(run([{ 动作: '建档', 姓名: '老陈' }], { persons, knownNames: known }).valid.length, 0)
  assert.equal(run([{ 动作: '建档', 姓名: '陈先生' }], { persons, knownNames: known }).valid.length, 0)
  // 没撞上的照建
  assert.equal(run([{ 动作: '建档', 姓名: '沈九' }], { persons, knownNames: known }).valid.length, 1)
})

test('建档：撞名一律拒绝——同名支持已砍（ROADMAP P9）', () => {
  const persons = [person('p7', 0, '老陈')]
  const { valid, rejected } = run([{ 动作: '建档', 姓名: '老陈' }], { persons })
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /同名|已在档/)
})

test('建档：撞上别人的别名也拒绝（避免叫混）', () => {
  const persons = [person('p7', 0, '老陈', '陈先生,陈账房')]
  assert.equal(run([{ 动作: '建档', 姓名: '陈先生' }], { persons }).valid.length, 0)
  // 全新名字照建
  assert.equal(run([{ 动作: '建档', 姓名: '沈九' }], { persons }).valid.length, 1)
})

test('改状态：人物可以给编号，也可以给姓名', () => {
  const persons = [person('p7', 1, '老陈')]
  const byId = run([{ 动作: '改状态', 人物: 'p7', 状态: '离场' }], { persons })
  assert.equal(byId.valid[0].id, 'p7')
  assert.equal(byId.valid[0].status, 0)
  const byName = run([{ 动作: '改状态', 人物: '老陈', 状态: '离场' }], { persons })
  assert.equal(byName.valid[0].id, 'p7')
})

test('改状态：找不到人、状态名不认识都拒绝', () => {
  const persons = [person('p7', 1, '老陈')]
  assert.equal(run([{ 动作: '改状态', 人物: '查无此人', 状态: '离场' }], { persons }).valid.length, 0)
  assert.equal(run([{ 动作: '改状态', 人物: 'p7', 状态: '消失了' }], { persons }).valid.length, 0)
})

test('模糊建档：只记姓名和入表轮次；已在档的不收', () => {
  const persons = [person('p7', 0, '老陈')]
  const { valid } = run([{ 动作: '模糊建档', 姓名: '卖炭翁' }], { persons })
  assert.equal(valid[0].type, 'draft')
  assert.equal(valid[0].name, '卖炭翁')
  // 撞名 → 不进模糊建档
  assert.equal(run([{ 动作: '模糊建档', 姓名: '老陈' }], { persons }).valid.length, 0)
  // 已经在模糊建档表里（不重复收）
  assert.equal(run([{ 动作: '模糊建档', 姓名: '卖炭翁' }], { draft: { 卖炭翁: 12 } }).valid.length, 0)
})

test('值级动作混进人物级里：不认识就拒（两路分开校验）', () => {
  const { valid, rejected } = run([{ 动作: '新增', 栏目: 'a', 值: '账房', 来源: '自述' }])
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /动作/)
})

test('应用：建档分配新编号、别名进召回词串，不改原数组', () => {
  const persons = [person('p7', 0, '老陈')]
  const { valid } = run([{ 动作: '建档', 姓名: '沈九', 别名: '九爷', 状态: '在场' }])
  let next = 8
  const result = applyPersonActions(persons, valid, { turn: 20, takeId: () => `p${next++}` })

  assert.equal(persons.length, 1)                 // 原数组不动
  assert.equal(result.persons.length, 2)
  assert.deepEqual(result.persons[1], ['p8', 1, '沈九', '九爷'])
  assert.deepEqual(result.created, ['p8'])
})

test('应用：改状态改的是那个人的状态位', () => {
  const persons = [person('p7', 1, '老陈')]
  const { valid } = run([{ 动作: '改状态', 人物: '老陈', 状态: '离场' }], { persons })
  const result = applyPersonActions(persons, valid, { turn: 20 })
  assert.equal(result.persons[0][1], 0)
})

test('应用：模糊建档记入表轮次', () => {
  const { valid } = run([{ 动作: '模糊建档', 姓名: '卖炭翁' }])
  const result = applyPersonActions([], valid, { turn: 33 })
  assert.deepEqual(result.draft, { 卖炭翁: 33 })
  assert.equal(result.persons.length, 0)
})

// ---------- 按名字找人：模型只报人名，程序负责校验 ----------

test('找人：名字唯一就命中；重名和找不到都返回 null', () => {
  const persons = [person('p7', 0, '老陈'), person('p12', 1, '老陈'), person('p20', 0, '林昭')]
  assert.equal(resolvePersonByName(persons, '林昭'), 'p20')
  assert.equal(resolvePersonByName(persons, '老陈'), null)      // 重名 → 不猜
  assert.equal(resolvePersonByName(persons, '查无此人'), null)
})

test('找人：重名时素材会带 (p7) 尾巴，模型照抄就能定位', () => {
  const persons = [person('p7', 0, '老陈'), person('p12', 1, '老陈')]
  assert.equal(resolvePersonByName(persons, '老陈(p7)'), 'p7')
  assert.equal(resolvePersonByName(persons, '老陈(p12)'), 'p12')
  assert.equal(resolvePersonByName(persons, '老陈(p99)'), null) // 尾巴指向不存在的人
})

test('找人：别名也认', () => {
  const persons = [person('p7', 0, '老陈', '陈先生,陈账房')]
  assert.equal(resolvePersonByName(persons, '陈先生'), 'p7')
})

test('改状态：重名时必须带尾巴，否则这条动作被拒（不猜）', () => {
  const persons = [person('p7', 0, '老陈'), person('p12', 1, '老陈')]
  const ambiguous = run([{ 动作: '改状态', 人物: '老陈', 状态: '离场' }], { persons })
  assert.equal(ambiguous.valid.length, 0)
  assert.match(ambiguous.rejected[0].reason, /重名|分不清/)

  const clear = run([{ 动作: '改状态', 人物: '老陈(p12)', 状态: '离场' }], { persons })
  assert.equal(clear.valid[0].id, 'p12')
})

test('建档：全新名字照建', () => {
  const persons = [person('p7', 0, '老陈')]
  assert.equal(run([{ 动作: '建档', 姓名: '沈九' }], { persons }).valid.length, 1)
})

// ── 别名查撞（ADR 0049 挖的坑）──
test('建档：别名撞别人的姓名 → 拒', () => {
  const persons = [person('p7', 0, '老陈')]
  const { valid, rejected } = run([{ 动作: '建档', 姓名: '沈九', 别名: '老陈' }], { persons })
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /别名|老陈/)
})

test('建档：别名撞别人的别名 → 拒', () => {
  const persons = [person('p7', 0, '老陈', '陈先生')]
  const { valid, rejected } = run([{ 动作: '建档', 姓名: '沈九', 别名: '陈先生' }], { persons })
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /陈先生/)
})

test('建档：别名撞主角名 → 拒', () => {
  const { valid, rejected } = run([{ 动作: '建档', 姓名: '沈九', 别名: '林澈' }], { persons: [], mainNames: ['林澈'] })
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /主角|林澈/)
})

test('建档：别名和自己姓名重复的自动去掉，不算错', () => {
  const { valid } = run([{ 动作: '建档', 姓名: '沈九', 别名: '沈九,九爷' }], { persons: [] })
  assert.equal(valid.length, 1)
  assert.deepEqual(valid[0].aliases, ['九爷'])
})

// ── 单字名：可以留，但得配一个能叫得出来的称呼 ──
test('建档：单字姓名配了 ≥2 字别名 → 通过', () => {
  const { valid } = run([{ 动作: '建档', 姓名: '周', 别名: '周老板,周掌柜' }], { persons: [] })
  assert.equal(valid.length, 1)
  assert.equal(valid[0].name, '周')
  assert.deepEqual(valid[0].aliases, ['周老板', '周掌柜'])
})

test('建档：两个字的姓名不需要别名', () => {
  const { valid } = run([{ 动作: '建档', 姓名: '小周' }], { persons: [] })
  assert.equal(valid.length, 1)
})

// ── 改名：正文明确换了称呼才报，旧称呼自动进别名 ──
const RENAME_BODY = '老陈说，往后叫我陈守义吧。'

test('改名：姓名变、旧称呼自动进别名', () => {
  const persons = [person('p1', 1, '老陈', '陈先生')]
  const { valid, rejected } = run(
    [{ 动作: '改名', 姓名: '老陈', 新姓名: '陈守义' }],
    { persons, body: RENAME_BODY },
  )
  assert.equal(rejected.length, 0, JSON.stringify(rejected))
  assert.equal(valid[0].type, 'rename')
  const out = applyPersonActions(persons, valid, { turn: 5 }).persons
  assert.equal(out[0][2], '陈守义')
  assert.equal(out[0][3], '陈先生,老陈')
})

test('改名：档案里找不到这个人 → 拒', () => {
  const { valid, rejected } = run(
    [{ 动作: '改名', 姓名: '查无此人', 新姓名: '陈守义' }],
    { persons: [person('p1', 1, '老陈')], body: RENAME_BODY },
  )
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /找不到/)
})

test('改名：新称呼撞了别人的姓名 → 拒', () => {
  const { valid, rejected } = run(
    [{ 动作: '改名', 姓名: '老陈', 新姓名: '李四' }],
    { persons: [person('p1', 1, '老陈'), person('p2', 1, '李四')], body: '往后叫我李四吧' },
  )
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /已经归/)
})

test('改名：新称呼不在正文里出现 → 拒', () => {
  const { valid, rejected } = run(
    [{ 动作: '改名', 姓名: '老陈', 新姓名: '陈守义' }],
    { persons: [person('p1', 1, '老陈')], body: '老陈点了点头。' },
  )
  assert.equal(valid.length, 0)
  assert.ok(rejected.length)
})

test('改名：主角本人改名不被「不许撞主角名」拦住', () => {
  const { valid, rejected } = run(
    [{ 动作: '改名', 姓名: '林澈', 新姓名: '沈青' }],
    { persons: [person('p0', 1, '林澈')], mainNames: ['林澈'], body: '往后叫我沈青吧' },
  )
  assert.equal(rejected.length, 0, JSON.stringify(rejected))
  assert.equal(valid[0].id, 'p0')
})
