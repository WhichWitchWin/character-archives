// 召回冷却（ADR 0086）
//
// 粒度是**指针级**：一条指针 = 某人 × 某条命题 × 一条认知，键 `pt:人物id:命题id`。
// 旧的人物级／条目级键已随「命题＋指针」改造退役（2026-11-05），那些函数本来也没有生产调用。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_COOLDOWN_TURNS,
  dropClaimCooldowns,
  isPointerCoolingDown,
  pointerKey,
  pruneExpired,
} from '../plugin/lib/cooldown.js'

const ptr = (personId, claimId, lastTurn) => [personId, claimId, [[0, '']], lastTurn]

test('默认冷却 10 轮', () => {
  assert.equal(DEFAULT_COOLDOWN_TURNS, 10)
})

test('指针键的格式', () => {
  assert.equal(pointerKey('p1', 9), 'pt:p1:9')
})

// ── 三个盖章时机（ADR 0086）──

test('建立/修改章：刚变过的指针不给（当前轮 − 最后变动轮 < N）', () => {
  assert.equal(isPointerCoolingDown({}, ptr('p1', 9, 20), 20, 10), true)
  assert.equal(isPointerCoolingDown({}, ptr('p1', 9, 20), 25, 10), true)
  assert.equal(isPointerCoolingDown({}, ptr('p1', 9, 20), 30, 10), false)
})

test('召回章：冷却表里有记录、还没到期就不给', () => {
  const cooldowns = { [pointerKey('p1', 9)]: { lastTurn: 20, until: 30 } }
  assert.equal(isPointerCoolingDown(cooldowns, ptr('p1', 9, 5), 25, 10), true)
  assert.equal(isPointerCoolingDown(cooldowns, ptr('p1', 9, 5), 30, 10), false)
})

test('轮数 0 等于关掉冷却，一律放行', () => {
  const cooldowns = { [pointerKey('p1', 9)]: { lastTurn: 20, until: 30 } }
  assert.equal(isPointerCoolingDown(cooldowns, ptr('p1', 9, 20), 20, 0), false)
})

test('不同人的同一条命题互不影响', () => {
  const cooldowns = { [pointerKey('p1', 9)]: { lastTurn: 20, until: 30 } }
  assert.equal(isPointerCoolingDown(cooldowns, ptr('p2', 9, 5), 25, 10), false)
})

test('脏指针不炸：不是数组、轮次不是整数一律放行', () => {
  assert.equal(isPointerCoolingDown({}, null, 10, 10), false)
  assert.equal(isPointerCoolingDown({}, ptr('p1', 9, 5), null, 10), false)
})

// ── 清理 ──

test('到期即删：只留还没到期的', () => {
  const cooldowns = {
    'pt:p1:1': { lastTurn: 10, until: 15 },   // 截止 15
    'pt:p2:3': { lastTurn: 18, until: 23 },   // 截止 23
  }
  const pruned = pruneExpired(cooldowns, 20)
  assert.deepEqual(Object.keys(pruned), ['pt:p2:3'])
  assert.equal(pruned['pt:p2:3'].until, 23)
})

test('清理是纯函数，不改原表；空表也不炸', () => {
  const cooldowns = { 'pt:p1:1': { lastTurn: 10, until: 15 } }
  pruneExpired(cooldowns, 20)
  assert.equal(cooldowns['pt:p1:1'].until, 15, '原表不该被改')
  assert.deepEqual(pruneExpired(undefined, 5), {})
})

// 命题 id 会被复用（nextClaimId = 现有最大 +1），而冷却表键是 `pt:人物:命题id`、只按到期清。
// 于是：老命题被撤/被孤儿清理 → 冷却记录还在 → 新命题恰好拿到同一个号、同一人又知道它
// → 这条新指针被「无故冷却」最多 N 轮（默认 10），表现为「数据看着对、召回偷偷少一条」。
test('冷却：清掉某条命题的冷却记录（防命题 id 复用时误伤新命题）', () => {
  const cooldowns = {
    'pt:p1:7': { lastTurn: 3, until: 13 },
    'pt:p2:7': { lastTurn: 3, until: 13 },
    'pt:p1:8': { lastTurn: 3, until: 13 },
  }
  const next = dropClaimCooldowns(cooldowns, 7)
  assert.deepEqual(Object.keys(next).sort(), ['pt:p1:8'], '只留别的命题的冷却')
})
