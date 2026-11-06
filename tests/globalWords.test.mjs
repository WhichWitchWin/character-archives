// 全局专名词库（ADR 0077）：跨局记住地名/店名/组织名，滚动 LRU 淘汰
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  GLOBAL_WORDS_MAX,
  GLOBAL_WORD_MAX_CHARS,
  addGlobalWords,
  createGlobalWords,
  globalWordCount,
  globalWordList,
  normalizeGlobalWords,
} from '../plugin/lib/globalWords.js'

test('默认上限 2000 条', () => {
  assert.equal(GLOBAL_WORDS_MAX, 2000)
})

test('新词收进去，能列出来', () => {
  const { store, added } = addGlobalWords(createGlobalWords(), ['香格里拉酒吧', '镖局'], 7)
  assert.deepEqual(added, ['香格里拉酒吧', '镖局'])
  assert.deepEqual(globalWordList(store), ['香格里拉酒吧', '镖局'])
  assert.equal(store.map['香格里拉酒吧'], 7, '记成"最后命中轮次"')
})

test('重复词：刷新轮次并回到最新位置（别被当成旧的淘汰）', () => {
  let store = addGlobalWords(createGlobalWords(), ['旧港'], 3).store
  store = addGlobalWords(store, ['镖局'], 4).store
  const next = addGlobalWords(store, ['旧港'], 9)
  assert.deepEqual(next.touched, ['旧港'])
  assert.deepEqual(next.added, [])
  assert.deepEqual(globalWordList(next.store), ['镖局', '旧港'], '旧港回到最后（最新）')
  assert.equal(next.store.map['旧港'], 9)
})

test('超过上限：从最旧的开始删，不是删最新的', () => {
  let store = createGlobalWords()
  for (let index = 0; index < 12; index += 1) {
    store = addGlobalWords(store, [`词${index}`], index, { max: 10 }).store
  }
  const list = globalWordList(store)
  assert.equal(list.length, 10)
  assert.ok(!list.includes('词0'), '最早的被删了')
  assert.ok(!list.includes('词1'), '第二早的也被删了')
  assert.ok(list.includes('词11'), '最新的还在')
})

test('超长的词不收（会把分词最大词长顶大，拖慢每轮）', () => {
  const long = '字'.repeat(GLOBAL_WORD_MAX_CHARS + 1)
  const { store, added } = addGlobalWords(createGlobalWords(), [long, '旧港'], 1)
  assert.deepEqual(added, ['旧港'])
  assert.deepEqual(globalWordList(store), ['旧港'])
})

test('空值、非数组安全返回', () => {
  assert.deepEqual(globalWordList(addGlobalWords(createGlobalWords(), [], 1).store), [])
  assert.deepEqual(globalWordList(addGlobalWords(createGlobalWords(), null, 1).store), [])
})

test('纯函数：不改传进来的库', () => {
  const original = createGlobalWords()
  addGlobalWords(original, ['旧港'], 1)
  assert.deepEqual(original.map, {})
})

test('读坏数据：不是对象、数组、没 map 一律当空库', () => {
  assert.deepEqual(globalWordList(normalizeGlobalWords(null)), [])
  assert.deepEqual(globalWordList(normalizeGlobalWords([])), [])
  assert.deepEqual(globalWordList(normalizeGlobalWords({ map: 'x' })), [])
  assert.deepEqual(globalWordList(normalizeGlobalWords({ map: { 旧港: 'bad' } })), ['旧港'], '轮次坏了保留词，记 0')
})

test('读坏数据：超长词在读取时就被剔除', () => {
  const long = '字'.repeat(GLOBAL_WORD_MAX_CHARS + 2)
  const list = globalWordList({ map: { [long]: 1, 旧港: 2 } })
  assert.deepEqual(list, ['旧港'])
})

test('轮次不是整数时记 0，不报错', () => {
  const { store } = addGlobalWords(createGlobalWords(), ['旧港'], 'x')
  assert.equal(store.map['旧港'], 0)
  assert.equal(globalWordCount(store), 1)
})
