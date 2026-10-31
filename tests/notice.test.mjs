// 提示记录（设计稿 §3.5「提示详细程度」「每轮动作日志」「必记事件」）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DETAIL, addNotice, createNoticeLog, recentNotices, shouldRecord } from '../plugin/lib/notice.js'

test('空记录的形状', () => {
  assert.deepEqual(createNoticeLog(), { v: 1, items: [] })
})

test('详细程度：简洁 < 标准 < 详细', () => {
  assert.equal(shouldRecord(DETAIL.brief, DETAIL.brief), true)
  assert.equal(shouldRecord(DETAIL.brief, DETAIL.standard), false)
  assert.equal(shouldRecord(DETAIL.standard, DETAIL.brief), true)
  assert.equal(shouldRecord(DETAIL.standard, DETAIL.detail), false)
  assert.equal(shouldRecord(DETAIL.detail, DETAIL.detail), true)
})

test('简洁档只记容量异常', () => {
  const log = createNoticeLog()
  const options = { settingDetail: DETAIL.brief }
  assert.equal(addNotice(log, { turn: 30, code: 'snapshot-99-reject', min: DETAIL.brief, detail: '已用 99%，拒绝写入' }, options), true)
  assert.equal(addNotice(log, { turn: 30, code: 'archive', min: DETAIL.standard, detail: '归档了老陈' }, options), false)
  assert.equal(addNotice(log, { turn: 30, code: 'recall', min: DETAIL.detail, detail: '召回了老陈' }, options), false)
  assert.equal(log.items.length, 1)
})

test('标准档加上归档、离场、回场、容灾', () => {
  const log = createNoticeLog()
  const options = { settingDetail: DETAIL.standard }
  addNotice(log, { turn: 30, code: 'archive', min: DETAIL.standard, detail: '归档了老陈' }, options)
  addNotice(log, { turn: 30, code: 'recall', min: DETAIL.detail, detail: '召回了老陈' }, options)
  assert.deepEqual(log.items.map((item) => item.code), ['archive'])
})

test('每一条都带轮次、码和说明', () => {
  const log = createNoticeLog()
  addNotice(log, { turn: 30, code: 'snapshot-97-clean', min: DETAIL.brief, detail: '清空了老陈的条目' }, { settingDetail: DETAIL.detail })
  assert.deepEqual(log.items[0], { turn: 30, code: 'snapshot-97-clean', detail: '清空了老陈的条目' })
})

test('记录有上限，超了丢最旧的', () => {
  const log = createNoticeLog()
  const options = { settingDetail: DETAIL.detail, max: 3 }
  for (let turn = 1; turn <= 5; turn += 1) {
    addNotice(log, { turn, code: 'recall', min: DETAIL.detail, detail: `第 ${turn} 轮` }, options)
  }
  assert.deepEqual(log.items.map((item) => item.turn), [3, 4, 5])
})

test('最近的几条按时间倒序取', () => {
  const log = createNoticeLog()
  const options = { settingDetail: DETAIL.detail }
  for (let turn = 1; turn <= 4; turn += 1) {
    addNotice(log, { turn, code: 'recall', min: DETAIL.detail, detail: `第 ${turn} 轮` }, options)
  }
  assert.deepEqual(recentNotices(log, 2).map((item) => item.turn), [4, 3])
})
