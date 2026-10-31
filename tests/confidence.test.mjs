// 信度体系（设计稿 §5.1 状态码、§5.5 关闭信度时的保留规则）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_ORDER,
  SOURCE,
  TRUTH,
  compareEntries,
  formatConfidence,
  parseConfidence,
  selectKept,
} from '../plugin/lib/confidence.js'

const entry = (code, turn, label = 'x') => ['a', label, code, turn]

test('固定码 0～8：用户/自述/他述 × 真/未定/假', () => {
  assert.deepEqual(parseConfidence('0'), { source: SOURCE.USER, truth: TRUTH.TRUE, via: null })
  assert.deepEqual(parseConfidence('1'), { source: SOURCE.USER, truth: TRUTH.UNKNOWN, via: null })
  assert.deepEqual(parseConfidence('2'), { source: SOURCE.USER, truth: TRUTH.FALSE, via: null })
  assert.deepEqual(parseConfidence('3'), { source: SOURCE.SELF, truth: TRUTH.TRUE, via: null })
  assert.deepEqual(parseConfidence('4'), { source: SOURCE.SELF, truth: TRUTH.UNKNOWN, via: null })
  assert.deepEqual(parseConfidence('5'), { source: SOURCE.SELF, truth: TRUTH.FALSE, via: null })
  assert.deepEqual(parseConfidence('6'), { source: SOURCE.OTHER, truth: TRUTH.TRUE, via: null })
  assert.deepEqual(parseConfidence('7'), { source: SOURCE.OTHER, truth: TRUTH.UNKNOWN, via: null })
  assert.deepEqual(parseConfidence('8'), { source: SOURCE.OTHER, truth: TRUTH.FALSE, via: null })
})

test('9 = MVU，X = 无信度，N = 不标信度', () => {
  assert.equal(parseConfidence('9').source, SOURCE.MVU)
  assert.equal(parseConfidence('X').source, SOURCE.NONE)
  assert.equal(parseConfidence('N').source, SOURCE.UNMARKED)
})

test('r 开头的来源引用：不带后缀未定，+ 真，- 假，来源号进 via', () => {
  assert.deepEqual(parseConfidence('r42'), { source: SOURCE.OTHER, truth: TRUTH.UNKNOWN, via: 42 })
  assert.deepEqual(parseConfidence('r42+'), { source: SOURCE.OTHER, truth: TRUTH.TRUE, via: 42 })
  assert.deepEqual(parseConfidence('r42-'), { source: SOURCE.OTHER, truth: TRUTH.FALSE, via: 42 })
})

test('非法信度位一律返回 null，不猜', () => {
  for (const code of ['', 'a', 'r', 'r-1', 'r42++', '42', 'x', 'n', '10', null, undefined, 9]) {
    assert.equal(parseConfidence(code), null, `应拒绝：${String(code)}`)
  }
})

test('format 与 parse 能往返（全部合法码）', () => {
  const codes = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'X', 'N', 'r42', 'r42+', 'r42-']
  for (const code of codes) {
    assert.equal(formatConfidence(parseConfidence(code)), code)
  }
})

test('format 拒绝拼不出来的组合', () => {
  assert.equal(formatConfidence({ source: 'user', truth: 'maybe' }), null)
  assert.equal(formatConfidence({ source: SOURCE.OTHER }), null)          // 他述必须带 via
  assert.equal(formatConfidence({ source: SOURCE.OTHER, via: -1 }), null)
  assert.equal(formatConfidence({}), null)
})

test('format 不会把拼错的真值悄悄降级成「未定」', () => {
  assert.equal(formatConfidence({ source: SOURCE.OTHER, truth: 'maybe', via: 42 }), null)
  assert.equal(formatConfidence({ source: SOURCE.OTHER, truth: TRUTH.UNKNOWN, via: 42 }), 'r42')
  assert.equal(formatConfidence({ source: SOURCE.OTHER, truth: TRUTH.FALSE, via: 42 }), 'r42-')
})

test('排序键不认识或为空时回落默认顺序，不静默判平', () => {
  const older = entry('6', 10, '旧')
  const newer = entry('6', 30, '新')
  assert.ok(compareEntries(newer, older, { order: [] }) < 0)
  assert.ok(compareEntries(newer, older, { order: ['triple'] }) < 0)
})

test('排序默认顺序与设计稿一致：轮次→来源关键度→真值→来源', () => {
  assert.deepEqual(DEFAULT_ORDER, ['turn', 'salience', 'truth', 'source'])
})

test('排序：轮次新的排前面', () => {
  const older = entry('6', 10, '旧')
  const newer = entry('6', 20, '新')
  assert.ok(compareEntries(newer, older) < 0)
  assert.ok(compareEntries(older, newer) > 0)
})

test('排序：同轮次时来源关键度高者优先（用户 999999 最高）', () => {
  const byUser = entry('0', 10, '用户说的')
  const byOther = entry('6', 10, '路人说的')
  const salienceOf = (e) => (e[2] === '0' ? 999999 : 3)
  assert.ok(compareEntries(byUser, byOther, { salienceOf }) < 0)
})

test('排序：真值 真 → 未定 → 假', () => {
  const salienceOf = () => 1
  const t = entry('6', 10, '真')
  const u = entry('7', 10, '未定')
  const f = entry('8', 10, '假')
  assert.ok(compareEntries(t, u, { salienceOf }) < 0)
  assert.ok(compareEntries(u, f, { salienceOf }) < 0)
  assert.ok(compareEntries(t, f, { salienceOf }) < 0)
})

test('排序：来源 用户 → 自述 → 他述', () => {
  const salienceOf = () => 1
  assert.ok(compareEntries(entry('1', 10), entry('4', 10), { salienceOf }) < 0)
  assert.ok(compareEntries(entry('4', 10), entry('7', 10), { salienceOf }) < 0)
})

test('排序：四项优先级可由玩家拖动改变', () => {
  const older = entry('0', 10, '旧但来源高')
  const newer = entry('8', 20, '新但来源低')
  const salienceOf = (e) => (e[2] === '0' ? 999999 : 0)
  // 默认先看轮次：新的优先
  assert.ok(compareEntries(newer, older, { salienceOf }) < 0)
  // 改成先看来源关键度：用户说的那条优先
  assert.ok(compareEntries(older, newer, { order: ['salience', 'turn'], salienceOf }) < 0)
})

test('保留规则：N（不标信度）全部保留，不参与排序也不被丢弃', () => {
  const older = entry('6', 10, '旧值')
  const newer = entry('8', 30, '新值')
  const entries = [entry('N', 5, '形象一'), entry('N', 6, '形象二'), older, newer]
  const { kept, dropped } = selectKept(entries)
  assert.equal(kept.filter((e) => e[2] === 'N').length, 2)   // 两条 N 都活着
  assert.deepEqual(kept.filter((e) => e[2] !== 'N'), [newer]) // 普通值里只有新的留下
  assert.deepEqual(dropped, [older])
})

test('保留规则：有 MVU 值时只留最新那条 MVU，其余全丢', () => {
  const mvuOld = entry('9', 10, 'MVU 旧')
  const mvuNew = entry('9', 30, 'MVU 新')
  const userValue = entry('0', 40, '用户手填')
  const { kept, dropped } = selectKept([mvuOld, mvuNew, userValue])
  assert.deepEqual(kept, [mvuNew])
  assert.deepEqual(dropped, [mvuOld, userValue])
})

test('保留规则：没有 MVU 时才排序，只留排第一的那条', () => {
  const newest = entry('8', 30, '新的但是假的')
  const older = entry('0', 10, '旧但是用户说的')
  const { kept, dropped } = selectKept([older, newest])
  assert.deepEqual(kept, [newest])
  assert.deepEqual(dropped, [older])
})

test('保留规则：信度位坏掉的条目按丢弃处理，不猜', () => {
  const good = entry('0', 10, '好的')
  const broken = entry('???', 20, '坏的')
  const { kept, dropped } = selectKept([good, broken])
  assert.deepEqual(kept, [good])
  assert.deepEqual(dropped, [broken])
})
