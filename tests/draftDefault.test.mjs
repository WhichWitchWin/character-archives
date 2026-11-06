// 模糊建档的默认清理轮次（ADR 0075 / 2026-11-06 调整）
//
// 5 轮对实际节奏太长：一个只露过一次面的路人会在候选表里滞留整整五轮，
// 候选名单越长，素材里那串名字越像是"模型该去关注的人"。默认收到 3 轮。

import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_SETTINGS } from '../plugin/lib/settings.js'
import { DEFAULT_MAX_IDLE, expireDraft } from '../plugin/lib/draft.js'

test('模糊建档：默认清理轮次是 3 轮（设置默认值与兜底常量要一致）', () => {
  assert.equal(DEFAULT_SETTINGS.draft.maxIdleTurns, 3)
  assert.equal(DEFAULT_MAX_IDLE, 3)
})

test('模糊建档：不传 maxIdle 时按 3 轮算', () => {
  const draft = { 卖炭翁: 10 }

  // 第 12 轮：才隔 2 轮，留着
  assert.deepEqual(expireDraft(draft, { hits: [], turn: 12 }).removed, [])

  // 第 13 轮：隔满 3 轮，清掉
  assert.deepEqual(expireDraft(draft, { hits: [], turn: 13 }).removed, ['卖炭翁'])
})
