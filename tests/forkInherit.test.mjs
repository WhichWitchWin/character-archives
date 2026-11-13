// 分叉继承：新分支的档案要接住父局在「分叉点之前」的那一份（ADR 0110）。
//
// 背景：酒馆的分叉＝**开一局新游戏**（新 gameId）。插件自己的文件按 gameId 存
// （`games/<id>.json`、`snapshots/<id>/…`），而官方文档明说「自己写的文件不会随存档、
// 分叉带走」——于是分叉后新局档案是空的。
//
// 这里只做**纯变换**：把父局的整局数据剪到分叉点，返回子局该有的那份。
// 真正搬文件在 `lib/store.js`，订阅事件在 `index.mjs`。
//
// 为什么必须剪：分叉点是「过去」，父局在分叉点之后记下的 flags（露面/离场/候选/玩家回场）
// 都是**还没发生的未来**，带过去会让候选表凭空多出人、离场判定算错。
// 剪枝逻辑复用回退那套 `pruneFutureFlags`（同一个道理：未来记录不该留）。

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { inheritGameState } from '../plugin/lib/forkInherit.js'

/** 父局：混着「分叉点之前」和「之后」的记录。 */
function parentState() {
  return {
    v: 1,
    meta: { updatedTurn: 9, updatedAt: '2026-11-12T00:00:00.000Z', cardKey: 'card-1' },
    dict: { v: 1, d: ['旧港码头'], t: ['地'] },
    entries: { e1: { name: '身份职业' } },
    flags: {
      status: { p1: 1 },
      lock: { p2: true },
      hidden: { p1: true },
      seen: { 老陈: 9, 苏晚晴: 2 },
      left: { p1: { turn: 9, gt: '深夜' }, p2: { turn: 2, gt: '傍晚' } },
      draft: { 卖炭翁: 9, 沈九: 1 },
      lastHits: { 老陈: 9 },
      playerBack: { turn: 9 },
    },
    snapshots: {
      index: [
        { turn: 1, file: '1-aaaa1111.json', hash: 'aaaa1111' },
        { turn: 2, file: '2-bbbb2222.json', hash: 'bbbb2222' },
        { turn: 3, file: '3-cccc3333.json', hash: 'cccc3333' },
        { turn: 9, file: '9-dddd4444.json', hash: 'dddd4444' },
      ],
    },
    nextId: 7,
    cooldowns: { 'pt:p1:3': { until: 12 } },
    debugLog: [{ at: '2026-11-12T00:00:00.000Z', turn: 9, message: '父局的日志' }],
  }
}

test('分叉继承：分叉点之后的 flags 记录不带过去', () => {
  const child = inheritGameState(parentState(), { forkTurn: 3 })
  assert.deepEqual(child.flags.seen, { 苏晚晴: 2 }, '第 9 轮的露面记录是未来')
  assert.deepEqual(Object.keys(child.flags.left), ['p2'], '第 9 轮的离场记录是未来')
  assert.deepEqual(child.flags.draft, { 沈九: 1 }, '第 9 轮的候选是未来')
  assert.equal(child.flags.playerBack, undefined, '第 9 轮的玩家回场是未来')
  // 与轮次无关的（状态/锁/眼睛/命中）原样保留
  assert.deepEqual(child.flags.status, { p1: 1 })
  assert.deepEqual(child.flags.lock, { p2: true })
  assert.deepEqual(child.flags.hidden, { p1: true })
})

test('分叉继承：meta 与快照索引都截到分叉点', () => {
  const child = inheritGameState(parentState(), { forkTurn: 3 })
  assert.equal(child.meta.updatedTurn, 3)
  assert.equal(child.meta.cardKey, 'card-1', '卡标识要留住（预设按卡取）')
  assert.equal(child.meta.updatedAt, '2026-11-12T00:00:00.000Z', '其他 meta 不动')
  assert.deepEqual(child.snapshots.index.map((item) => item.turn), [1, 2, 3])
})

test('分叉继承：字典/编号照抄，预设与冷却不照抄', () => {
  const child = inheritGameState(parentState(), { forkTurn: 3 })
  assert.deepEqual(child.dict, { v: 1, d: ['旧港码头'], t: ['地'] })
  assert.equal(child.nextId, 7, '人物编号继续往下发，不能回收')
  assert.equal(child.v, 1)
  // 预设（entries／mvuChecklist／settings.checkedCodes）归「全局 + 按卡」存，
  // saveGameState 一直故意不写进整局数据；这里也不能因为抄父局把它复活成第二真相源
  assert.equal(child.entries, undefined)
  assert.equal(child.mvuChecklist, undefined)
  assert.equal(child.settings?.checkedCodes, undefined)
})

test('分叉继承：冷却只留「分叉前就立下的」，分叉之后才立的丢掉', () => {
  // 冷却记录 `{lastTurn, until}`：lastTurn 是立下这条冷却的那一轮。
  // lastTurn > 分叉点 ＝ 分叉之后才发生的事，带过去会让子局召回被「未来的冷却」压住。
  const parent = parentState()
  parent.cooldowns = {
    'pt:p1:3': { lastTurn: 2, until: 9 },    // 分叉前立的：留着（它会自然到期）
    'pt:p1:7': { lastTurn: 9, until: 19 },   // 分叉之后才立的：未来，丢掉
  }
  const child = inheritGameState(parent, { forkTurn: 3 })
  assert.deepEqual(Object.keys(child.cooldowns), ['pt:p1:3'])
})

test('分叉继承：分开的两份，改子局不影响父局', () => {
  const parent = parentState()
  const child = inheritGameState(parent, { forkTurn: 3 })
  child.flags.seen.苏晚晴 = 99
  child.dict.d.push('新地名')
  assert.equal(parent.flags.seen.苏晚晴, 2)
  assert.deepEqual(parent.dict.d, ['旧港码头'])
})

test('分叉继承：调试日志不跟过去（新局从头记）', () => {
  const child = inheritGameState(parentState(), { forkTurn: 3 })
  assert.deepEqual(child.debugLog, [], '父局的日志属于父局')
})

test('分叉继承：拿不到分叉轮次时不剪（宁可多留，也不乱删）', () => {
  const parent = parentState()
  const child = inheritGameState(parent, { forkTurn: null })
  assert.equal(child.meta.updatedTurn, 9, '不知道分叉点就保持父局的轮次')
  assert.deepEqual(child.flags.seen, { 老陈: 9, 苏晚晴: 2 })
  assert.equal(child.snapshots.index.length, 4)
  assert.notEqual(child, parent, '仍然是新对象，不是同一个引用')
})

// 宿主只在 turn > 0 时才把 turn 放进事件（plugin-api.js 的 `known` 判断），
// 于是「在开场白/第 0 轮分叉」拿到的分叉点就是 0。这时**任何**带轮次的记录都属于未来。
test('分叉继承：分叉点是第 0 轮 → 带轮次的记录一律清掉', () => {
  const parent = parentState()
  const child = inheritGameState(parent, { forkTurn: 0 })
  assert.equal(child.meta.updatedTurn, null, '子局还一轮没结算')
  for (const key of ['seen', 'left', 'draft', 'fuzzyLeft', 'playerBack', 'lastHits']) {
    const table = child.flags[key]
    assert.ok(table == null || Object.keys(table).length === 0, `flags.${key} 应清空`)
  }
  // 与轮次无关的（状态/锁/眼睛）仍保留：它们说的是「人现在什么样」，不是「第几轮发生」
  assert.deepEqual(child.flags.status, { p1: 1 })
  assert.deepEqual(child.flags.lock, { p2: true })
  assert.deepEqual(child.snapshots.index, [], '没有可继承的历史')
  assert.deepEqual(child.cooldowns, {}, '冷却全清')
})

test('分叉继承：父局数据坏成数组时当没数据，不能返回"数组挂属性"的怪东西', () => {
  const child = inheritGameState([1, 2, 3], { forkTurn: 3 })
  assert.equal(Array.isArray(child), false)
  assert.equal(child.v, 1)
  assert.deepEqual(child.snapshots.index, [])
})
