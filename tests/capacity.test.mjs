// 容量（设计稿 §3.2 上限、§3.3 写入策略、§3.4 每局总量删除规则、§3.5 容量兜底）
//
// 新版口径（2026-10-31 用户改稿）：
//   - 8 MB 总量：不再看变化率，一律按最早轮次删；95% 提示、98% 自动删最早 10 份
//   - 单条 64 KB：没有 80% 自动清理；95% 提示、97% 着重提示+一键清理（清到 90% 以下）、99% 拒绝写入
//   - 整局数据 256 KB：>90% 全量扫描回收、95% 着重提示；**不停止收录**
//   - 快照条数 2000：1900 提示、1999 删最早 100 份
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

test('上限与阈值和新版设计稿一致', () => {
  assert.equal(CAPACITY.SNAPSHOT_BYTES, 64 * 1024)
  assert.equal(CAPACITY.GAME_TOTAL_BYTES, 8 * 1024 * 1024)
  assert.equal(CAPACITY.GAME_DATA_BYTES, 256 * 1024)
  assert.equal(CAPACITY.SNAPSHOT_WARN_PERCENT, 95)
  assert.equal(CAPACITY.SNAPSHOT_CLEAN_PERCENT, 97)
  assert.equal(CAPACITY.SNAPSHOT_CLEAN_TARGET_PERCENT, 90)
  assert.equal(CAPACITY.SNAPSHOT_REJECT_PERCENT, 99)
  assert.equal(CAPACITY.GAME_TOTAL_NOTICE_PERCENT, 95)
  assert.equal(CAPACITY.GAME_TOTAL_PRUNE_PERCENT, 98)
  assert.equal(CAPACITY.GAME_TOTAL_PRUNE_COUNT, 10)
  assert.equal(CAPACITY.GAME_DATA_SCAN_PERCENT, 90)
  assert.equal(CAPACITY.GAME_DATA_URGENT_PERCENT, 95)
  assert.equal(CAPACITY.RECORD_WARN, 1900)
  assert.equal(CAPACITY.RECORD_PRUNE_AT, 1999)
  assert.equal(CAPACITY.RECORD_PRUNE_COUNT, 100)
})

test('单条快照：95% 提示、97% 着重、99% 拒绝，没有 80% 自动清理', () => {
  const limit = CAPACITY.SNAPSHOT_BYTES
  assert.equal(snapshotPressure(pct(limit, 80)), 'ok')       // 旧版的 80% 清理已取消
  assert.equal(snapshotPressure(pct(limit, 94)), 'ok')
  assert.equal(snapshotPressure(pct(limit, 95)), 'notice')
  assert.equal(snapshotPressure(pct(limit, 96)), 'notice')
  assert.equal(snapshotPressure(pct(limit, 97)), 'urgent')
  assert.equal(snapshotPressure(pct(limit, 98)), 'urgent')
  assert.equal(snapshotPressure(pct(limit, 99)), 'reject')
})

test('8 MB 总量：95% 提示、98% 自动删', () => {
  const limit = CAPACITY.GAME_TOTAL_BYTES
  assert.equal(gameTotalPressure(pct(limit, 94)), 'ok')
  assert.equal(gameTotalPressure(pct(limit, 95)), 'notice')
  assert.equal(gameTotalPressure(pct(limit, 97)), 'notice')
  assert.equal(gameTotalPressure(pct(limit, 98)), 'prune')
})

test('整局数据：严格大于 90% 才扫描，95% 着重提示', () => {
  const limit = CAPACITY.GAME_DATA_BYTES
  assert.equal(gameDataPressure(limit * 0.9), 'ok')          // 正好 90% 不触发
  assert.equal(gameDataPressure(limit * 0.9001), 'scan')
  assert.equal(gameDataPressure(limit * 0.94), 'scan')
  assert.equal(gameDataPressure(limit * 0.95), 'urgent')
})

test('快照条数：1900 提示、1999 删最早 100 份', () => {
  assert.equal(recordPressure(1899), 'ok')
  assert.equal(recordPressure(1900), 'warn')
  assert.equal(recordPressure(1998), 'warn')
  assert.equal(recordPressure(1999), 'prune')
})

test('删除一律按最早轮次，起点不特殊对待', () => {
  const index = [
    { turn: 30, bytes: 3000 },
    { turn: 10, bytes: 1000 },
    { turn: 20, bytes: 2000 },
  ]
  assert.deepEqual(pruneOldest(index, 2), [10, 20])   // 第 10 轮（起点）照样会被删
  assert.deepEqual(pruneOldest(index, 10), [10, 20, 30]) // 要的比有的多，全给
  assert.deepEqual(pruneOldest(index, 0), [])
})
