// 字典（设计稿 §4.3 收录规则、§4.5 存储与索引、§4.6 滚动回收）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { TYPE, classify, createDictionary, openDictionary } from '../plugin/lib/dictionary.js'

// 测试用样本（都不含数字，避免和「含数字不收录」这条规则互相干扰）
const LONG = '他站在旧港码头边的木栈桥上'   // 13 个汉字 → 首次就收
const EIGHT = '碧海潮生按玉箫声'             // 8 个汉字 → 第二次才收
const NINE = '碧海潮生按玉箫声起'            // 9 个汉字 → 首次就收
const SHORT = '木栈桥'                       // 3 个汉字 → 不收

test('分类：超过 8 个汉字首次收录，4～8 个第二次收录，少于 4 个永不收录', () => {
  assert.equal(classify(NINE), 'now')
  assert.equal(classify(EIGHT), 'second')
  assert.equal(classify(SHORT), 'never')
})

test('分类：含数字的混合串永不收录', () => {
  assert.equal(classify('三天后'), 'never')
  assert.equal(classify('旧港码头27号仓'), 'never')
})

test('分类：纯英文、纯标点、空白永不收录', () => {
  assert.equal(classify('the old harbour'), 'never')
  assert.equal(classify('……'), 'never')
  assert.equal(classify('   '), 'never')
})

test('分类：人名、地名、MVU 值即使很长也永不收录', () => {
  assert.equal(classify(LONG, TYPE.PERSON), 'never')
  assert.equal(classify(LONG, TYPE.PLACE), 'never')
  assert.equal(classify(LONG, TYPE.MVU), 'never')
})

test('首次编码：长句立刻变成字典下标', () => {
  const dict = openDictionary(createDictionary())
  assert.equal(dict.encode(LONG), 0)
  assert.equal(dict.size, 1)
})

test('首次编码：4～8 个汉字先保持原文，第二次才变成下标', () => {
  const dict = openDictionary(createDictionary())
  assert.equal(dict.encode(EIGHT), EIGHT)
  assert.equal(dict.size, 0)
  assert.equal(dict.encode(EIGHT), 0)
  assert.equal(dict.size, 1)
})

test('同一句话多次编码得到同一个下标', () => {
  const dict = openDictionary(createDictionary())
  const first = dict.encode(LONG)
  const second = dict.encode(LONG)
  assert.equal(first, second)
  assert.equal(dict.size, 1)
})

test('不收录的词永远返回原文', () => {
  const dict = openDictionary(createDictionary())
  assert.equal(dict.encode(SHORT), SHORT)
  assert.equal(dict.encode(SHORT), SHORT)
  assert.equal(dict.size, 0)
})

test('解码：数字取回原文，字符串原样返回，越界返回 null', () => {
  const dict = openDictionary(createDictionary())
  const index = dict.encode(LONG)
  assert.equal(dict.decode(index), LONG)
  assert.equal(dict.decode('原文就长这样'), '原文就长这样')
  assert.equal(dict.decode(999), null)
})

test('落盘的只有 v/d/t 两个并行数组', () => {
  const dict = openDictionary(createDictionary())
  dict.encode(LONG)
  dict.encode(EIGHT)
  dict.encode(EIGHT)
  assert.deepEqual(dict.snapshot(), { v: 1, d: [LONG, EIGHT], t: [TYPE.COMMON, TYPE.COMMON] })
})

test('读回落盘数据后反向索引能重建', () => {
  const dict = openDictionary(createDictionary())
  dict.encode(LONG)
  const reloaded = openDictionary(dict.snapshot())
  assert.equal(reloaded.size, 1)
  assert.equal(reloaded.encode(LONG), 0)
})

test('读回坏数据时退回空字典，不抛错', () => {
  for (const raw of [null, undefined, {}, { d: 'x' }, { d: [1, 2], t: [] }]) {
    assert.equal(openDictionary(raw).size, 0)
  }
})

test('snapshot 是深拷贝，改它不影响字典本身', () => {
  const dict = openDictionary(createDictionary())
  dict.encode(LONG)
  const raw = dict.snapshot()
  raw.d.push('偷偷塞进去的')
  assert.equal(dict.size, 1)
  assert.equal(dict.decode(0), LONG)
})

test('未被引用的下标按「最早收录」优先列出', () => {
  const dict = openDictionary(createDictionary())
  dict.encode(LONG)
  dict.encode(NINE)
  dict.encode(EIGHT)
  dict.encode(EIGHT)
  assert.deepEqual(dict.unusedSlots(new Set()), [0, 1, 2])
  assert.deepEqual(dict.unusedSlots(new Set([0])), [1, 2])
})

test('原地替换：下标不变、旧词失联、大小不变', () => {
  const dict = openDictionary(createDictionary())
  dict.encode(LONG)
  dict.encode(NINE)
  dict.replaceAt(0, '另一句很长的原文了', TYPE.COMMON)
  assert.equal(dict.size, 2)
  assert.equal(dict.decode(0), '另一句很长的原文了')
  assert.equal(dict.indexOf(LONG), -1)
  assert.equal(dict.encode(LONG), 2)   // 旧词再出现时当新词处理
})
