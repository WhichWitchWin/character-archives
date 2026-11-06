// 主角常驻档案（ADR 0085）：编号 p0、名字跟玩家称呼同步、一/二人称永远在场。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PLAYER_ID, ensurePlayer, isPlayer, isPronounName, playerNameOf } from '../plugin/lib/player.js'
import { resolvePersonRef, validatePersonActions } from '../plugin/lib/actions.js'
import { STATUS } from '../plugin/lib/snapshot.js'

const P = (id, status, name) => [id, status, name, '']

test('isPlayer：只认 p0', () => {
  assert.equal(isPlayer('p0'), true)
  assert.equal(isPlayer('p1'), false)
  assert.equal(isPlayer(null), false)
})

// 第二人称卡里 `{{user}}` 常常就是「你」——代词不是名字，不能进档案（2026-11-05）
test('isPronounName：人称代词认得出来', () => {
  for (const word of ['你', '我', '他', '她', '您', '你们', '我们', '他们']) {
    assert.equal(isPronounName(word), true, `${word} 该算代词`)
  }
  for (const word of ['林澈', '阿·卡', '小你']) {
    assert.equal(isPronounName(word), false, `${word} 不该算代词`)
  }
})

test('playerNameOf：代词也照样用——它就是玩家的真称呼，别偷偷改掉', () => {
  assert.equal(playerNameOf('你'), '你')
  assert.equal(playerNameOf('我'), '我')
  assert.equal(playerNameOf('林澈'), '林澈')
  assert.equal(playerNameOf(''), '主角')
})

test('ensurePlayer：名字是代词也不动（它就是玩家称呼）', () => {
  const persons = [P(PLAYER_ID, STATUS.PRESENT, '你')]
  const result = ensurePlayer(persons, { name: '你', alwaysPresent: true })
  assert.equal(result.changed, false)
  assert.equal(result.persons[0][2], '你')
})

// 人物固定 4 格：多一格会被 readSnapshot 当成坏数据整条丢掉，主角就"消失"了。
test('ensurePlayer：新建的主角是 4 格', () => {
  const result = ensurePlayer([], { name: '林澈', alwaysPresent: true })
  assert.equal(result.created, true)
  assert.deepEqual(result.persons[0], [PLAYER_ID, STATUS.PRESENT, '林澈', ''])
})

test('ensurePlayer：新建的主角名字空着时用「主角」', () => {
  const result = ensurePlayer([], { name: '  ' })
  assert.equal(result.persons[0][2], '主角')
})

// ── 代词认成主角本人（2026-11-05）──
// 第二人称写作时正文满篇「你」，模型报「谁＝你」指的就是主角本人。
// 不认的话不是"多建一个人"，而是**主视角的认知永远记不进来**（找不到人 → 整条被拒）。

test('resolvePersonRef：第二人称的「你」认成主角本人', () => {
  const persons = [P(PLAYER_ID, STATUS.PRESENT, '林澈'), P('p1', STATUS.PRESENT, '老陈')]
  assert.equal(resolvePersonRef(persons, '你', { person: 'second' }), PLAYER_ID)
})

test('resolvePersonRef：第一人称的「我」认成主角本人', () => {
  const persons = [P(PLAYER_ID, STATUS.PRESENT, '林澈')]
  assert.equal(resolvePersonRef(persons, '我', { person: 'first' }), PLAYER_ID)
})

test('resolvePersonRef：第三人称不映射代词（「他」可能指任何人）', () => {
  const persons = [P(PLAYER_ID, STATUS.PRESENT, '林澈')]
  assert.equal(resolvePersonRef(persons, '你', { person: 'third' }), null)
})

test('resolvePersonRef：不是代词就走原来的按名字匹配', () => {
  const persons = [P(PLAYER_ID, STATUS.PRESENT, '林澈'), P('p1', STATUS.PRESENT, '老陈')]
  assert.equal(resolvePersonRef(persons, '老陈', { person: 'second' }), 'p1')
})

test('resolvePersonRef：主角档不存在时不硬造命中', () => {
  assert.equal(resolvePersonRef([P('p1', STATUS.PRESENT, '老陈')], '你', { person: 'second' }), null)
})

test('改状态：第二人称下报「你」，认成主角而不是找不到', () => {
  const persons = [P(PLAYER_ID, STATUS.PRESENT, '林澈')]
  const result = validatePersonActions(
    [{ 动作: '改状态', 人物: '你', 状态: '在场' }],
    { persons, draft: {}, mainNames: ['林澈'], person: 'second' },
  )
  assert.equal(result.valid.length, 1, result.rejected[0]?.reason ?? '')
  assert.equal(result.valid[0].id, PLAYER_ID)
})

test('建档：人称代词不许当名字（「你」是主角，不是新人物）', () => {
  const result = validatePersonActions(
    [{ 动作: '建档', 姓名: '你', 状态: '在场' }],
    { persons: [], draft: {}, mainNames: [], body: '你推门进去，柜台后站着个老头', requireLook: false },
  )
  assert.equal(result.valid.length, 0, '不该通过')
  assert.ok(result.rejected[0].reason.includes('代词'), result.rejected[0].reason)
})

test('模糊建档：人称代词也不许进候选表（否则面板上一直挂着「你」）', () => {
  const result = validatePersonActions(
    [{ 动作: '模糊建档', 姓名: '你' }],
    { persons: [], draft: {}, mainNames: [], body: '你推门进去，柜台后站着个老头' },
  )
  assert.equal(result.valid.length, 0, '不该进候选')
  assert.ok(result.rejected[0].reason.includes('代词'), result.rejected[0].reason)
})

test('playerNameOf：称呼为空时用「主角」占位（姓名不可留空）', () => {
  assert.equal(playerNameOf('林澈'), '林澈')
  assert.equal(playerNameOf('   '), '主角')
  assert.equal(playerNameOf(null), '主角')
})

test('ensurePlayer：没有就补一个，默认在场', () => {
  const result = ensurePlayer([P('p1', STATUS.PRESENT, '老陈')], { name: '林澈' })
  assert.equal(result.created, true)
  assert.equal(result.persons.length, 2)
  assert.equal(result.persons[0][0], PLAYER_ID)
  assert.equal(result.persons[0][1], STATUS.PRESENT)
  assert.equal(result.persons[0][2], '林澈')
})

test('ensurePlayer：名字跟着身份设置变，别的不动', () => {
  const persons = [P(PLAYER_ID, STATUS.OFFLINE, '旧名字'), P('p1', STATUS.PRESENT, '老陈')]
  const result = ensurePlayer(persons, { name: '林澈' })
  assert.equal(result.changed, true)
  assert.equal(result.persons[0][2], '林澈')
  assert.equal(result.persons[0][1], STATUS.OFFLINE, '三人称下不强行拉回在场')
  assert.equal(result.persons[1][2], '老陈', '别人不受影响')
})

test('ensurePlayer：一/二人称永远在场——离场会被拉回来', () => {
  const persons = [P(PLAYER_ID, STATUS.OFFLINE, '林澈')]
  const result = ensurePlayer(persons, { name: '林澈', alwaysPresent: true })
  assert.equal(result.persons[0][1], STATUS.PRESENT)
})

test('ensurePlayer：名字没变、状态也对时不报 changed', () => {
  const persons = [P(PLAYER_ID, STATUS.PRESENT, '林澈')]
  const result = ensurePlayer(persons, { name: '林澈', alwaysPresent: true })
  assert.equal(result.changed, false)
  assert.equal(result.created, false)
})
