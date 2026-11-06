// 面板数据：把快照翻成分组、可直接渲染的结构（设计稿 §8.1～§8.3、§7.11）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPanelView } from '../plugin/lib/panelView.js'

/** 人物固定 4 格：[编号, 状态, 姓名, 别名串] */
const person = (id, status, name, aliases = '') => [id, status, name, aliases]

const base = { now: 40, dormantTurns: 20 }

// 主角标签（2026-11-05，B）：第二人称卡里主角名常常就是「你」，
// 面板必须一眼看出"这是玩家本人"，否则会被当成误建档的 NPC。
test('主角标签：p0 那一行带 isPlayer，其他人不带', () => {
  const snapshot = { t: 3, p: [person('p0', 1, '你'), person('p1', 1, '老陈')] }
  const view = buildPanelView({ snapshot })
  assert.equal(view.groups.present.find((row) => row.id === 'p0').isPlayer, true)
  assert.equal(view.groups.present.find((row) => row.id === 'p1').isPlayer, false)
})

// 重要人物（★，2026-11-05）：召回升到 60% 份额，而且**不沉底**。
test('重要人物：★ 行带 starred，而且不会被沉到冷档', () => {
  const snapshot = { t: 100, p: [person('p1', 1, '老陈'), person('p2', 1, '李四')] }
  const view = buildPanelView({
    snapshot,
    starIds: new Set(['p2']),
    seen: { p1: 0, p2: 0 },
    now: 100,
    dormantTurns: 20,
  })
  const rows = [...view.groups.present, ...view.groups.offline, ...view.groups.cold]
  assert.equal(rows.find((row) => row.id === 'p2').starred, true)
  assert.equal(rows.find((row) => row.id === 'p1').starred, false)
  assert.ok(!view.groups.cold.some((row) => row.id === 'p2'), '★ 不该沉底')
  assert.ok(view.groups.cold.some((row) => row.id === 'p1'), '没星的该沉底')
})

// 主角置顶（2026-11-05）：p0 在自己所在的那一组里永远排第一，
// 不管他多久没露面——他本来就不是"被召回的对象"，是玩家自己。
test('主角置顶：p0 最久没露面，也排在自己那一组第一个', () => {
  const snapshot = { t: 10, p: [person('p1', 1, '老陈'), person('p0', 1, '你'), person('p2', 1, '李四')] }
  const view = buildPanelView({ snapshot, seen: { p0: 1, p1: 9, p2: 8 }, now: 10 })
  assert.equal(view.groups.present[0].id, 'p0')
})

test('主角置顶：离场组也一样', () => {
  const snapshot = { t: 10, p: [person('p1', 0, '老陈'), person('p0', 0, '你'), person('p2', 0, '李四')] }
  const view = buildPanelView({ snapshot, seen: { p0: 1, p1: 9, p2: 8 }, now: 10 })
  assert.equal(view.groups.offline[0].id, 'p0')
})

// 置顶的完整优先级：主角 → ★ 重要人物 → 最近活跃 → 名字
test('置顶优先级：主角在最前，★ 在主角下面、普通人上面', () => {
  const snapshot = {
    t: 10,
    p: [person('p1', 1, '老陈'), person('p0', 1, '你'), person('p2', 1, '李四'), person('p3', 1, '王五')],
  }
  const view = buildPanelView({
    snapshot,
    starIds: new Set(['p3']),
    // p0 和 p3 都最久没露面；p1 最新
    seen: { p0: 1, p3: 2, p1: 9, p2: 8 },
    now: 10,
  })
  assert.deepEqual(view.groups.present.map((row) => row.id), ['p0', 'p3', 'p1', 'p2'])
})

test('主角不进冷档：多久没露面都不沉底，手动拖也不沉', () => {
  const snapshot = { t: 100, p: [person('p0', 1, '你')] }
  const auto = buildPanelView({ snapshot, seen: { p0: 0 }, now: 100, dormantTurns: 20 })
  assert.equal(auto.groups.cold.length, 0, '主角不该被程序判进冷档')
  assert.equal(auto.groups.present.length, 1)

  const manual = buildPanelView({ snapshot, seen: { p0: 0 }, now: 100, coldManual: { p0: true } })
  assert.equal(manual.groups.cold.length, 0, '主角也不该被手动拖进冷档')
})

// 删除确认要数**认知**（指针），这才是"他记得多少"。
test('删除确认的计数用认知条数（指针数）', () => {
  const snapshot = {
    t: 5,
    p: [person('p1', 1, '老陈')],
    c: [[1, 'p1', 'a', '在旧港', 3, []], [2, 'p1', 'a', '欠张三钱', 4, []]],
    pt: [['p1', 1, [[0, '']], 3], ['p1', 2, [[2, '?']], 4]],
  }
  const rows = buildPanelView({ snapshot }).groups.present
  assert.equal(rows[0].cognitionCount, 2, '两条指针＝两条认知')
})

// 命题第 3 位存的是栏目码，面板得翻成人能看懂的名字。
test('认知行带栏目：码翻成栏目名', () => {
  const snapshot = {
    t: 5,
    p: [person('p1', 1, '老陈')],
    c: [[1, 'p1', 'a', '在旧港当账房', 3, []]],
    pt: [['p1', 1, [[0, '']], 3]],
  }
  const cog = buildPanelView({ snapshot, definitions: { a: { name: '职业' } } }).groups.present[0].cognitions[0]
  assert.equal(cog.code, 'a')
  assert.equal(cog.columnName, '职业')
})

test('认知行：栏目码在定义表里查不到时退回显示码本身', () => {
  const snapshot = {
    t: 5,
    p: [person('p1', 1, '老陈')],
    c: [[1, 'p1', 'zz', '在旧港', 3, []]],
    pt: [['p1', 1, [[0, '']], 3]],
  }
  const cog = buildPanelView({ snapshot, definitions: {} }).groups.present[0].cognitions[0]
  assert.equal(cog.columnName, 'zz')
})

test('分组：在场、离场各归各；没名字的单独标出来', () => {
  const snapshot = {
    t: 40,
    gt: '永安三年·冬',
    p: [person('p1', 1, '老陈'), person('p2', 0, '林昭'), person('p3', 0, '')],
  }
  const view = buildPanelView({ ...base, snapshot })
  assert.equal(view.turn, 40)
  assert.equal(view.gt, '永安三年·冬')
  assert.deepEqual(view.groups.present.map((row) => row.id), ['p1'])
  assert.deepEqual(view.groups.offline.map((row) => row.id).sort(), ['p2', 'p3'])
  // 没名字的人要能被面板标出来（召回前提之一是姓名非空）
  const nameless = view.groups.offline.find((row) => row.id === 'p3')
  assert.equal(nameless.unnamed, true)
})

test('人物行带：锁、眼睛、冷档标记', () => {
  const snapshot = { t: 40, p: [person('p1', 1, '老陈'), person('p2', 0, '林昭')] }
  const view = buildPanelView({
    ...base,
    snapshot,
    lock: { p1: true },
    hidden: { p2: true },
    seen: { p2: 1 },          // 第 1 轮之后就没动静 → 39 轮 > 20 → 冷档
  })
  const p1 = view.groups.present[0]
  assert.equal(p1.locked, true)
  assert.equal(p1.hidden, false)

  const p2 = view.groups.cold[0]
  assert.equal(p2.hidden, true)
  assert.equal(p2.cold, true)
})

test('冷档：★人物不沉，刚更新过的也不沉', () => {
  const snapshot = { t: 40, p: [person('p1', 0, '老陈'), person('p2', 0, '林昭')] }
  const view = buildPanelView({
    ...base,
    snapshot,
    seen: { p1: 1, p2: 35 },
    starIds: new Set(['p1']),
  })
  const byId = Object.fromEntries(view.groups.offline.map((row) => [row.id, row]))
  assert.equal(byId.p1.cold, false, '★ 人物永不沉降')
  assert.equal(byId.p2.cold, false, '刚更新过的不算冷档')
})

test('排序：最近活跃的在前（按最后确认轮次倒序）', () => {
  const snapshot = { t: 40, p: [person('p1', 0, '甲'), person('p2', 0, '乙'), person('p3', 0, '丙')] }
  const view = buildPanelView({ ...base, snapshot, seen: { p1: 35, p2: 39, p3: 36 } })
  assert.deepEqual(view.groups.offline.map((row) => row.id), ['p2', 'p3', 'p1'])
})

test('统计：总数、在场、离场、冷档', () => {
  const snapshot = { t: 40, p: [person('p1', 1, '甲'), person('p2', 0, '乙'), person('p3', 0, '丙')] }
  const view = buildPanelView({ ...base, snapshot, seen: { p2: 1, p3: 35 } })
  assert.deepEqual(view.stats, { total: 3, present: 1, fuzzyOffline: 0, offline: 1, cold: 1 })
})

test('面板也带地点：跟 gt 一起给界面显示', () => {
  const snapshot = { t: 40, gt: '永安三年·冬', loc: '临安·旧港·码头', p: [person('p1', 1, '甲')] }
  const view = buildPanelView({ ...base, snapshot })
  assert.equal(view.loc, '临安·旧港·码头')
  assert.equal(buildPanelView({ ...base, snapshot: { t: 1, p: [] } }).loc, '')
})

// 单字名要标出来：玩家得知道「景」这种人可能召不回来（ADR 0069）
test('面板行：单字名要标记（玩家看得见）', () => {
  const view = buildPanelView({
    ...base,
    snapshot: { t: 12, p: [person('p1', 0, '景'), person('p2', 0, '沈清禾')] },
  })
  const rows = [...view.groups.present, ...view.groups.offline]
  assert.equal(rows.find((r) => r.id === 'p1').singleCharName, true)
  assert.equal(rows.find((r) => r.id === 'p2').singleCharName, false)
})

test('面板行：没有姓名的不算单字名', () => {
  const view = buildPanelView({ ...base, snapshot: { t: 12, p: [person('p1', 0, '')] } })
  assert.equal(view.groups.offline[0].singleCharName, false)
})

test('面板行：别名串拆成逗号分隔的字符串', () => {
  const view = buildPanelView({ ...base, snapshot: { t: 12, p: [person('p1', 0, '老陈', '陈先生,陈掌柜')] } })
  assert.equal(view.groups.offline[0].aliases, '陈先生,陈掌柜')
})

// 模糊建档候选要能被面板看到（以前只能翻调试日志）
test('面板：draft 表变成可渲染的行（名字 / 哪轮记的 / 隔了几轮）', () => {
  const view = buildPanelView({
    ...base,
    now: 40,
    snapshot: { t: 40, p: [] },
    draft: { 卖炭翁: 37, 灰西装男: 35 },
  })
  assert.equal(view.draft.length, 2)
  assert.deepEqual(view.draft.map((row) => row.name), ['灰西装男', '卖炭翁'], '按记得的轮次从早到晚')
  assert.equal(view.draft[0].at, 35)
  assert.equal(view.draft[0].gap, 5)
})

test('面板：没有候选时是空数组（不是 undefined）', () => {
  const view = buildPanelView({ ...base, snapshot: { t: 10, p: [] } })
  assert.deepEqual(view.draft, [])
})

// ── 「他是什么样」：关于他的命题，按栏目分组（跟「他的认知」是两个视角）──
const COLUMNS = { a: { name: '职业' }, b: { name: '性格' }, c: { name: '能力资源' } }

test('他是什么样：关于他的命题按栏目分组', () => {
  const snapshot = {
    t: 5,
    p: [person('p1', 1, '老陈')],
    c: [[1, 'p1', 'a', '在旧港当账房', 3, []], [2, 'p1', 'b', '性子慢热', 4, []]],
  }
  const cols = buildPanelView({ snapshot, definitions: COLUMNS }).groups.present[0].aboutColumns
  assert.deepEqual(cols.map((col) => col.name), ['职业', '性格', '能力资源'])
  assert.deepEqual(cols[0].claims.map((item) => item.text), ['在旧港当账房'])
  assert.deepEqual(cols[1].claims.map((item) => item.text), ['性子慢热'])
})

test('他是什么样：空栏目也列出来（claims 是空数组）', () => {
  const snapshot = { t: 5, p: [person('p1', 1, '老陈')], c: [] }
  const cols = buildPanelView({ snapshot, definitions: COLUMNS }).groups.present[0].aboutColumns
  assert.equal(cols.length, 3)
  assert.deepEqual(cols.map((col) => col.claims), [[], [], []])
})

test('他是什么样：别人的命题不出现在他的栏目里', () => {
  const snapshot = {
    t: 5,
    p: [person('p1', 1, '老陈'), person('p2', 0, '周砚')],
    c: [[1, 'p2', 'a', '画速写为生', 3, []]],
  }
  const view = buildPanelView({ snapshot, definitions: COLUMNS })
  assert.deepEqual(view.groups.present[0].aboutColumns[0].claims, [], '周砚的职业不是老陈的')
  assert.deepEqual(view.groups.offline[0].aboutColumns[0].claims.map((item) => item.text), ['画速写为生'])
})

test('他是什么样：只显示勾选的栏目', () => {
  const snapshot = { t: 5, p: [person('p1', 1, '老陈')], c: [] }
  const cols = buildPanelView({ snapshot, definitions: COLUMNS, checkedCodes: new Set(['a']) })
    .groups.present[0].aboutColumns
  assert.deepEqual(cols.map((col) => col.code), ['a'])
})

test('他是什么样：每条命题带 claimId（面板点着改要用）', () => {
  const snapshot = { t: 5, p: [person('p1', 1, '老陈')], c: [[7, 'p1', 'a', '账房', 3, []]] }
  const claim = buildPanelView({ snapshot, definitions: COLUMNS }).groups.present[0].aboutColumns[0].claims[0]
  assert.equal(claim.claimId, 7)
})

// ── 「按认知浏览」：他的指针按**命题的栏目**分组 ──
test('认知按栏目分组：他认为别人的事落在那个栏目下', () => {
  const snapshot = {
    t: 5,
    p: [person('p1', 1, '老陈'), person('p2', 0, '周砚')],
    c: [
      [1, 'p2', 'a', '画速写为生', 3, []],   // 周砚的职业
      [2, 'p1', 'b', '性子慢热', 3, []],     // 老陈的性格
    ],
    pt: [
      ['p1', 1, [[2, '']], 3],   // 老陈（拿不准）周砚的职业
      ['p1', 2, [[0, '']], 3],   // 老陈知道自己性子慢热
    ],
  }
  const cols = buildPanelView({ snapshot, definitions: COLUMNS }).groups.present[0].cognitionColumns
  assert.deepEqual(cols.map((col) => col.name), ['职业', '性格'])
  assert.deepEqual(cols[0].items.map((item) => item.text), ['画速写为生'])
  assert.equal(cols[0].items[0].aboutName, '周砚', '这条认知说的是周砚')
  assert.deepEqual(cols[1].items.map((item) => item.text), ['性子慢热'])
})

test('认知按栏目分组：没有认知的栏目不出现（认知视角不补空）', () => {
  const snapshot = { t: 5, p: [person('p1', 1, '老陈')], c: [], pt: [] }
  const cols = buildPanelView({ snapshot, definitions: COLUMNS }).groups.present[0].cognitionColumns
  assert.deepEqual(cols, [])
})

// ── 变化可见：谁这轮被动了 ──
// 「最后变动轮」必须**两边都算**：他脑子里的指针（他自己的认知）＋ 关于他的命题的指针。
// 只算一边会漏一种情况——改他档案时他自己的指针没动，动的是「关于他」的那条。
test('最后变动轮：他记着别人的事（他自己的认知指针）也算', () => {
  const snapshot = {
    t: 5,
    p: [person('p1', 1, '老陈'), person('p2', 1, '周砚')],
    c: [[1, 'p2', 'a', '画速写为生', 3, []]],
    pt: [['p1', 1, [[2, '']], 7]],   // 老陈记着「周砚的职业」，第 7 轮动过
  }
  const rows = buildPanelView({ snapshot }).groups.present
  assert.equal(rows.find((row) => row.id === 'p1').lastChangeTurn, 7)
})

test('最后变动轮：别人记着关于他的事（关于他的命题指针）也算', () => {
  const snapshot = {
    t: 5,
    p: [person('p1', 1, '老陈'), person('p2', 1, '周砚')],
    c: [[2, 'p1', 'a', '在旧港当账房', 3, []]],
    pt: [['p2', 2, [[2, '']], 9]],   // 周砚记着「老陈当账房」，第 9 轮动过
  }
  const rows = buildPanelView({ snapshot }).groups.present
  assert.equal(rows.find((row) => row.id === 'p1').lastChangeTurn, 9)
})

test('最后变动轮：两边都有时取最大值', () => {
  const snapshot = {
    t: 9,
    p: [person('p1', 1, '老陈'), person('p2', 1, '周砚')],
    c: [[1, 'p1', 'a', '在旧港当账房', 3, []], [2, 'p2', 'a', '画速写为生', 3, []]],
    pt: [
      ['p1', 2, [[2, '']], 4],   // 老陈记着周砚的职业：第 4 轮
      ['p2', 1, [[2, '']], 9],   // 周砚记着老陈的职业：第 9 轮
    ],
  }
  const rows = buildPanelView({ snapshot }).groups.present
  // 老陈：自己的指针 4、关于他的 9 → 9；不能只取自己那边（那是 4）
  assert.equal(rows.find((row) => row.id === 'p1').lastChangeTurn, 9)
})

test('最后变动轮：一条指针都没有就是 0', () => {
  const snapshot = { t: 9, p: [person('p1', 1, '老陈')] }
  assert.equal(buildPanelView({ snapshot }).groups.present[0].lastChangeTurn, 0)
})

test('本轮有变化：最后变动轮等于当前轮次才为 true', () => {
  const snapshot = {
    t: 9,
    p: [person('p1', 1, '老陈'), person('p2', 1, '周砚'), person('p3', 1, '王五')],
    c: [[1, 'p2', 'a', '画速写为生', 3, []]],
    pt: [['p1', 1, [[2, '']], 9]],   // 第 9 轮刚动过
  }
  const rows = buildPanelView({ snapshot }).groups.present
  assert.equal(rows.find((row) => row.id === 'p1').changedThisTurn, true)
  assert.equal(rows.find((row) => row.id === 'p3').changedThisTurn, false, '没指针的人不该亮「本轮有变化」')
})

test('本轮有变化：还没开局的空局（turn 0）不该给所有人亮圆点', () => {
  // lastChangeTurn 和 turn 都是 0 时，`===` 会成立——那不是"变了"，是"还没有任何一轮"。
  const snapshot = { p: [person('p1', 1, '老陈'), person('p2', 1, '周砚')] }
  const rows = buildPanelView({ snapshot }).groups.present
  for (const row of rows) {
    assert.equal(row.lastChangeTurn, 0)
    assert.equal(row.changedThisTurn, false, `${row.name} 在空局里不该亮圆点`)
  }
})

// 排序：主角 → ★ 之后按「最近有动静」——露面轮次和改动轮次取**较大**那个。
// 为什么不直接拿「最后改动轮」比：那是绝对轮次，第 3 轮记过一笔的人会永远压过
// 第 40 轮刚出场的人，扫读时"最近谁在场上"反而看不到（评审 C-3）。
test('排序：最近有动静（露面或改动，取较大者）的人在前', () => {
  const snapshot = {
    t: 9,
    p: [person('p1', 1, '甲'), person('p2', 1, '乙')],
    c: [[1, 'p2', 'a', '画速写为生', 3, []], [2, 'p1', 'a', '在旧港当账房', 3, []]],
    pt: [
      ['p1', 2, [[2, '']], 2],   // 甲第 2 轮改过，但第 11 轮才露面
      ['p2', 1, [[2, '']], 9],   // 乙第 9 轮改过，第 0 轮之后没露面
    ],
  }
  const view = buildPanelView({ snapshot, seen: { p1: 11, p2: 0 }, now: 12 })
  assert.deepEqual(view.groups.present.map((row) => row.id), ['p1', 'p2'])
})

test('排序：最近轮次打平时，刚改过档案的人在前', () => {
  const snapshot = {
    t: 9,
    p: [person('p1', 1, '甲'), person('p2', 1, '乙')],
    c: [[1, 'p2', 'a', '画速写为生', 3, []], [2, 'p1', 'a', '在旧港当账房', 3, []]],
    pt: [
      ['p1', 2, [[2, '']], 9],   // 甲：第 9 轮改过
      ['p2', 1, [[2, '']], 0],   // 乙：第 9 轮只是在场
    ],
  }
  const view = buildPanelView({ snapshot, seen: { p1: 9, p2: 9 }, now: 12 })
  assert.deepEqual(view.groups.present.map((row) => row.id), ['p1', 'p2'])
})

test('两个视窗数据源不同：别人的命题只进「他的认知」，不进「他是什么样」', () => {
  const snapshot = {
    t: 5,
    p: [person('p1', 1, '老陈'), person('p2', 0, '周砚')],
    c: [[1, 'p2', 'a', '画速写为生', 3, []]],
    pt: [['p1', 1, [[2, '']], 3]],
  }
  const row = buildPanelView({ snapshot, definitions: COLUMNS }).groups.present[0]
  assert.deepEqual(row.aboutColumns[0].claims, [], '周砚的职业不是老陈的「他是什么样」')
  assert.deepEqual(row.cognitionColumns[0].items.map((item) => item.text), ['画速写为生'])
})

// 自动词只在面板展示、不落盘（2026-11-06）：玩家看不到它，会以为"没索引词凭什么被召回"。
// 现算而不是存盘：泛词表一改，所有老档案立刻按新规则算。
test('面板数据：每条命题带 autoWords（现算、不落盘）', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('../plugin/lib/panelView.js', import.meta.url)), 'utf8')
  assert.ok(src.includes('autoWordsOf'), 'panelView 要现算自动词')
  assert.equal((src.match(/autoWords: autoWordsOf/g) || []).length, 2, '认知视角与「关于他」两处都要带')
  assert.ok(!src.includes('withClaimWords'), '不许把自动词写回命题（只展示）')
})
