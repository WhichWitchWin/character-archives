// 身份设置：玩家默认称呼 + 正文写作人称（按卡存插件数据）
//
// 为什么按卡：这两样是**这张卡怎么讲故事的设定**，和存档无关——同一张卡换存档还是它。
//
// 为什么抓不到就留空：平台的「玩家默认称呼」存在 `chat.macroState.userName`，
// 插件 API 没有暴露（getTurnState / getRequestContext / getCardContext / getCard 都查过）。
// 所以默认空着、界面给提示，玩家填一次就按卡记住。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_IDENTITY,
  PERSON_OPTIONS,
  applyIdentityPatch,
  identityProblem,
  pronounOf,
  resolveIdentity,
} from '../plugin/lib/identity.js'

test('默认值：称呼留空、人称默认第二人称', () => {
  assert.equal(DEFAULT_IDENTITY.playerName, '')
  assert.equal(DEFAULT_IDENTITY.person, 'second')
})

test('人称选项：三种齐全，第二人称排在推荐位', () => {
  assert.deepEqual(PERSON_OPTIONS.map((item) => item.value), ['first', 'second', 'third'])
  assert.deepEqual(PERSON_OPTIONS.map((item) => item.label), ['第一人称', '第二人称', '第三人称'])
})

test('代词：第一人称「我」、第二人称「你」、第三人称「他」', () => {
  assert.equal(pronounOf('first'), '我')
  assert.equal(pronounOf('second'), '你')
  assert.equal(pronounOf('third'), '他')
  assert.equal(pronounOf('乱写'), '你', '不认识的一律当第二人称')
})

test('读取：存过的叠到默认值上，脏数据回落', () => {
  assert.deepEqual(resolveIdentity(null), { playerName: '', person: 'second' })
  assert.deepEqual(resolveIdentity({ playerName: '林澈', person: 'first' }), { playerName: '林澈', person: 'first' })
  assert.deepEqual(resolveIdentity({ playerName: 123, person: '乱写' }), { playerName: '', person: 'second' })
})

test('改值：称呼去空格、超长截断；人称只认三个选项', () => {
  const next = applyIdentityPatch(resolveIdentity(), { playerName: '  林澈  ', person: 'third' })
  assert.equal(next.playerName, '林澈')
  assert.equal(next.person, 'third')

  assert.equal(applyIdentityPatch(resolveIdentity(), { playerName: 'x'.repeat(40) }).playerName.length, 24)
  assert.equal(applyIdentityPatch(resolveIdentity(), { person: '第四人称' }).person, 'second')
})

test('改值：纯函数，不动入参', () => {
  const before = resolveIdentity({ playerName: '林澈', person: 'first' })
  const snapshot = { ...before }
  applyIdentityPatch(before, { playerName: '别人' })
  assert.deepEqual(before, snapshot)
})

test('改值：不认识的键忽略', () => {
  const next = applyIdentityPatch(resolveIdentity(), { 乱写: 1 })
  assert.equal(next.乱写, undefined)
})

// ── 称呼不能是代词；第三人称必须填名字（2026-11-05）──
// 代词（中英文）不是名字：拿它当称呼，档案里就会出现"叫「你」的人"，
// 匹配层分不清是主角还是新角色。第三人称更硬：正文里要靠名字指代主角，没名字就断了。

test('称呼：中英文代词都不能当名字（改了不生效）', () => {
  for (const bad of ['你', '我', '他', '她', '您', 'I', 'me', 'You', 'THEM', 'she', 'Us']) {
    const next = applyIdentityPatch(resolveIdentity({ playerName: '林澈' }), { playerName: bad })
    assert.equal(next.playerName, '林澈', `「${bad}」不该生效`)
  }
})

test('称呼：正经名字照常（中英文、间隔号都行）', () => {
  for (const good of ['林澈', 'Lin Che', '阿·卡']) {
    assert.equal(applyIdentityPatch(resolveIdentity(), { playerName: good }).playerName, good)
  }
})

test('身份体检：第三人称必须填名字', () => {
  assert.ok(identityProblem({ person: 'third', playerName: '' }))
  assert.equal(identityProblem({ person: 'third', playerName: '林澈' }), null)
  assert.equal(identityProblem({ person: 'second', playerName: '' }), null, '第二人称空着没事（人称就是「你」）')
  assert.equal(identityProblem({ person: 'first', playerName: '' }), null)
})
