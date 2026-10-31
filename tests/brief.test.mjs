// 简版装配（4 层：唯一值 / MVU 窗口 / 最重要的 / 再一条）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MVU_WINDOW, PRESENT_STATUSES, buildBrief, presentIdsFrom } from '../plugin/lib/brief.js'

// 条目：[条目码, 值, 信度位, 轮次]
const entry = (code, text, confidence = '6', turn = 10) => [code, text, confidence, turn]
const textOf = (e) => String(e[1])

const fixed = (value) => () => value

test('在场算上容灾在场：状态 1 和 3 都算', () => {
  assert.deepEqual(PRESENT_STATUSES, [1, 3])
  const persons = [['p1', 0, '甲', [], ''], ['p2', 1, '乙', [], ''], ['p3', 2, '丙', [], ''], ['p4', 3, '丁', [], '']]
  const present = presentIdsFrom(persons)
  assert.deepEqual([...present].sort(), ['p2', 'p4'])
})

test('什么都没勾就不带任何东西', () => {
  const result = buildBrief({
    entries: [entry('a', '老陈')],
    checkedCodes: new Set(),
    uniqueCodes: new Set(['a']),
    presentIds: new Set(['p2']),
    textOf,
  })
  assert.equal(result.text, '')
  assert.deepEqual(result.parts, { unique: [], mvu: [], top: null, extra: null })
})

test('唯一值条目：勾了就必带，不勾不带', () => {
  const entries = [entry('a', '老陈'), entry('b', '旧港')]
  const on = buildBrief({ entries, checkedCodes: new Set(['a', 'b']), uniqueCodes: new Set(['a']), presentIds: new Set(), textOf })
  assert.deepEqual(on.parts.unique.map(textOf), ['老陈'])

  const off = buildBrief({ entries, checkedCodes: new Set(['b']), uniqueCodes: new Set(['a']), presentIds: new Set(), textOf })
  assert.deepEqual(off.parts.unique, [])
})

test('MVU 值单独一个 30 字符窗口：从短到长填，到 30 截断', () => {
  const entries = [
    entry('a', '一二三四五六七八九十', '9'), // 10
    entry('a', '一二三', '9'),               // 3
    entry('a', '一二三四五', '9'),           // 5
  ]
  const result = buildBrief({
    entries,
    checkedCodes: new Set(['a']),
    uniqueCodes: new Set(),
    presentIds: new Set(),
    textOf,
  })
  // 3 + 5 + 10 = 18，全放得下
  assert.deepEqual(result.parts.mvu.map(textOf), ['一二三', '一二三四五', '一二三四五六七八九十'])
  assert.equal(result.mvuChars, 18)
})

test('MVU 超过 30 字符就不再加', () => {
  const entries = [
    entry('a', '一'.repeat(20), '9'),
    entry('a', '二'.repeat(15), '9'), // 20 + 15 = 35 > 30
    entry('a', '三'.repeat(5), '9'),  // 20 + 5 = 25，放得下
  ]
  const result = buildBrief({ entries, checkedCodes: new Set(['a']), uniqueCodes: new Set(), presentIds: new Set(), textOf })
  assert.equal(MVU_WINDOW, 30)
  // 从短到长：5、15、20 → 5+15=20 放得下，再加 20 就 40 超了，截断
  assert.deepEqual(result.parts.mvu.map(textOf), ['三'.repeat(5), '二'.repeat(15)])
  assert.equal(result.mvuChars, 20)
})

test('MVU 只从勾选条目里取', () => {
  const entries = [entry('a', '甲', '9'), entry('b', '乙', '9')]
  const result = buildBrief({ entries, checkedCodes: new Set(['a']), uniqueCodes: new Set(), presentIds: new Set(), textOf })
  assert.deepEqual(result.parts.mvu.map(textOf), ['甲'])
})

test('第三条：来源必须在上一轮在场人员里，且取排序最高的那条', () => {
  const entries = [
    entry('a', '不在场的人说的', 'rp9', 30),
    entry('a', '在场但旧的', 'rp2', 10),
    entry('a', '在场且新的', 'rp4', 20),
  ]
  const result = buildBrief({
    entries,
    checkedCodes: new Set(['a']),
    uniqueCodes: new Set(),
    presentIds: new Set(['p2', 'p4']),
    textOf,
  })
  assert.equal(textOf(result.parts.top), '在场且新的')
})

test('第三条：在场人员一个都不是来源时，这条不带', () => {
  const result = buildBrief({
    entries: [entry('a', '路人说的', 'rp9'), entry('a', '他自己说的', '4')],
    checkedCodes: new Set(['a']),
    uniqueCodes: new Set(),
    presentIds: new Set(['p2']),
    textOf,
  })
  assert.equal(result.parts.top, null)
})

test('第四条：来源在场但和第三条不是同一个人，随机取一条', () => {
  const entries = [
    entry('a', '来自p2', 'rp2', 10),
    entry('a', '来自p4', 'rp4', 20),
    entry('a', '来自p9', 'rp9', 30),
  ]
  // rng 固定取第 0 个 → 候选是 p4/p9 两条，取 p4
  const result = buildBrief({
    entries,
    checkedCodes: new Set(['a']),
    uniqueCodes: new Set(),
    presentIds: new Set(['p2', 'p4', 'p9']),
    textOf,
    rng: fixed(0),
  })
  assert.equal(textOf(result.parts.top), '来自p9')   // 排序最高：轮次最新
  assert.equal(textOf(result.parts.extra), '来自p4') // 排除 p9 后，rng=0 取第一条
})

test('第四条：没有其它在场来源时不带', () => {
  const result = buildBrief({
    entries: [entry('a', '只有p2', 'rp2'), entry('a', '一条p4', 'rp4')],
    checkedCodes: new Set(['a']),
    uniqueCodes: new Set(),
    presentIds: new Set(['p2']),   // p4 不在场
    textOf,
  })
  assert.equal(textOf(result.parts.top), '只有p2')
  assert.equal(result.parts.extra, null)
})

test('同一个值不会在简版里出现两次', () => {
  const result = buildBrief({
    entries: [entry('a', '受伤', '9')],   // 是 MVU 值，同时来源字段是空的
    checkedCodes: new Set(['a']),
    uniqueCodes: new Set(),
    presentIds: new Set(['p2']),
    textOf,
  })
  assert.deepEqual(result.parts.mvu.map(textOf), ['受伤'])
  assert.equal(result.parts.top, null)
})

test('四层拼成一行', () => {  const entries = [
    entry('a', '老陈', '6'),
    entry('b', '受伤', '9'),
    entry('c', '旧友', 'rp2'),
    entry('d', '欠账', 'rp4'),
  ]
  const result = buildBrief({
    entries,
    checkedCodes: new Set(['a', 'b', 'c', 'd']),
    uniqueCodes: new Set(['a']),
    presentIds: new Set(['p2', 'p4']),
    textOf,
    rng: fixed(0),
  })
  assert.equal(result.text, '老陈·受伤·旧友·欠账')
  assert.equal(result.chars, 11)   // 2+1+2+1+2+1+2
})

test('最后确认轮次强制带，跟在行尾', () => {
  const result = buildBrief({
    entries: [entry('a', '老陈', '6')],
    checkedCodes: new Set(['a']),
    uniqueCodes: new Set(['a']),
    presentIds: new Set(),
    textOf,
    confirmTurn: 20,
  })
  assert.equal(result.text, '老陈·第20轮')
})

test('什么都没勾时，轮次也照样带', () => {
  const result = buildBrief({
    entries: [],
    checkedCodes: new Set(),
    uniqueCodes: new Set(),
    presentIds: new Set(),
    textOf,
    confirmTurn: 20,
  })
  assert.equal(result.text, '第20轮')
  assert.equal(result.chars, 4)
})

test('没给轮次就不加', () => {
  const result = buildBrief({ entries: [], checkedCodes: new Set(), uniqueCodes: new Set(), presentIds: new Set(), textOf })
  assert.equal(result.text, '')
})
