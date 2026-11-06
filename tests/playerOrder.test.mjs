// 主角常驻档案的时序（ADR 0085 / ADR 0101）
//
// 真出现过的坑：写入阶段跑完后才 `ensurePlayer` 建主角 p0，
// 于是同一轮里模型报「谁＝小s」的认知一律被判「不在档案里」，整条动作被拒，
// 主角对这件事的认知永远记不进来（旧日志里是「认知里的「测试人」不在档案里」）。

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { applyWriteActions } from '../plugin/lib/writeActions.js'
import { resolvePersonRef } from '../plugin/lib/actions.js'

const DEFINITIONS = { a: { name: '职业', prompt: '' }, e: { name: '最后已知去向', prompt: '' } }

test('画册里没有 p0 时：认知写「主角名」会被整条拒掉（复现）', () => {
  // 只有 NPC、没有主角：这正是写入阶段跑在 ensurePlayer 之前的样子
  const snapshot = { v: 1, t: 2, p: [['p1', 1, '沈清禾', '']], gt: '第一天', loc: '', c: [], pt: [] }
  const result = applyWriteActions({
    snapshot,
    actions: [{
      关于: '沈清禾',
      栏目: '职业',
      值: '地铁上的上班族',
      认知: [{ 谁: '小s', 来源: '自己', 态度: '真' }],
    }],
    definitions: DEFINITIONS,
    turn: 2,
    gt: '第一天',
    resolvePerson: (name) => resolvePersonRef(snapshot.p, name, { person: 'second' }),
    allowedIds: new Set(['p1']),
  })

  assert.equal(result.bad.length, 1, '现在会拒一条')
  assert.match(result.bad[0].reason, /不在档案里/)
  assert.ok(
    !result.applied.some((claim) => true) || snapshot.pt.every((row) => row[0] !== 'p0'),
    '主角的指针一条都不该有',
  )
})

test('画册里有 p0 时：同一条认知能正常落成主角的指针', () => {
  const snapshot = { v: 1, t: 2, p: [['p0', 1, '小s', ''], ['p1', 1, '沈清禾', '']], gt: '第一天', loc: '', c: [], pt: [] }
  const result = applyWriteActions({
    snapshot,
    actions: [{
      关于: '沈清禾',
      栏目: '职业',
      值: '地铁上的上班族',
      认知: [{ 谁: '小s', 来源: '自己', 态度: '真' }],
    }],
    definitions: DEFINITIONS,
    turn: 2,
    gt: '第一天',
    resolvePerson: (name) => resolvePersonRef(snapshot.p, name, { person: 'second' }),
    allowedIds: new Set(['p0', 'p1']),
  })

  assert.deepEqual(result.bad, [])
  assert.equal(result.applied.length, 1)
  const playerPointer = snapshot.pt.find((row) => row[0] === 'p0')
  assert.ok(playerPointer, '主角应该有一条指针')
  assert.equal(playerPointer[1], result.applied[0][0])
})

// 守卫：顺序错了上面第一个测试就是现场。锁的是「主角必须在这一轮的材料/写入之前就建好」——
// 只比 applyWriteActions 不够：空局那条分支里本来就有一处 early ensure，会假通过。
test('index.mjs：ensurePlayer 必须排在建素材与写回之前', async () => {
  const src = readFileSync(fileURLToPath(new URL('../plugin/index.mjs', import.meta.url)), 'utf8')
  const firstEnsure = src.indexOf('ensurePlayer(')
  const firstMaterial = src.indexOf('buildCombinedPrompt(')
  const firstApplyWrite = src.indexOf('applyWriteActions(')
  assert.ok(firstEnsure > -1, 'index.mjs 里应该有 ensurePlayer')
  assert.ok(firstMaterial > -1, 'index.mjs 里应该有 buildCombinedPrompt')
  assert.ok(firstApplyWrite > -1, 'index.mjs 里应该有 applyWriteActions')
  assert.ok(
    firstEnsure < firstMaterial,
    '主角要先把档建出来，否则这一轮素材里没有主角、「谁＝主角」的认知全被拒（ADR 0101）',
  )
  assert.ok(firstEnsure < firstApplyWrite, '同上：写回之前必须有主角')
})
