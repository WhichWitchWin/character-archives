// 容量（设计稿 §3.2 上限、§3.3 写入策略、§3.4 快照价值与删除顺序、§3.5 兜底）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CAPACITY,
  pickVictims,
  pressure,
  snapshotRates,
  targetFreeBytes,
} from '../plugin/lib/capacity.js'

test('上限与阈值和设计稿一致', () => {
  assert.equal(CAPACITY.SNAPSHOT_BYTES, 64 * 1024)
  assert.equal(CAPACITY.GAME_TOTAL_BYTES, 8 * 1024 * 1024)
  assert.equal(CAPACITY.RECORD_WARN, 1800)
  assert.equal(CAPACITY.NOTICE_PERCENT, 60)
  assert.equal(CAPACITY.CLEAN_PERCENT, 80)
  assert.equal(CAPACITY.REJECT_PERCENT, 95)
  assert.equal(CAPACITY.SAFE_RATE, 0.2)
})

test('水位分档：60% 提示、80% 清理、95% 拒绝', () => {
  const limit = 1000
  assert.equal(pressure(599, limit), 'ok')
  assert.equal(pressure(600, limit), 'notice')
  assert.equal(pressure(799, limit), 'notice')
  assert.equal(pressure(800, limit), 'clean')
  assert.equal(pressure(949, limit), 'clean')
  assert.equal(pressure(950, limit), 'reject')
})

test('变化率 = |本轮字节 − 上一份| ÷ 上一份，起点没有变化率', () => {
  const index = [
    { turn: 10, bytes: 2048 },
    { turn: 20, bytes: 4096 },
    { turn: 30, bytes: 4300 },
  ]
  const rates = snapshotRates(index)
  assert.equal(rates.get(10), null)
  assert.equal(rates.get(20), 1)
  assert.ok(Math.abs(rates.get(30) - 0.0498) < 0.0001)
})

test('删掉一份后，后续快照的变化率按新的邻居重算', () => {
  const index = [
    { turn: 10, bytes: 2048 },
    { turn: 20, bytes: 4096 },
    { turn: 30, bytes: 4300 },
  ]
  const after = index.filter((item) => item.turn !== 20)
  assert.ok(Math.abs(snapshotRates(after).get(30) - (4300 - 2048) / 2048) < 1e-9)
})

test('删除顺序：永远从变化率最低的开始删（设计稿 §3.4 的五轮例子）', () => {
  const index = [
    { turn: 10, bytes: 2048 },  // 起点，不参与删除
    { turn: 20, bytes: 4096 },
    { turn: 30, bytes: 4300 },  // +5%，低价值
    { turn: 40, bytes: 8192 },
    { turn: 50, bytes: 8300 },  // +1.3%，最低价值
  ]
  const result = pickVictims(index, 10000)
  assert.deepEqual(result.victims, [50, 30])
  assert.equal(result.stopped, null)
})

test('删够就停，不多删', () => {
  const index = [
    { turn: 10, bytes: 1000 },
    { turn: 20, bytes: 1050 }, // +5%
    { turn: 30, bytes: 1100 }, // +4.76%，最低
  ]
  const result = pickVictims(index, 100)
  assert.deepEqual(result.victims, [30])
  assert.equal(result.freed, 1100)
})

test('变化率相同的时候，轮次更早的先删', () => {
  const index = [
    { turn: 10, bytes: 1000 },
    { turn: 20, bytes: 1100 }, // +10%
    { turn: 30, bytes: 1210 }, // +10%，与上一份相同
  ]
  assert.deepEqual(pickVictims(index, 1).victims, [20])
})

test('20% 安全线：最低变化率也高于 20% 就停手，一份都不删', () => {
  const index = [
    { turn: 10, bytes: 1000 },
    { turn: 20, bytes: 2000 },
    { turn: 30, bytes: 3000 },
  ]
  const result = pickVictims(index, 9999)
  assert.deepEqual(result.victims, [])
  assert.equal(result.stopped, 'safe-line')
})

test('只有起点一份时无处可删', () => {
  const result = pickVictims([{ turn: 10, bytes: 1000 }], 999)
  assert.deepEqual(result.victims, [])
  assert.equal(result.freed, 0)
})

test('腾不出足够空间时必须明说，不能和「删够了」同形', () => {
  const index = [
    { turn: 10, bytes: 1000 },
    { turn: 20, bytes: 1050 },
    { turn: 30, bytes: 1100 },
  ]
  const result = pickVictims(index, 8 * 1024 * 1024)
  assert.equal(result.stopped, 'exhausted')
  assert.ok(result.freed < 8 * 1024 * 1024)
})

test('删一份之后必须用新邻居重算变化率（不重算就会多删一份）', () => {
  const index = [
    { turn: 10, bytes: 1000 },
    { turn: 20, bytes: 1100 }, // +10%
    { turn: 30, bytes: 1310 }, // +19.1%，按旧基准看低于安全线
  ]
  // 删掉 20 之后，30 的基准变成 10 → (1310-1000)/1000 = 31% → 越过 20% 安全线，必须停手
  const result = pickVictims(index, 2000)
  assert.deepEqual(result.victims, [20])
  assert.equal(result.stopped, 'safe-line')
})

test('腾空间要留出「本次快照大小 + 5%」', () => {
  assert.equal(targetFreeBytes(1000), 1050)
  assert.equal(targetFreeBytes(0), 0)
})
