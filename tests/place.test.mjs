// 当前地点的三路解析（ADR 0089 §5）：MVU → 模型 → 程序抓正文，只认本局已有地名。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { knownPlaces, placeFromText, resolvePlace } from '../plugin/lib/place.js'

const claimWith = (words) => [1, 'p1', 'a', '在旧港码头养伤', 3, words]

test('knownPlaces：只收「地」类索引词', () => {
  const snapshot = {
    c: [
      claimWith([{ 词: '旧港码头', 类: '地' }, { 词: '张三', 类: '人' }]),
      claimWith([{ 词: '临安', 类: '地' }]),
      claimWith([]),
    ],
  }
  assert.deepEqual([...knownPlaces(snapshot)].sort(), ['临安', '旧港码头'].sort())
})

test('knownPlaces：空快照返回空集合', () => {
  assert.equal(knownPlaces(null).size, 0)
})

test('placeFromText：正文里出现多个已知地名时取最长的', () => {
  const known = new Set(['码头', '旧港码头'])
  assert.equal(placeFromText('他走进旧港码头', known), '旧港码头')
})

test('placeFromText：没出现就是空', () => {
  assert.equal(placeFromText('他在山里', new Set(['旧港码头'])), '')
})

test('resolvePlace：MVU 有值直接用（哪怕不在已知列表里）', () => {
  assert.equal(resolvePlace({ mvuLoc: '临安·旧港', known: new Set() }), '临安·旧港')
})

test('resolvePlace：模型报的地点必须命中已知地名', () => {
  const known = new Set(['旧港码头'])
  assert.equal(resolvePlace({ modelLoc: '旧港码头', known }), '旧港码头')
  assert.equal(resolvePlace({ modelLoc: '随便编的地方', known }), '')
})

test('resolvePlace：MVU 没值、模型没报 → 从正文抓', () => {
  const known = new Set(['旧港码头'])
  assert.equal(resolvePlace({ text: '他站在旧港码头边', known }), '旧港码头')
})

test('resolvePlace：模型报的和正文都有时，模型优先', () => {
  const known = new Set(['旧港码头', '临安'])
  assert.equal(resolvePlace({ modelLoc: '临安', text: '他想起了旧港码头', known }), '临安')
})
