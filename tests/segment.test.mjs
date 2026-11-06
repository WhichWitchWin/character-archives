// 中文分词：正向最大匹配（FMM）+ 用户词典
//
// 为什么需要它：匹配层现在是纯字串包含 `text.includes(name)`，中文没有空格，
// 「周」会在「周末」里命中、「阿明」会在「阿明白了」里命中。有了词边界才判得准。
//
// **关键前提**：人名通常不在通用词表里（「老陈」「周老板」都不是标准词），
// 所以必须把已建档的姓名/别名注册进用户词典，否则「老陈」会被切成「老/陈」，
// 反而更容易误命中。
//
// 词表来源：jieba 0.42.1 的 extra_dict/dict.txt.small（MIT，见 assets/dict/LICENSE-jieba.txt），
// 去掉词性只留「词 词频」，10.9 万词、1.34 MB。
//
// 纯逻辑模块：不读文件、不 import 酒馆接口，词表文本由调用方传进来。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createSegmenter, parseDict } from '../plugin/lib/segment.js'

// 造一份小词表：格式和真词表一样「词 词频」
const DICT_TEXT = [
  '周末 654',
  '周一 300',
  '四周 2785',
  '周 8326',
  '陈 5608',
  '老板 2000',
  '老板来 5',
  '阿明 24',
  '明白 900',
  '的了 100',
  '的 3188252',
  '了 883634',
  '来了 500',
].join('\n')

const make = (extraWords) => createSegmenter({ dictText: DICT_TEXT, extraWords })

test('parseDict：读出词表、最长词长、词频', () => {
  const dict = parseDict(DICT_TEXT)
  assert.equal(dict.size, 13)
  assert.equal(dict.maxLen, 3)
  assert.equal(dict.freq('周末'), 654)
  assert.equal(dict.freq('不存在'), 0)
})

test('最大匹配：优先长词，「周末」不会被切成「周」+「末」', () => {
  const seg = make()
  const tokens = seg.tokenize('周末的集市很热闹')
  assert.ok(tokens.includes('周末'))
  assert.ok(!tokens.includes('周'), '周末整体成词，不该切出「周」')
  // 玩具词表里有「老板来」这个三字词，所以会切成 周|老板来|了；重点是「周」独立成词
  assert.equal(seg.tokenize('周老板来了')[0], '周')
})

test('hasWord：按词边界判断，不做子串包含', () => {
  const seg = make()
  assert.equal(seg.hasWord('周末的集市很热闹', '周'), false)
  assert.equal(seg.hasWord('周老板来了', '周'), true)
  assert.equal(seg.hasWord('陈老板来了', '陈'), true)
  assert.equal(seg.hasWord('阿明白了', '阿明'), false, '「阿明白了」应先切「明白」')
})

test('用户词典优先：把「老陈」注册进去，它就能成词', () => {
  const plain = make()
  assert.equal(plain.hasWord('老陈推门进来', '老陈'), false, '通用词表里没有「老陈」')

  const withUser = make(['老陈', '周老板'])
  assert.equal(withUser.hasWord('老陈推门进来', '老陈'), true)
  assert.equal(withUser.hasWord('周老板来了', '周老板'), true)
})

test('用户词典里的长词压过词表里的短词', () => {
  const seg = make(['周老板'])      // 词表里有「老板」「老板来」
  assert.deepEqual(seg.tokenize('周老板来了'), ['周老板', '来了'])
})

test('英文和数字不炸：连续字母数字整体当一个词', () => {
  const seg = make()
  assert.deepEqual(seg.tokenize('HP50点'), ['HP50', '点'])
  assert.deepEqual(seg.tokenize('abc'), ['abc'])
})

test('空词表也不崩：退回按单字切', () => {
  const seg = createSegmenter({ dictText: '', extraWords: [] })
  assert.deepEqual(seg.tokenize('周末'), ['周', '末'])
})

test('找不到可用词的字符也照常输出，不会丢内容', () => {
  const seg = make()
  const text = '「周末」来了！'
  const joined = seg.tokenize(text).join('')
  // 标点会被过滤掉，但中文内容一个都不能少
  assert.equal(joined.replace(/[「」！]/g, ''), '周末来了')
})
