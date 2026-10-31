// 字典（设计稿 §4.3 收录规则、§4.5 存储与索引、§4.6 滚动回收）
// 数字规则按「暂定 B」：>8 汉字无条件收；4～8 汉字才看含不含数字。
// 「第二次出现才收」已取消（ADR 0006）：4～8 汉字首次就收。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { TYPE, classify, createDictionary, openDictionary } from '../plugin/lib/dictionary.js'
import { DICT_RAW } from './fixtures/sample.mjs'

const LONG = '他站在旧港码头边的木栈桥上'   // 13 个汉字
const EIGHT = '碧海潮生按玉箫声'             // 8 个汉字
const NINE = '碧海潮生按玉箫声起'            // 9 个汉字
const SHORT = '木栈桥'                       // 3 个汉字

test('分类：超过 8 个汉字一律收录，含数字也收', () => {
  assert.equal(classify(NINE), 'now')
  assert.equal(classify('他一个人守在旧港码头边上'), 'now')   // 含中文数字，但超过 8 字
  assert.equal(classify('旧港码头27号仓附近的木栈桥'), 'now') // 含阿拉伯数字，但超过 8 字
})

test('分类：4～8 个汉字不带数字才收', () => {
  assert.equal(classify(EIGHT), 'now')
  assert.equal(classify('三个月后'), 'never')   // 4 个汉字 + 数字
  assert.equal(classify('三天后'), 'never')     // 3 个汉字
  assert.equal(classify('27岁'), 'never')       // 2 个汉字
})

test('分类：少于 4 个汉字、纯英文、纯标点、空白都不收', () => {
  assert.equal(classify(SHORT), 'never')
  assert.equal(classify('the old harbour'), 'never')
  assert.equal(classify('……'), 'never')
  assert.equal(classify('   '), 'never')
})

test('分类：人名、地名、MVU 值永不收录', () => {
  assert.equal(classify(LONG, TYPE.PERSON), 'never')
  assert.equal(classify(LONG, TYPE.PLACE), 'never')
  assert.equal(classify(LONG, TYPE.MVU), 'never')
})

test('长句首次出现就成为字典下标', () => {
  const dict = openDictionary(createDictionary())
  assert.equal(dict.encode(LONG), 0)
  assert.equal(dict.size, 1)
})

test('4～8 个汉字也是首次出现就收录', () => {
  const dict = openDictionary(createDictionary())
  assert.equal(dict.encode(EIGHT), 0)
  assert.equal(dict.size, 1)
})

test('同一句话多次编码得到同一个下标；不收录的词永远返回原文', () => {
  const dict = openDictionary(createDictionary())
  assert.equal(dict.encode(LONG), dict.encode(LONG))
  assert.equal(dict.size, 1)
  assert.equal(dict.encode(SHORT), SHORT)
  assert.equal(dict.encode(SHORT), SHORT)
  assert.equal(dict.size, 1)
})

test('解码：数字取回原文，字符串原样返回，越界/非法返回 null', () => {
  const dict = openDictionary(DICT_RAW)
  assert.equal(dict.decode(0), '他站在旧港码头边的木栈桥上')
  assert.equal(dict.decode('原文就长这样'), '原文就长这样')
  assert.equal(dict.decode(999), null)
  assert.equal(dict.decode(-1), null)
  assert.equal(dict.decode(1.5), null)
})

test('落盘只有 v/d/t；坏槽位保留占位，后面的下标绝不前移', () => {
  const dict = openDictionary(createDictionary())
  dict.encode(LONG)
  assert.deepEqual(dict.snapshot(), { v: 1, d: [LONG], t: [TYPE.COMMON] })

  const broken = openDictionary({ v: 1, d: ['老陈', '', '相濡以沫'], t: [1, 4, 4] })
  assert.equal(broken.size, 3)
  assert.equal(broken.decode(1), null)
  assert.equal(broken.decode(2), '相濡以沫')
})

test('读回结构性坏数据退回空字典；版本更高时转只读', () => {
  for (const raw of [null, undefined, {}, { d: 'x' }]) assert.equal(openDictionary(raw).size, 0)

  const readOnly = openDictionary({ v: 2, d: ['老陈'], t: [1] })
  assert.equal(readOnly.readOnly, true)
  assert.equal(readOnly.encode(LONG), LONG)
  assert.equal(readOnly.size, 1)
})

test('未被引用的下标按最早收录优先列出；原地替换不改下标', () => {
  const dict = openDictionary(DICT_RAW)
  assert.deepEqual(dict.unusedSlots(new Set([0])), [1])

  dict.replaceAt(1, '另一句很长的原文了', TYPE.COMMON)
  assert.equal(dict.size, 2)
  assert.equal(dict.decode(1), '另一句很长的原文了')
  assert.equal(dict.indexOf('碧海潮生按玉箫声'), -1)
})

test('snapshot 是深拷贝', () => {
  const dict = openDictionary(DICT_RAW)
  const raw = dict.snapshot()
  raw.d.push('偷偷塞进去的')
  assert.equal(dict.size, 2)
})
