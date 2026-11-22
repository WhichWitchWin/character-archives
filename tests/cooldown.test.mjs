// 召回冷却（ADR 0086）
//
// 粒度是**指针级**：一条指针 = 某人 × 某条命题 × 一条认知，键 `pt:人物id:命题id`。
// 旧的人物级／条目级键已随「命题＋指针」改造退役（2026-11-05），那些函数本来也没有生产调用。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  cooldownGate,
  DEFAULT_COOLDOWN_TURNS,
  dropClaimCooldowns,
  dropClaimManualFree,
  dropPersonManualFree,
  dropPointerManualFree,
  dropPointersManualFree,
  isPointerCoolingDown,
  markManualFree,
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

// ── 手动改过：豁免一次（ADR 0118）──
//
// 玩家手动加/改的东西，下一轮就该能被念到，不该被冷却压 10 轮。做法不是"改 lastTurn"
// （那一格还兼着召回排序与面板排序，往前拨会让它反而排到后面），而是给这条指针挂个
// 「豁免一次」的标记，判定时跳过两道闸；标记**失效即删**（本来就不冷却了／已念过／指针没了）。

test('标记的键跟冷却表同一格式（pt:人物id:命题id）', () => {
  assert.deepEqual(markManualFree({}, [ptr('p1', 9, 20)]), { 'pt:p1:9': true })
})

test('打标记：纯函数不改原桶；不是指针的、命题号不是整数的都跳过', () => {
  const before = { 'pt:p1:1': true }
  const after = markManualFree(before, [ptr('p1', 9, 20), null, ['p2'], ['p3', 'x']])
  assert.equal(before['pt:p1:9'], undefined, '原桶不该被改')
  assert.equal(after['pt:p1:1'], true, '原有的标记要留着')
  assert.deepEqual(Object.keys(after).sort(), ['pt:p1:1', 'pt:p1:9'])
})

test('冷却中 + 有标记 → 放行，并报告「这次用掉了」', () => {
  const cooldowns = { [pointerKey('p1', 9)]: { lastTurn: 20, until: 30 } }
  assert.deepEqual(cooldownGate(cooldowns, { 'pt:p1:9': true }, ptr('p1', 9, 20), 25, 10), {
    pass: true,
    drop: false,
    consume: true,
  })
})

test('冷却中 + 没标记 → 拦下', () => {
  assert.deepEqual(cooldownGate({}, {}, ptr('p1', 9, 20), 25, 10), { pass: false, drop: false, consume: false })
})

test('没在冷却 + 有标记 → 放行，并报告「标记已经没用了」', () => {
  assert.deepEqual(cooldownGate({}, { 'pt:p1:9': true }, ptr('p1', 9, 20), 30, 10), {
    pass: true,
    drop: true,
    consume: false,
  })
})

test('冷却被关掉（0 轮）时，标记一律算没用', () => {
  const cooldowns = { [pointerKey('p1', 9)]: { lastTurn: 20, until: 30 } }
  assert.deepEqual(cooldownGate(cooldowns, { 'pt:p1:9': true }, ptr('p1', 9, 20), 20, 0), {
    pass: true,
    drop: true,
    consume: false,
  })
})

test('标记只对那一条指针有效，别人记得的同一条照样冷却', () => {
  assert.equal(cooldownGate({}, { 'pt:p1:9': true }, ptr('p2', 9, 20), 20, 10).pass, false)
})

test('删命题：清掉指向它的所有标记（命题 id 会被复用）', () => {
  const bucket = { 'pt:p1:7': true, 'pt:p2:7': true, 'pt:p1:17': true }
  assert.deepEqual(Object.keys(dropClaimManualFree(bucket, 7)).sort(), ['pt:p1:17'], '只清 7 号，不误伤 17 号')
})

test('删人：清掉这个人的所有标记，别人留', () => {
  const bucket = { 'pt:p1:7': true, 'pt:p1:8': true, 'pt:p2:7': true }
  assert.deepEqual(Object.keys(dropPersonManualFree(bucket, 'p1')).sort(), ['pt:p2:7'])
})

test('删一条认知：只清那一个键', () => {
  const bucket = { 'pt:p1:7': true, 'pt:p2:7': true }
  assert.deepEqual(Object.keys(dropPointerManualFree(bucket, 'p1', 7)).sort(), ['pt:p2:7'])
})

// `dropCognitions` 返回的是**数字数组**（不是 `{claimId}` 对象）。
// 曾经按 `item.claimId` 清，键成了 `pt:p1:undefined`，一个真标记都删不掉，而且
// 长度比较判定"没变化"，连盘都不写——完全空转。所以这里专门用「一批 id」的形状。
test('删多条认知：按数字数组清（评审抓到的空转）', () => {
  const bucket = { 'pt:p1:7': true, 'pt:p1:8': true, 'pt:p2:7': true }
  assert.deepEqual(Object.keys(dropPointersManualFree(bucket, 'p1', [7, 8])).sort(), ['pt:p2:7'])
})

test('删多条认知：脏 id 跳过，不炸也不误删', () => {
  const bucket = { 'pt:p1:7': true }
  assert.deepEqual(dropPointersManualFree(bucket, 'p1', [null, undefined, 'x']), { 'pt:p1:7': true })
  assert.deepEqual(dropPointersManualFree(undefined, 'p1', [7]), {})
})

// 标记带轮次：回退后「未来打的标记」要能被 pruneFutureFlags 清掉（命题号会复用）
test('打标记可以带轮次（回退要认它）', () => {
  assert.deepEqual(markManualFree({}, [ptr('p1', 9, 20)], 12), { 'pt:p1:9': 12 })
})

test('三个清理都不炸空桶', () => {
  assert.deepEqual(dropClaimManualFree(undefined, 7), {})
  assert.deepEqual(dropPersonManualFree(undefined, 'p1'), {})
  assert.deepEqual(dropPointerManualFree(undefined, 'p1', 7), {})
})
