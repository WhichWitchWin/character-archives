// 文本匹配（A1）：从本轮玩家输入与最近几轮正文里找出「谁命中」
// 依据：设计稿 §7.4 / §7.10 + 交接文档「九、明天第一步建议」
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'

import { matchPerson, matchText, mergeClueWords } from '../plugin/lib/match.js'

import { readFileSync } from 'node:fs'
import { createSegmenter } from '../plugin/lib/segment.js'
import { configureSegmenter } from '../plugin/lib/match.js'

// 用**真实词表**跑测试：测试行为 == 线上行为，不用玩具词表自欺欺人
const DICT = readFileSync(new URL('../plugin/assets/dict/zh.txt', import.meta.url), 'utf8')
const seg = createSegmenter({ dictText: DICT })
configureSegmenter(seg)

// 线上行为：接线处每轮把**当前人物的姓名/别名**灌进用户词典。
// 测试里给一份默认名单，个别用例会临时清空（测"没注册会漏"）。
const DEFAULT_NAMES = ['老陈', '陈先生', '老陈头', '老周', '小周', '阿周', '周老板', '周先生', '周姑娘', '周总', 'Alice', 'bob']
seg.setExtraWords(DEFAULT_NAMES)

// 每个用例结束后恢复默认名单：某个用例清空了词典，不能污染后面的用例
afterEach(() => { seg.setExtraWords(DEFAULT_NAMES) })

const EMPTY = { name: false, alias: false, singleName: false, clues: 0, clueWords: [] }

test('姓名命中：正文里出现完整姓名', () => {
  assert.deepEqual(matchText('老陈推门进来，抖了抖伞上的水。', { name: '老陈' }), {
    name: true,
    alias: false,
    singleName: false,
    clues: 0,
    clueWords: [],
  })
})

test('姓名没完整出现就不算命中（只有姓氏、或根本不在）', () => {
  assert.equal(matchText('陈推门进来。', { name: '老陈' }).name, false)
  assert.equal(matchText('掌柜的推门进来。', { name: '老陈' }).name, false)
})

test('别名命中：命中任意一个别名就算', () => {
  const person = { name: '老陈', aliases: ['陈先生', '老陈头'] }
  assert.equal(matchText('陈先生笑了。', person).alias, true)
  assert.equal(matchText('老陈头笑了。', person).alias, true)
  assert.equal(matchText('掌柜的笑了。', person).alias, false)
})

test('别名既能传数组，也能传快照里的逗号串（半角/全角都认）', () => {
  // 主名特意避开「老陈头」：这里只想测逗号串拆分，不想让「老陈⊂老陈头」的子串行为混进来
  assert.equal(matchText('老陈头', { name: '掌柜', aliases: '陈先生,老陈头' }).alias, true)
  assert.equal(matchText('老陈头', { name: '掌柜', aliases: '陈先生，老陈头' }).alias, true)
  assert.equal(matchText('掌柜的', { name: '掌柜', aliases: '陈先生,,  ' }).alias, false)
})

test('单字名：按词边界判断，周末/周围/周天子 不算命中', () => {
  seg.setExtraWords([])
  for (const text of ['周末去集市', '周围很安静', '周天子在位']) {
    assert.equal(matchText(text, { name: '周' }).singleName, false, `${text} 不该命中`)
  }
})

test('单字名：独立成词才算命中（不再靠称谓表猜）', () => {
  seg.setExtraWords([])
  // 通用词表里没有「周老板」，会被切成 周|老板 → 「周」独立成词
  for (const text of ['周老板来了', '周先生点头', '问问周，他在哪']) {
    const result = matchText(text, { name: '周' })
    assert.equal(result.singleName, true, `${text} 该命中`)
    assert.equal(result.name, false, '单字永不冒充姓名（只给弱证据）')
  }
  // 一旦「老周」注册进用户词典，它整体成词，「周」不再独立 → 不命中
  seg.setExtraWords(['老周'])
  assert.equal(matchText('这时老周走进来', { name: '周' }).singleName, false)
  seg.setExtraWords(DEFAULT_NAMES)
})

test('单字名：姓名只给弱证据；两字别名照常按别名算', () => {
  const result = matchText('周老板来了', { name: '周', aliases: '周老板' })
  assert.equal(result.name, false, '单字永不冒充姓名')
  assert.equal(result.alias, true, '「周老板」是两字别名，按词边界命中就该算别名')
})

test('单字别名：同样只算弱证据', () => {
  seg.setExtraWords([])
  assert.equal(matchText('周围没人', { name: '某人', aliases: '周' }).singleName, false)
  assert.equal(matchText('周来了', { name: '某人', aliases: '周' }).singleName, true)
})

test('玩家输入与正文同一口径：不再分两套规则', () => {
  seg.setExtraWords([])
  const fromInput = matchPerson({ name: '周' }, { input: '周老板来了', texts: [] })
  const fromBody = matchPerson({ name: '周' }, { input: '', texts: ['周老板来了'] })
  assert.equal(fromInput.singleName, true)
  assert.equal(fromBody.singleName, true)
})

test('多字姓名：用户词典没注册就会被切开，注册后才算命中', () => {
  seg.setExtraWords([])
  assert.equal(matchText('老陈推门进来', { name: '老陈' }).name, false, '通用词表里没有「老陈」')

  seg.setExtraWords(['老陈'])
  assert.equal(matchText('老陈推门进来', { name: '老陈' }).name, true)
  seg.setExtraWords([])
})

test('对抗：时间词、朝代词、术语不能把人拉出来', () => {
  seg.setExtraWords([])
  for (const text of ['这周要加班', '上周他没来', '周朝的制度', '大小周工作制', '周会开始了', '周总理来了']) {
    assert.equal(matchText(text, { name: '周' }).singleName, false, `${text} 不该命中`)
  }
})

test('强证据命中时，弱证据不置位（别把 1.0 降成候选）', () => {
  const result = matchText('周老板说老陈来了', { name: '老陈', aliases: '老陈,周老板' })
  assert.equal(result.name, true)
  assert.equal(result.singleName, false)
})

test('单字线索词不算线索（酒/刀/雨 这种到处都是）', () => {
  const person = { name: '老陈', clueWords: ['酒', '旧港码头'] }
  assert.equal(matchText('他倒了杯酒。', person).clues, 0)
  assert.equal(matchText('旧港码头涨潮了。', person).clues, 1)
  assert.equal(matchText('旧港码头旁边有酒。', person).clues, 1)
})

test('多段正文：任意一段命中就算', () => {
  const person = { name: '老陈' }
  assert.equal(matchPerson(person, { texts: ['雨下大了。', '老陈没说话。'] }).name, true)
  assert.equal(matchPerson(person, { texts: ['雨下大了。', '风停了。'] }).name, false)
  // 只给一段字符串（忘了包成数组）也要认
  assert.equal(matchPerson(person, { texts: '老陈没说话。' }).name, true)
})

test('玩家输入也参与姓名与别名匹配', () => {
  const hit = matchPerson({ name: '老陈', aliases: ['陈先生'] }, { input: '我去找陈先生' })
  assert.equal(hit.alias, true)
  assert.equal(hit.name, false)
})

test('关联线索：每条词命中算一条，同一段里重复出现只算一次', () => {
  const person = { name: '老陈', clueWords: ['旧港码头', '南洋商行', '黑猫'] }
  assert.equal(matchText('旧港码头', person).clues, 1)
  assert.equal(matchText('旧港码头又见旧港码头', person).clues, 1)
  assert.equal(matchText('旧港码头旁边是南洋商行', person).clues, 2)
  assert.equal(matchText('旧港码头、南洋商行，还有那只黑猫', person).clues, 3)
  assert.equal(matchText('什么都没提', person).clues, 0)
})

test('关联线索跨段合并，同一个词不重复计数', () => {
  const person = { name: '老陈', clueWords: ['旧港码头', '南洋商行'] }
  const hit = matchPerson(person, { input: '旧港码头', texts: ['旧港码头', '南洋商行'] })
  assert.equal(hit.clues, 2)
})

test('空姓名、空别名不会把所有人都当成命中', () => {
  const person = { name: '', aliases: ['', ' , '], clueWords: [''] }
  assert.deepEqual(matchPerson(person, { input: '随便写点什么', texts: ['也随便'] }), EMPTY)
})

test('英文名大小写不敏感', () => {
  const person = { name: 'Alice', aliases: ['Ali'] }
  assert.equal(matchText('alice nodded.', person).name, true)
  assert.equal(matchText('ALI nodded.', person).alias, true)
})

test('点名与沾边分开：匹配只看点名，索引词单独计数（ADR 0041）', () => {
  // 召回侧的打分模块已退役（ADR 0082 重做中），这里只验 matchText 自己的口径：
  // 有没有「点名」和「对上了几条索引词」必须分两个字段，不能混成一个分数。
  const onlyClue = matchText('旧港码头涨潮了。', { name: '老陈', clueWords: ['旧港码头'] })
  assert.equal(onlyClue.name, false)
  assert.equal(onlyClue.alias, false)
  assert.equal(onlyClue.clues, 1)

  const onlyAlias = matchText('陈先生笑了。', { name: '老陈', aliases: ['陈先生'] })
  assert.equal(onlyAlias.alias, true)
  assert.equal(onlyAlias.clues, 0)
})

test('返回命中的索引词原文，供挑召回条目用', () => {
  const hit = matchText('旧港码头涨潮了，林澈盯着水面。', {
    name: '老陈',
    clueWords: ['旧港码头', '林澈', '一张欠条'],
  })
  assert.deepEqual(hit.clueWords, ['旧港码头', '林澈'])
  assert.equal(hit.clues, 2)
})

test('两路数据源合并后去重：输入与正文命中同一条只算一次', () => {
  const hit = matchPerson(
    { name: '老陈', clueWords: ['旧港码头', '林澈', '一张欠条'] },
    { input: '我去旧港码头看看。', texts: ['旧港码头涨潮了，林澈站在岸边。'] },
  )
  // 「旧港码头」两边都出现，合并后仍只算一条
  assert.deepEqual(hit.clueWords, ['旧港码头', '林澈'])
  assert.equal(hit.clues, 2)
})

test('合并多路命中的索引词并去重（上一轮缓存 ＋ 本轮输入）', () => {
  // 两路都命中同一条 → 只留一条
  assert.deepEqual(
    mergeClueWords(['旧港码头', '林澈'], ['林澈', '一张欠条']),
    ['旧港码头', '林澈', '一张欠条'],
  )
  // 子串合并：旧港 是 旧港码头 的子串，只留长的
  assert.deepEqual(mergeClueWords(['旧港'], ['旧港码头']), ['旧港码头'])
  // 大小写不同算同一条，后面的覆盖前面的
  assert.deepEqual(mergeClueWords(['ALICE'], ['alice']), ['alice'])
  // 空 / null / undefined 都不炸
  assert.deepEqual(mergeClueWords(), [])
  assert.deepEqual(mergeClueWords([], null, undefined), [])
})

test('没给人物、给了 null 人物、没给文本都不抛错', () => {
  assert.deepEqual(matchText('老陈推门进来。'), EMPTY)
  assert.deepEqual(matchPerson(undefined, {}), EMPTY)
  // 接线时从整局数据里取不到东西可能给 null，整轮不能因此崩掉
  assert.deepEqual(matchPerson(null, {}), EMPTY)
  assert.deepEqual(matchText('老陈推门进来。', null), EMPTY)
  // 选项也同理：`settings.matchOptions ?? null` 这种写法在接线处很常见
  assert.deepEqual(matchPerson({ name: '老陈' }, null), EMPTY)
  assert.deepEqual(matchText('老陈推门进来。', { name: '老陈' }, null), {
    name: true,
    alias: false,
    singleName: false,
    clues: 0,
    clueWords: [],
  })
})
