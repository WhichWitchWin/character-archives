// 召回冷却（设计稿 §7.5、§3.6）
//
// 三个层次别混（§7.5）：
//   1. 是否允许召回 —— 由冷却决定，是闸门；
//   2. 是否真的召回 —— 由姓名／别名／线索命中决定；
//   3. 召回什么 —— 全量，或简版＋相关条目。
//
// 粒度：全量召回冷却**整个人物**；简版／连带召回只冷却**给过的具体条目**。
// 0 轮＝无冷却。冷却结束（当前轮 ≥ 截止轮）就**立刻删掉这条记录**——它的使命已经结束。
// 这样回退也安全：未到期的记录还在（冷却仍生效），已到期的早删了（本来也该允许召回）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_COOLDOWN_TURNS,
  createCooldowns,
  entryKey,
  isCoolingDown,
  personKey,
  pruneExpired,
  rememberRecall,
} from '../plugin/lib/cooldown.js'

test('默认冷却 10 轮', () => {
  assert.equal(DEFAULT_COOLDOWN_TURNS, 10)
})

test('记一次召回：写下来源轮与截止轮', () => {
  const cooldowns = rememberRecall(createCooldowns(), 'p:p1', 10)
  assert.deepEqual(cooldowns['p:p1'], { lastTurn: 10, until: 20 })
})

test('冷却中返回 true，到点返回 false', () => {
  const cooldowns = rememberRecall(createCooldowns(), 'p:p1', 10, 10)
  assert.equal(isCoolingDown(cooldowns, 'p:p1', 15), true)
  assert.equal(isCoolingDown(cooldowns, 'p:p1', 19), true)
  assert.equal(isCoolingDown(cooldowns, 'p:p1', 20), false)
  assert.equal(isCoolingDown(cooldowns, 'p:p1', 25), false)
})

test('没记过的、或者 0 轮冷却，一律不算冷却中', () => {
  const cooldowns = createCooldowns()
  assert.equal(isCoolingDown(cooldowns, 'p:p1', 5), false)

  const noCooldown = rememberRecall(cooldowns, 'p:p1', 10, 0)
  assert.deepEqual(noCooldown, {})                       // 0 轮 = 不记
  assert.equal(isCoolingDown(noCooldown, 'p:p1', 10), false)
})

test('人物级与条目级互不影响', () => {
  let cooldowns = createCooldowns()
  cooldowns = rememberRecall(cooldowns, personKey('p1'), 10)
  cooldowns = rememberRecall(cooldowns, entryKey('p2', 'a'), 10)
  assert.equal(isCoolingDown(cooldowns, personKey('p1'), 12), true)
  assert.equal(isCoolingDown(cooldowns, personKey('p2'), 12), false)
  assert.equal(isCoolingDown(cooldowns, entryKey('p2', 'a'), 12), true)
  assert.equal(isCoolingDown(cooldowns, entryKey('p1', 'a'), 12), false)
})

test('到期即删：只留还没到期的', () => {
  let cooldowns = createCooldowns()
  cooldowns = rememberRecall(cooldowns, 'p:早', 10, 5)   // 截止 15
  cooldowns = rememberRecall(cooldowns, 'p:晚', 18, 5)   // 截止 23
  const pruned = pruneExpired(cooldowns, 20)
  assert.deepEqual(Object.keys(pruned), ['p:晚'])
  assert.equal(pruned['p:晚'].until, 23)
})

test('是纯函数，不改原对象；记第二次会覆盖', () => {
  const original = rememberRecall(createCooldowns(), 'p:p1', 10, 5)
  rememberRecall(original, 'p:p1', 30, 5)
  assert.equal(original['p:p1'].until, 15)

  const again = rememberRecall(original, 'p:p1', 30, 5)
  assert.deepEqual(again['p:p1'], { lastTurn: 30, until: 35 })
})
