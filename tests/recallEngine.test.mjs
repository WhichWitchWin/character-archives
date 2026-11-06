// 召回引擎（ADR 0082 / 0085 / 0086 / 0087 / 0089）：纯逻辑，不碰 ctx。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as indexWords from '../plugin/lib/indexWords.js'
import { buildRecallSection, charCount, scorePointer } from '../plugin/lib/recallEngine.js'
import { TRUTH, SELF } from '../plugin/lib/pointers.js'

const person = (id, status, name) => [id, status, name, [], '']
const claim = (id, about, code, content, from = 3, words = []) => [id, about, code, content, from, words]
const pointer = (personId, claimId, groups = [[TRUTH.TRUE, SELF]], lastTurn = 3) => [personId, claimId, groups, lastTurn]

const base = {
  definitions: { a: { name: '当前处境' }, b: { name: '未了事项', mustRecall: true } },
  checkedCodes: new Set(['a', 'b']),
  budget: 3000,
  viewpoint: '第二人称',
  turn: 10,
}

test('只召回在场的人；离场的人不给', () => {
  const snapshot = {
    p: [person('p1', 1, '老陈'), person('p2', 0, '李四')],
    c: [claim(1, 'p1', 'a', '在旧港'), claim(2, 'p2', 'a', '在码头')],
    pt: [pointer('p1', 1), pointer('p2', 2)],
    gt: '', loc: '',
  }
  const { text } = buildRecallSection({ ...base, snapshot })
  assert.ok(text.includes('老陈'))
  assert.ok(!text.includes('李四'))
})

test('眼睛闭上的不给', () => {
  const snapshot = {
    p: [person('p1', 1, '老陈')],
    c: [claim(1, 'p1', 'a', '在旧港')],
    pt: [pointer('p1', 1)],
  }
  const { text } = buildRecallSection({ ...base, snapshot, hidden: new Set(['p1']) })
  assert.equal(text, '')
})

test('栏目没勾选的不给', () => {
  const snapshot = {
    p: [person('p1', 1, '老陈')],
    c: [claim(1, 'p1', 'a', '在旧港')],
    pt: [pointer('p1', 1)],
  }
  const { text } = buildRecallSection({ ...base, snapshot, checkedCodes: new Set(['b']) })
  assert.equal(text, '')
})

test('冷却中的指针不给（建立/修改盖章）', () => {
  const snapshot = {
    p: [person('p1', 1, '老陈')],
    c: [claim(1, 'p1', 'a', '在旧港')],
    pt: [pointer('p1', 1, [[TRUTH.TRUE, SELF]], 10)],   // 第 10 轮刚变过
  }
  const { text } = buildRecallSection({ ...base, snapshot, turn: 10, cooldownTurns: 10 })
  assert.equal(text, '')
})

test('主角在场时不当召回源', () => {
  const snapshot = {
    p: [person('p0', 1, '林澈'), person('p1', 1, '老陈')],
    c: [claim(1, 'p0', 'a', '在想事情'), claim(2, 'p1', 'a', '在旧港')],
    pt: [pointer('p0', 1), pointer('p1', 2)],
  }
  const { text } = buildRecallSection({ ...base, snapshot })
  assert.ok(text.includes('老陈'))
  assert.ok(!text.includes('林澈'))
})

test('主角回场：全量注入一次（只按他自己的指针来）', () => {
  const snapshot = {
    p: [person('p0', 1, '林澈'), person('p1', 1, '老陈')],
    c: [claim(1, 'p1', 'a', '老陈在旧港'), claim(2, 'p1', 'a', '老陈欠钱')],
    pt: [pointer('p0', 1), pointer('p0', 2)],
  }
  const { text } = buildRecallSection({ ...base, snapshot, playerBack: { turn: 9 } })
  assert.ok(text.includes('林澈'))
  assert.ok(text.includes('老陈在旧港'))
})

test('打分：关于在场他人的指针排在前面', () => {
  const snapshot = {
    p: [person('p1', 1, '老陈'), person('p2', 1, '李四')],
    c: [claim(1, 'p1', 'a', '他自己在旧港'), claim(2, 'p2', 'a', '李四欠他钱')],
    pt: [pointer('p1', 1), pointer('p1', 2)],
  }
  const { text } = buildRecallSection({ ...base, snapshot })
  const at = text.indexOf('李四欠他钱')
  const other = text.indexOf('他自己在旧港')
  assert.ok(at >= 0 && (other < 0 || at < other), '关于在场他人的排前面')
})

test('scorePointer：+3 / +2 / +2 三档都对', () => {
  const present = new Set(['p1', 'p2'])
  assert.equal(scorePointer({
    claim: claim(1, 'p2', 'a', '欠钱', 3, []),
    presentIdSet: present, selfId: 'p1', loc: '', text: '', placeWords: new Set(),
  }), 3)
  assert.equal(scorePointer({
    claim: claim(2, 'p1', 'a', '在旧港', 3, [{ 词: '旧港', 类: '地' }]),
    presentIdSet: present, selfId: 'p1', loc: '临安·旧港', text: '', placeWords: new Set(),
  }), 2)
  assert.equal(scorePointer({
    claim: claim(3, 'p1', 'a', '在旧港', 3, [{ 词: '旧港', 类: '地' }]),
    presentIdSet: present, selfId: 'p1', loc: '', text: '他走进旧港', placeWords: new Set(),
  }), 2)
})

// 程序自动抽词（2026-11-06）：模型只抽专名，通用词（收银员、受伤）由程序分词兜底。
// 否则「某人以前是收银员」这条命题在正文聊到收银员时召不回来。
test('scorePointer：通用词命中也能 +2（不依赖模型抽索引词）', () => {
  const { configureWordSegmenter } = indexWords
  configureWordSegmenter({ tokenize: (text) => (String(text).includes('收银员') ? ['收银员'] : []) })
  const present = new Set(['p1'])
  const score = scorePointer({
    claim: claim(9, 'p1', 'a', '在超市当收银员', 3, []),
    presentIdSet: present, selfId: 'p1', loc: '', text: '店里那个收银员抬头', placeWords: new Set(),
  })
  configureWordSegmenter(null)
  assert.equal(score, 2, '索引词为空，但值里的「收银员」命中了正文')
})

test('抬头带人称；没人可召回就整段空', () => {
  const snapshot = { p: [person('p1', 1, '老陈')], c: [claim(1, 'p1', 'a', '在旧港')], pt: [pointer('p1', 1)] }
  const { text } = buildRecallSection({ ...base, snapshot })
  assert.ok(text.startsWith('【人物档案参考】本局写作人称：第二人称'))
  assert.equal(buildRecallSection({ ...base, snapshot: { p: [], c: [], pt: [] } }).text, '')
})

test('字符数按码点算', () => {
  assert.equal(charCount('老陈abc'), 5)
})

// ── 召回盖章（2026-11-05 补）：把「真装进去的指针」交还调用方 ──
// 没有它，自动召回只看冷却、不写冷却 —— 「刚念叨过的人下一轮还能被念叨」。
// 交还的必须是**真给出去的**：没装下的、被预算砍掉的，一个都不能算，否则会白占冷却。

test('返回装进去的指针（调用方拿它盖召回冷却章）', () => {
  const snapshot = {
    p: [person('p1', 1, '老陈')],
    c: [claim(1, 'p1', 'a', '在旧港')],
    pt: [pointer('p1', 1)],
  }
  const { text, pointers } = buildRecallSection({ ...base, snapshot })
  assert.ok(text.includes('在旧港'))
  assert.equal(pointers.length, 1)
  assert.equal(String(pointers[0][0]), 'p1')
  assert.equal(pointers[0][1], 1)
})

test('预算把内容全砍掉时，指针也是空的（别盖没给出去的章）', () => {
  const snapshot = {
    p: [person('p1', 1, '老陈')],
    c: [claim(1, 'p1', 'a', '在旧港')],
    pt: [pointer('p1', 1)],
  }
  const { text, pointers } = buildRecallSection({ ...base, snapshot, budget: 10 })
  assert.equal(text, '')
  assert.deepEqual(pointers, [])
})

test('主角回场段装进去的指针也要交还（否则那一批永远不盖章）', () => {
  const snapshot = {
    p: [person('p0', 1, '林澈'), person('p1', 1, '老陈')],
    c: [claim(1, 'p0', 'a', '在心烦'), claim(2, 'p0', 'a', '在旧港')],
    pt: [pointer('p0', 1), pointer('p0', 2)],
  }
  const { pointers } = buildRecallSection({ ...base, snapshot, playerBack: { turn: 9 } })
  assert.equal(pointers.length, 2)
  assert.ok(pointers.every((p) => String(p[0]) === 'p0'), '只该有主角自己的指针')
})

test('没人可召回时指针是空数组', () => {
  const { pointers } = buildRecallSection({ ...base, snapshot: { p: [], c: [], pt: [] } })
  assert.deepEqual(pointers, [])
})

// ── 预算分配的两个洞（2026-11-05 查）──
// ① **没有 ★ 人物**时，starShare（60%）白留、没人用 → 普通角色只拿到 40% 预算；
// ② **★ 人物装不下**时，它那份没用完，也不回给普通角色。

test('预算：没有 ★ 人物时，普通角色拿到全部预算', () => {
  const long = '长'.repeat(500)
  const snapshot = {
    p: [person('p1', 1, '老陈')],
    c: [claim(1, 'p1', 'a', long)],
    pt: [pointer('p1', 1)],
  }
  const result = buildRecallSection({ ...base, snapshot, budget: 1000 })
  assert.ok(result.text.includes(long), '预算 1000 该装得下 500 字的一条')
})

// ── 冲突显示口径（P20：cognition.conflictDisplay）──
// 一条指针可能挂着好几组来源（他自己一组 + 几个人说的）。注入正文时显示几组由设置决定；
// 只影响**注入文本**，快照里的组一个字都不动（改回来还是全的）。

const multiSnapshot = {
  p: [person('p1', 1, '老陈'), person('p2', 0, '李四'), person('p3', 0, '王五')],
  c: [claim(1, 'p1', 'a', '在旧港')],
  pt: [pointer('p1', 1, [[TRUTH.TRUE, SELF], [TRUTH.FALSE, 'p2'], [TRUTH.TRUE, 'p3']])],
}
const cognitionOf = (conflictDisplay) => ({ conflictDisplay })

test('冲突显示：不传认知口径时全部显示（向后兼容）', () => {
  const { text } = buildRecallSection({ ...base, snapshot: multiSnapshot })
  assert.ok(text.includes('他自己确认过'))
  assert.ok(text.includes('听李四说的'))
  assert.ok(text.includes('听王五说的'))
})

test('冲突显示 all：全部显示', () => {
  const { text } = buildRecallSection({
    ...base, snapshot: multiSnapshot, cognition: cognitionOf('all'),
  })
  assert.ok(text.includes('他自己确认过'))
  assert.ok(text.includes('听李四说的'))
  assert.ok(text.includes('听王五说的'))
})

test('冲突显示 self：只显示他自己那组', () => {
  const { text } = buildRecallSection({
    ...base, snapshot: multiSnapshot, cognition: cognitionOf('self'),
  })
  assert.ok(text.includes('他自己确认过'))
  assert.ok(!text.includes('听李四说的'))
  assert.ok(!text.includes('听王五说的'))
})

test('冲突显示 self：他自己没有那组时退回全部（不要渲染出一行空白）', () => {
  const snapshot = {
    p: [person('p1', 1, '老陈'), person('p2', 0, '李四')],
    c: [claim(1, 'p1', 'a', '在旧港')],
    pt: [pointer('p1', 1, [[TRUTH.FALSE, 'p2'], [TRUTH.TRUE, 'p3']])],
  }
  const { text } = buildRecallSection({ ...base, snapshot, cognition: cognitionOf('self') })
  assert.ok(text.includes('在旧港'))
  assert.ok(text.includes('听李四说的'), '没有自述组时退回全部')
})

test('冲突显示 latest：只显示最后一组', () => {
  const { text } = buildRecallSection({
    ...base, snapshot: multiSnapshot, cognition: cognitionOf('latest'),
  })
  assert.ok(text.includes('听王五说的'), '最后一组在')
  assert.ok(!text.includes('他自己确认过'))
  assert.ok(!text.includes('听李四说的'))
})

test('冲突显示：只影响注入文本，指针里的组一组不少', () => {
  buildRecallSection({ ...base, snapshot: multiSnapshot, cognition: cognitionOf('latest') })
  assert.equal(multiSnapshot.pt[0][2].length, 3, '快照里的来源组不该被过滤掉')
})
