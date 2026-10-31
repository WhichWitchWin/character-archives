// 容量（设计稿 §3.2 上限、§3.3 写入策略、§3.4 每局总量删除规则、§3.5 容量兜底）
// 水位用对象返回：高档位同时带上低档位的动作（99% 时也应该清理，不能只看 level）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CAPACITY,
  gameDataPressure,
  gameTotalPressure,
  pruneOldest,
  recordPressure,
  snapshotPressure,
} from '../plugin/lib/capacity.js'

const pct = (limit, percent) => Math.ceil((limit * percent) / 100)

test('上限与阈值与新设计稿一致', () => {
  assert.equal(CAPACITY.SNAPSHOT_BYTES, 64 * 1024)
  assert.equal(CAPACITY.GAME_TOTAL_BYTES, 8 * 1024 * 1024)
  assert.equal(CAPACITY.GAME_DATA_BYTES, 256 * 1024)
  assert.equal(CAPACITY.SNAPSHOT_WARN_PERCENT, 95)
  assert.equal(CAPACITY.SNAPSHOT_CLEAN_PERCENT, 97)
  assert.equal(CAPACITY.SNAPSHOT_CLEAN_TARGET_PERCENT, 90)
  assert.equal(CAPACITY.SNAPSHOT_REJECT_PERCENT, 99)
  assert.equal(CAPACITY.RECORD_WARN, 1900)
  assert.equal(CAPACITY.RECORD_PRUNE_AT, 1999)
  assert.equal(CAPACITY.RECORD_PRUNE_COUNT, 100)
})

test('单条快照：95% 提示、97% 要清理、99% 拒写；没有 80% 自动清理', () => {
  const limit = CAPACITY.SNAPSHOT_BYTES
  assert.deepEqual(snapshotPressure(pct(limit, 80)),
    { level: 'ok', warn: false, needsClean: false, rejectWrites: false })
  assert.deepEqual(snapshotPressure(pct(limit, 95)),
    { level: 'notice', warn: true, needsClean: false, rejectWrites: false })
  assert.deepEqual(snapshotPressure(pct(limit, 97)),
    { level: 'urgent', warn: true, needsClean: true, rejectWrites: false })
})

test('99% 时既要拒写，也要保留「该清理」这个事实', () => {
  const result = snapshotPressure(pct(CAPACITY.SNAPSHOT_BYTES, 99))
  assert.equal(result.level, 'reject')
  assert.equal(result.rejectWrites, true)
  assert.equal(result.needsClean, true)
  assert.equal(result.warn, true)
})

test('8 MB 总量：95% 提示压缩、98% 自动删；98% 时两个动作都在', () => {
  const limit = CAPACITY.GAME_TOTAL_BYTES
  assert.deepEqual(gameTotalPressure(pct(limit, 94)),
    { level: 'ok', suggestCompact: false, autoPrune: false })
  assert.deepEqual(gameTotalPressure(pct(limit, 95)),
    { level: 'notice', suggestCompact: true, autoPrune: false })
  assert.deepEqual(gameTotalPressure(pct(limit, 98)),
    { level: 'prune', suggestCompact: true, autoPrune: true })
})

test('整局数据：严格大于 90% 才扫描，95% 着重提示', () => {
  const limit = CAPACITY.GAME_DATA_BYTES
  assert.deepEqual(gameDataPressure(limit * 0.9), { level: 'ok', scan: false, urgent: false })
  assert.deepEqual(gameDataPressure(limit * 0.9001), { level: 'scan', scan: true, urgent: false })
  assert.deepEqual(gameDataPressure(limit * 0.95), { level: 'urgent', scan: true, urgent: true })
})

test('快照条数：1900 提示、1999 删最早 100 份', () => {
  assert.deepEqual(recordPressure(1899), { level: 'ok', warn: false, prune: false })
  assert.deepEqual(recordPressure(1900), { level: 'warn', warn: true, prune: false })
  assert.deepEqual(recordPressure(1999), { level: 'prune', warn: true, prune: true })
})

test('删除一律按最早轮次，起点不特殊对待', () => {
  const index = [{ turn: 30, bytes: 3000 }, { turn: 10, bytes: 1000 }, { turn: 20, bytes: 2000 }]
  assert.deepEqual(pruneOldest(index, 2), [10, 20])
  assert.deepEqual(pruneOldest(index, 10), [10, 20, 30])
  assert.deepEqual(pruneOldest(index, 0), [])
})
