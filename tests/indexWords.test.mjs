// 索引词的校验与专名筛选（ADR 0021、ADR 0076、ADR 0077）
// 命题第 6 位的读写见 claimWords.test.mjs。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { WORD_MAX_CHARS, autoWordsOf, configureWordSegmenter, filterIndexWords, properNounsOf } from '../plugin/lib/indexWords.js'

test('子串校验：词必须是这条内容里的原文片段', () => {
  assert.deepEqual(filterIndexWords('在旧港码头养伤', ['旧港码头', '码头']).map((item) => item.词), ['旧港码头', '码头'])
  assert.deepEqual(filterIndexWords('在旧港码头养伤', ['林澈']), [])
  assert.deepEqual(filterIndexWords('', ['旧港码头']), [])
  assert.deepEqual(filterIndexWords('值', null), [])
})

test('子串校验：去重、丢掉超长词', () => {
  assert.deepEqual(filterIndexWords('旧港码头', ['旧港码头', '旧港码头']).map((item) => item.词), ['旧港码头'])
  const tooLong = '字'.repeat(WORD_MAX_CHARS + 1)
  assert.deepEqual(filterIndexWords(`${tooLong}的码头`, [tooLong]), [])
})

test('子串校验：类别保留，认不出的类别变 null', () => {
  const kept = filterIndexWords('香格里拉酒吧在旧港', [
    { 词: '香格里拉酒吧', 类: '地' },
    { 词: '旧港', 类: '瞎写' },
    '在旧港',
  ])
  assert.deepEqual(kept, [
    { 词: '香格里拉酒吧', 类: '地' },
    { 词: '旧港', 类: null },
    { 词: '在旧港', 类: null },
  ])
})

test('properNounsOf：只挑有类别、且不是「人」的（进全局词库用）', () => {
  const words = [
    { 词: '香格里拉酒吧', 类: '地' },
    { 词: '林澈', 类: '人' },
    { 词: '旧港', 类: null },
    { 词: '镖局', 类: '组织' },
  ]
  assert.deepEqual(properNounsOf(words), ['香格里拉酒吧', '镖局'])
  assert.deepEqual(properNounsOf(null), [])
})

// ── 程序自动抽词（2026-11-06）：模型只抽专名，通用词由程序分出来 ──
// 为什么：模型抽索引词要判断"该不该抽"，既费 token 又会漏（职业词被"通用职业不抽"挡掉，
// 正文聊到"收银员"时那条命题就召不回来）。程序分词不费力、不会漏。

test('自动抽词：没有分词器时返回空（不影响老调用方）', () => {
  assert.deepEqual(autoWordsOf('小明在超市当收银员'), [])
})

test('自动抽词：只留 2 字以上的词，虚词自动被过滤', () => {
  const seg = {
    tokenize: (text) => String(text).match(/[\u4e00-\u9fa5]+|[0-9]+/g) ?? [],
  }
  configureWordSegmenter(seg)
  // 用一个真实点的假分词器：把长句按词典行为切成词与单字混合
  const fake = {
    tokenize: (text) => {
      const table = [
        '小明', '在', '超市', '当', '收银员',
      ]
      return String(text) === '小明在超市当收银员' ? table : String(text).split('')
    },
  }
  configureWordSegmenter(fake)
  assert.deepEqual(autoWordsOf('小明在超市当收银员'), ['小明', '超市', '收银员'])
  configureWordSegmenter(null)
})

test('自动抽词：纯数字、重复词、超长词都去掉', () => {
  configureWordSegmenter({ tokenize: () => ['三十两', '三十两', '1234', '一个字', '香格里拉酒吧'] })
  const words = autoWordsOf('随便')
  assert.deepEqual(words, ['三十两', '一个字', '香格里拉酒吧'])
  assert.ok(words.every((w) => [...w].length >= 2), '不许留单字')
  configureWordSegmenter(null)
})

test('自动抽词：泛词表挡掉高频词，名词照留', () => {
  configureWordSegmenter({ tokenize: () => ['提出', '主动', '来到', '收银员', '超市', '药铺'] })
  assert.deepEqual(autoWordsOf('随便'), ['收银员', '超市', '药铺'])
  configureWordSegmenter(null)
})

// 去重（2026-11-06 用户要求）：同一个词不该既算索引词又算自动词。
// 注意：打分本来就是「索引词命中 || 自动词命中」，短路只会加一次分；
// 去重是为了面板不重复显示、也防止以后有人把这里改成累加。
test('去重：索引词已含的自动词被排除', () => {
  configureWordSegmenter({ tokenize: () => ['收银员', '超市', '药铺'] })
  assert.deepEqual(autoWordsOf('随便', ['收银员']), ['超市', '药铺'])
  assert.deepEqual(autoWordsOf('随便', [{ 词: '超市' }]), ['收银员', '药铺'])
  assert.deepEqual(autoWordsOf('随便', []), ['收银员', '超市', '药铺'])
  assert.deepEqual(autoWordsOf('随便'), ['收银员', '超市', '药铺'])
  configureWordSegmenter(null)
})

test('去重：索引词为空/undefined 时不误删', () => {
  configureWordSegmenter({ tokenize: () => ['收银员'] })
  assert.deepEqual(autoWordsOf('随便', null), ['收银员'])
  assert.deepEqual(autoWordsOf('随便', undefined), ['收银员'])
  configureWordSegmenter(null)
})
