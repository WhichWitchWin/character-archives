// 人物级动作：建档 / 改状态 / 模糊建档，以及姓名／别名／栏目名校验。
//
// 值级动作（新增／覆盖／删除／判定／无变化）已于 2026-11-05 整体删除——
// 那套服务的是人物第 4 格（旧「条目」结构），新写入只走命题＋指针。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { passedWithoutBuild, validatePersonActions } from '../plugin/lib/actions.js'

// ── 层 1：名字必须来自正文（B2 后续）──
// 模型会给通用称谓套外壳造名字（「老头」→「蓝布夹克老头」），
// 而「蓝布夹克老头」正文里根本没有——这是程序能确定性查出来的。
test('建档：姓名不在正文里出现 → 拒绝', () => {
  const { valid, rejected } = validatePersonActions(
    [{ 动作: '建档', 姓名: '张掌柜', 状态: '在场' }],
    { persons: [], draft: {}, mainNames: [], body: '老头也跟着出了站，蓝布夹克敞着。' },
  )
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /正文/)
})

test('建档：别名是模型自己拼出来的 → 拒绝整条建档', () => {
  // 正文只有「老头」和「蓝布夹克」两处，没有「蓝布夹克老头」
  const { valid, rejected } = validatePersonActions(
    [{ 动作: '建档', 姓名: '老头', 别名: '蓝布夹克老头', 状态: '在场' }],
    { persons: [], draft: {}, mainNames: [], body: '**老头**也跟着出了站，蓝布夹克敞着。' },
  )
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /别名/)
})

test('建档：姓名和别名都在正文里 → 通过', () => {
  const { valid, rejected } = validatePersonActions(
    [{ 动作: '建档', 姓名: '沈清禾', 别名: '小禾', 状态: '在场' }],
    { persons: [], draft: {}, mainNames: [], body: '沈清禾站在窗边，小禾冲他点了点头。' },
  )
  assert.equal(rejected.length, 0)
  assert.equal(valid.length, 1)
})

test('建档：别名可以有多个，只要都在正文里', () => {
  const { valid, rejected } = validatePersonActions(
    [{ 动作: '建档', 姓名: '陈守义', 别名: '陈掌柜,老陈', 状态: '在场' }],
    { persons: [], draft: {}, mainNames: [], body: '陈守义在柜台后，老陈也搭了把手，陈掌柜的账本就摊在桌上。' },
  )
  assert.equal(rejected.length, 0)
  assert.equal(valid.length, 1)
})

test('建档：没给正文就不做这项检查（老调用方不受影响）', () => {
  const { valid } = validatePersonActions(
    [{ 动作: '建档', 姓名: '随便什么名', 状态: '在场' }],
    { persons: [], draft: {}, mainNames: [] },
  )
  assert.equal(valid.length, 1)
})

test('建档：正文里的称呼换了说法（不是原文）也算不在正文里', () => {
  const { valid, rejected } = validatePersonActions(
    [{ 动作: '建档', 姓名: '陈大哥', 状态: '在场' }],
    { persons: [], draft: {}, mainNames: [], body: '陈守义在柜台后。' },
  )
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /正文/)
})

// ── 回头测试独立成动作后的校验（ADR 0062）──
test('回头测试：动作本身要被认（不是"动作名不认识"）', () => {
  const { valid, rejected } = validatePersonActions(
    [{ 动作: '回头测试', 通过: ['沈清禾'], 不通过: [{ 称呼: '老头', 原因: '标配' }] }],
    { persons: [], draft: {}, mainNames: [], requireLook: true, },
  )
  assert.equal(rejected.length, 0)
  assert.equal(valid.length, 1)
  assert.equal(valid[0].type, 'look')
})

test('回头测试：建档的人不在「通过」名单里 → 拒', () => {
  const { valid, rejected } = validatePersonActions(
    [
      { 动作: '回头测试', 通过: ['沈清禾'], 不通过: [{ 称呼: '老头', 原因: '标配' }] },
      { 动作: '建档', 姓名: '老头', 状态: '在场' },
    ],
    { persons: [], draft: {}, mainNames: [], requireLook: true, body: '老头也跟着出了站。' },
  )
  assert.equal(valid.filter((item) => item.type === 'create').length, 0)
  assert.match(rejected[0].reason, /回头测试/)
})

test('回头测试：不在「通过」也不在「不通过」里 → 拒（模型没表态）', () => {
  const { valid, rejected } = validatePersonActions(
    [
      { 动作: '回头测试', 通过: ['沈清禾'], 不通过: [] },
      { 动作: '建档', 姓名: '林昭', 状态: '在场' },
    ],
    { persons: [], draft: {}, mainNames: [], requireLook: true, body: '林昭点了点头。' },
  )
  assert.equal(valid.filter((item) => item.type === 'create').length, 0)
  assert.match(rejected[0].reason, /回头测试/)
})

test('回头测试：「通过」里的称呼必须正文里原样出现 → 那个称呼不算通过', () => {
  const { valid, rejected } = validatePersonActions(
    [
      { 动作: '回头测试', 通过: ['沈清禾', '凭空的称呼'], 不通过: [] },
      { 动作: '建档', 姓名: '凭空的称呼', 状态: '在场' },
    ],
    { persons: [], draft: {}, mainNames: [], body: '沈清禾站在窗边。', requireLook: true },
  )
  assert.equal(valid.filter((item) => item.type === 'create').length, 0)
  assert.match(rejected[0].reason, /正文/)
})

test('回头测试：本轮没有回头测试动作 → 建档全拒（模型没表态就不许建）', () => {
  const { valid, rejected } = validatePersonActions(
    [{ 动作: '建档', 姓名: '沈清禾', 状态: '在场' }],
    { persons: [], draft: {}, mainNames: [], body: '沈清禾站在窗边。', requireLook: true },
  )
  assert.equal(valid.filter((item) => item.type === 'create').length, 0)
  assert.match(rejected[0].reason, /回头测试/)
})

test('回头测试：没给正文就不查「通过名单里的称呼」这一项', () => {
  const { valid } = validatePersonActions(
    [
      { 动作: '回头测试', 通过: ['沈清禾'], 不通过: [] },
      { 动作: '建档', 姓名: '沈清禾', 状态: '在场' },
    ],
    { persons: [], draft: {}, mainNames: [], requireLook: true, },
  )
  assert.equal(valid.filter((item) => item.type === 'create').length, 1)
})

test('回头测试：用别名建档也算通过（模型可能用别名）', () => {
  const { valid, rejected } = validatePersonActions(
    [
      { 动作: '回头测试', 通过: ['挂钥匙串的张姐'], 不通过: [] },
      { 动作: '建档', 姓名: '值班店长张', 别名: '挂钥匙串的张姐', 状态: '在场' },
    ],
    { persons: [], draft: {}, mainNames: [], requireLook: true, body: '值班店长张站在收银台后面，挂钥匙串的张姐也在。' },
  )
  assert.equal(rejected.length, 0)
  assert.equal(valid.filter((item) => item.type === 'create').length, 1)
})

test('回头测试：拒绝原因里要带上「通过名单」，方便模型知道该怎么改', () => {
  const { rejected } = validatePersonActions(
    [
      { 动作: '回头测试', 通过: ['沈清禾'], 不通过: [] },
      { 动作: '建档', 姓名: '老头', 状态: '在场' },
    ],
    { persons: [], draft: {}, mainNames: [], requireLook: true, body: '老头也跟着出了站。沈清禾站在窗边。' },
  )
  assert.match(rejected[0].reason, /沈清禾/)
})

// 模型（或玩家）报「姓名":"张","额外字段":"x"」这类东西时，
// 名字本身不能带引号、逗号、大括号、换行——不然拼进存储就乱。
test('姓名：带引号／逗号／大括号的要拒', () => {
  const { valid, rejected } = validatePersonActions(
    [{ 动作: '建档', 姓名: '张"三', 状态: '在场' }],
    { persons: [], draft: {}, mainNames: [] },
  )
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /姓名|别名/)
})

test('姓名：带换行／制表符的要拒', () => {
  const { valid, rejected } = validatePersonActions(
    [{ 动作: '建档', 姓名: '张\n三', 状态: '在场' }],
    { persons: [], draft: {}, mainNames: [] },
  )
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /姓名|别名/)
})

test('姓名：正常的（汉字、英文、数字、·、空格）要放过', () => {
  const { valid } = validatePersonActions(
    [
      { 动作: '建档', 姓名: '沈清禾', 状态: '在场' },
      { 动作: '建档', 姓名: 'Anna', 状态: '在场' },
      { 动作: '建档', 姓名: '老王3号', 状态: '在场' },
      { 动作: '建档', 姓名: '阿·卡', 状态: '在场' },
    ],
    { persons: [], draft: {}, mainNames: [] },
  )
  assert.equal(valid.length, 4)
})

test('别名：带逗号以外的怪符号要拒（逗号是分隔符，合法）', () => {
  const { valid, rejected } = validatePersonActions(
    [{ 动作: '建档', 姓名: '沈清禾', 别名: '清禾{"x":1}', 状态: '在场' }],
    { persons: [], draft: {}, mainNames: [] },
  )
  assert.equal(valid.length, 0)
  assert.match(rejected[0].reason, /姓名|别名/)
})

// ── 调试用：回头测试「通过」了，但模型没给建档动作 ──
// 老陈连续 5 轮只在「通过」名单里、从没进过 `建档`，程序照实不建——日志要能一眼看出来。
test('passedWithoutBuild：通过名单有人、没报建档 → 返回那些人', () => {
  const out = passedWithoutBuild([
    { 动作: '回头测试', 通过: ['老陈'], 不通过: [] },
    { 动作: '模糊建档', 姓名: '卖花的' },
  ])
  assert.deepEqual(out, ['老陈'])
})

test('passedWithoutBuild：建档动作的姓名命中通过名单 → 返回空', () => {
  const out = passedWithoutBuild([
    { 动作: '回头测试', 通过: ['老陈'], 不通过: [] },
    { 动作: '建档', 姓名: '老陈' },
  ])
  assert.deepEqual(out, [])
})

test('passedWithoutBuild：建档动作用别名命中通过名单也算覆盖', () => {
  const out = passedWithoutBuild([
    { 动作: '回头测试', 通过: ['老陈'], 不通过: [] },
    { 动作: '建档', 姓名: '陈守义', 别名: '老陈,陈掌柜' },
  ])
  assert.deepEqual(out, [])
})

test('passedWithoutBuild：没有回头测试块 / 空值 → 返回空', () => {
  assert.deepEqual(passedWithoutBuild([{ 动作: '模糊建档', 姓名: '卖花的' }]), [])
  assert.deepEqual(passedWithoutBuild(null), [])
  assert.deepEqual(passedWithoutBuild([]), [])
})

