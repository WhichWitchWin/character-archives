// 姓名规则：能改但不能留空；姓名留空的人既不召回也不写入；导入同样体检。
//
// 为什么单独一个文件：这三件事共用同一条口径——**姓名是召回与写入的唯一门牌号**，
// 没有姓名的人不是"编号还在就算数"，而是彻底退出召回与写入两条链路。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { validateArchivePersons, validateBundle } from '../plugin/lib/exportBundle.js'
import { renamePerson, resolvePersonByName, setPersonNames } from '../plugin/lib/actions.js'
import { buildWriteMaterial } from '../plugin/lib/writeMaterial.js'
import { splitAliases } from '../plugin/lib/names.js'
import { resolveIdentity } from '../plugin/lib/identity.js'

/** 人物：[编号, 状态, 姓名, 别名串] —— 4 格固定 */
const P = (id, status, name, aliases = '') => [id, status, name, aliases]

// ── 导入体检 ──

test('导入体检：4 格必须齐，缺别名那格也不给过', () => {
  const result = validateArchivePersons([['p1', 1, '老陈']])
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('4 格') || result.reason.includes('别名'), result.reason)
})

test('导入体检：姓名留空 → 拒', () => {
  const result = validateArchivePersons([P('p1', 1, '   ')])
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('姓名'), result.reason)
})

test('导入体检：别名留空是允许的', () => {
  const result = validateArchivePersons([P('p1', 1, '老陈')])
  assert.equal(result.ok, true, result.reason ?? '')
})

test('导入体检：两个人的姓名撞了 → 拒', () => {
  const result = validateArchivePersons([P('p1', 1, '老陈'), P('p2', 1, '老陈')])
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('老陈'), result.reason)
})

test('导入体检：一个人的别名撞另一个人的姓名 → 拒', () => {
  const result = validateArchivePersons([P('p1', 1, '老陈', '李四'), P('p2', 1, '李四')])
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('李四'), result.reason)
})

test('导入体检：姓名和自己的别名一样 → 拒', () => {
  const result = validateArchivePersons([P('p1', 1, '老陈', '老陈')])
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('老陈'), result.reason)
})

test('导入体检：干净的包能过', () => {
  const result = validateArchivePersons([P('p1', 1, '老陈', '陈掌柜,老陈头'), P('p2', 0, '李四')])
  assert.equal(result.ok, true, result.reason ?? '')
})

// ── 空姓名不给写入 ──

test('姓名留空的人：连写入素材都不占位置（在场、被提到都不列）', () => {
  const snapshot = {
    p: [['p1', 1, ''], ['p2', 1, '老陈']],
    c: [[1, 'p2', 'a', '在旧港', 3, [], 0]],
    pt: [['p2', 1, [[0, '']], 3]],
    loc: '',
  }
  const material = buildWriteMaterial({
    snapshot,
    presentIds: new Set(['p2']),
    mentionedIds: new Set(['p1']),
    turn: 5,
  })
  assert.deepEqual(material.people.map((item) => item.id), ['p2'], '在场的人照常列')
  assert.deepEqual(material.mentioned, [], '被提到的空姓名人不该列——他没有门牌号，报出来也写不进去')
})

// 锁住的人（🔒）：模型压根不该知道有这个人——写入素材里完全剔掉（命题和指针都不给写）
test('锁住的人：写入素材里完全不出现（在场、被提到都不列）', () => {
  const snapshot = {
    p: [['p1', 1, '老陈'], ['p2', 1, '李四']],
    c: [[1, 'p1', 'a', '在旧港', 3, []]],
    pt: [['p1', 1, [[0, '']], 3]],
    loc: '',
  }
  const material = buildWriteMaterial({
    snapshot,
    presentIds: new Set(['p1', 'p2']),
    mentionedIds: new Set(['p1']),
    locked: new Set(['p1']),
    turn: 5,
  })
  assert.deepEqual(material.people.map((item) => item.id), ['p2'], '锁住的人不列')
  assert.deepEqual(material.mentioned, [], '被提到的锁住的人也不列')
})

test('姓名留空的人：模型报他的别名，也当找不到（写入不进去）', () => {  assert.equal(resolvePersonByName([P('p1', 1, '', '老陈')], '老陈'), null)
})

test('姓名留空的人：报编号仍然认（内部调用不受影响）', () => {
  assert.equal(resolvePersonByName([P('p1', 1, '', '老陈')], 'p1'), 'p1')
})

// ── 改名 ──

test('改名：正常改名成功，别名原样保留', () => {
  const result = renamePerson([P('p1', 1, '老陈', '陈掌柜')], { id: 'p1', name: '陈守义' })
  assert.equal(result.ok, true, result.reason ?? '')
  assert.equal(result.persons[0][2], '陈守义')
  assert.equal(result.persons[0][3], '陈掌柜')
})

test('改名：留空 → 拒，并说清原因', () => {
  const result = renamePerson([P('p1', 1, '老陈')], { id: 'p1', name: '   ' })
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('姓名'), result.reason)
})

test('改名：撞别人的姓名 → 拒', () => {
  const result = renamePerson([P('p1', 1, '老陈'), P('p2', 1, '李四')], { id: 'p1', name: '李四' })
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('李四'), result.reason)
})

test('改名：撞别人的别名 → 拒', () => {
  const result = renamePerson([P('p1', 1, '老陈'), P('p2', 1, '李四', '掌柜')], { id: 'p1', name: '掌柜' })
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('掌柜'), result.reason)
})

test('改名：撞自己的别名 → 拒', () => {
  const result = renamePerson([P('p1', 1, '老陈', '陈掌柜')], { id: 'p1', name: '陈掌柜' })
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('陈掌柜'), result.reason)
})

test('改名：撞主角的名字 → 拒', () => {
  const result = renamePerson([P('p1', 1, '老陈')], { id: 'p1', name: '沈青', mainNames: ['沈青'] })
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('主角'), result.reason)
})

test('改名：人不存在 → 拒', () => {
  const result = renamePerson([P('p1', 1, '老陈')], { id: 'p9', name: '新人' })
  assert.equal(result.ok, false)
})

test('改名：不许动别人的原始数组（返回新数组）', () => {
  const persons = [P('p1', 1, '老陈')]
  const result = renamePerson(persons, { id: 'p1', name: '陈守义' })
  assert.equal(result.ok, true)
  assert.equal(persons[0][2], '老陈', '原数组不该被改')
})

// ── 接线守卫：面板和宿主必须用同一个接口名 ──
// 两边名字写岔了，面板会静默改不了名（宿主侧只留一行日志），最难查。
test('接线：面板改姓名调用的接口，宿主真的注册了', () => {
  const client = readFileSync(new URL('../plugin/client.js', import.meta.url), 'utf8')
  const host = readFileSync(new URL('../plugin/index.mjs', import.meta.url), 'utf8')
  assert.ok(client.includes('/rename-person'), '面板没调用改姓名接口')
  assert.ok(host.includes("'character-archives/rename-person'"), '宿主没注册改姓名接口')
})

test('接线：面板「姓名 + 别名」一起保存的接口，宿主也注册了', () => {
  const client = readFileSync(new URL('../plugin/client.js', import.meta.url), 'utf8')
  const host = readFileSync(new URL('../plugin/index.mjs', import.meta.url), 'utf8')
  assert.ok(client.includes("'set-names'"), '面板没调用 set-names')
  assert.ok(host.includes("'character-archives/set-names'"), '宿主没注册 set-names')
})

// ── 只读 review 抓到的三个缺陷（2026-11-04）──
test('别名切分：全角逗号、顿号都算分隔符', () => {
  assert.deepEqual(splitAliases('老陈头，掌柜、陈掌柜'), ['老陈头', '掌柜', '陈掌柜'])
})

test('别名切分：数组与半角逗号也认，重复去掉', () => {
  assert.deepEqual(splitAliases(['老陈,陈掌柜', '陈掌柜']), ['老陈', '陈掌柜'])
})

test('导入体检：别名用全角逗号分隔时，撞名照样拦得住', () => {
  const result = validateArchivePersons([P('p1', 1, '掌柜'), P('p2', 1, '老陈', '老陈头，掌柜')])
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('掌柜'), result.reason)
})

test('导入体检：编号重复 → 拒（否则按编号的操作会全打到第一个人）', () => {
  const result = validateArchivePersons([P('p1', 1, '老陈'), P('p1', 1, '李四')])
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('编号'), result.reason)
})

test('导入接线：validateBundle 真的会跑人物体检', () => {
  const bundle = {
    format: 'character-archives',
    version: 1,
    kind: 'archive',
    preset: { name: 'x', entries: { a: { name: '位置' } }, order: ['a'] },
    archive: { persons: [P('p1', 1, '老陈'), P('p2', 1, '老陈')], dict: { v: 1, d: [], t: [] } },
  }
  const result = validateBundle(bundle)
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('老陈'), result.reason)
})

test('写入找人：名字本身带括号也要按名字找到，不能当成编号尾巴', () => {
  assert.equal(resolvePersonByName([P('p1', 1, '老王（大爷）')], '老王（大爷）'), 'p1')
  assert.equal(resolvePersonByName([P('p1', 1, '老王(大爷)')], '老王(大爷)'), 'p1')
})

test('写入找人：素材里的「名字(p7)」尾巴照样认', () => {
  assert.equal(resolvePersonByName([P('p1', 1, '老陈')], '老陈(p1)'), 'p1')
})

test('写入找人：尾巴指向空姓名的人也不给写入', () => {
  assert.equal(resolvePersonByName([P('p1', 1, '')], '(p1)'), null)
})

test('改名：原样保存（名字没变）不会被自己的旧名判成撞名', () => {
  const result = renamePerson([P('p1', 1, '老陈', '陈掌柜')], { id: 'p1', name: '老陈' })
  assert.equal(result.ok, true, result.reason ?? '')
})

test('改名：给空姓名的人补一个名字可以（这是他「复活」的唯一办法）', () => {
  const result = renamePerson([P('p1', 1, '')], { id: 'p1', name: '老陈' })
  assert.equal(result.ok, true, result.reason ?? '')
})

// ── 姓名与别名一起改（解决「旧姓名挪进别名」的死循环）──
// 分开改会卡死：别名不许等于现在的姓名，姓名又不许撞现在的别名。
// 一起提交时按**提交后的样子**校验，就能一步到位。

test('一起改：旧姓名挪进别名、新姓名同时换上', () => {
  const result = setPersonNames([P('p1', 1, '老陈', '陈掌柜')], {
    id: 'p1',
    name: '陈守义',
    aliases: '陈掌柜,老陈',
  })
  assert.equal(result.ok, true, result.reason ?? '')
  assert.equal(result.persons[0][2], '陈守义')
  assert.equal(result.persons[0][3], '陈掌柜,老陈')
})

test('一起改：别名里又写回新姓名 → 拒（姓名和别名不能是同一个）', () => {
  const result = setPersonNames([P('p1', 1, '老陈')], { id: 'p1', name: '陈守义', aliases: '陈守义' })
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('陈守义'), result.reason)
})

test('一起改：别名撞别人的名字 → 拒', () => {
  const result = setPersonNames([P('p1', 1, '老陈'), P('p2', 1, '李四')], {
    id: 'p1',
    name: '老陈',
    aliases: '李四',
  })
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('李四'), result.reason)
})

test('一起改：别名留空＝清空别名', () => {
  const result = setPersonNames([P('p1', 1, '老陈', '陈掌柜')], { id: 'p1', name: '老陈', aliases: '' })
  assert.equal(result.ok, true, result.reason ?? '')
  assert.equal(result.persons[0][3], '')
})

test('一起改：别名用全角逗号／顿号分隔，统一存成半角逗号', () => {
  const result = setPersonNames([P('p1', 1, '老陈')], { id: 'p1', name: '老陈', aliases: '陈掌柜、老陈头，阿陈' })
  assert.equal(result.ok, true, result.reason ?? '')
  assert.equal(result.persons[0][3], '陈掌柜,老陈头,阿陈')
})

// 主角改名用：旧称呼以后还可能被叫到，自动进别名（2026-11-05）
test('keepOldName：改名时旧姓名自动进别名', () => {
  const result = setPersonNames([P('p1', 1, '老陈')], { id: 'p1', name: '陈守义', keepOldName: true })
  assert.equal(result.ok, true, result.reason ?? '')
  assert.equal(result.persons[0][2], '陈守义')
  assert.equal(result.persons[0][3], '老陈')
})

test('keepOldName：旧姓名已经在别名里就不重复加', () => {
  const result = setPersonNames([P('p1', 1, '老陈', '老陈头')], { id: 'p1', name: '陈守义', keepOldName: true })
  assert.equal(result.ok, true, result.reason ?? '')
  assert.equal(result.persons[0][3], '老陈头,老陈')
})

test('keepOldName：不传就完全不动别名（普通人物改名）', () => {
  const result = setPersonNames([P('p1', 1, '老陈', '陈掌柜')], { id: 'p1', name: '陈守义' })
  assert.equal(result.persons[0][3], '陈掌柜')
})

// ── 输入限制：名字里不许出现会影响写入/召回的符号（不做兼容）──
// 括号会跟素材里「名字(p7)」的编号尾巴打架；逗号/顿号是别名分隔符，
// 名字里带它会被切成两个人名。这两种一律拒，不猜玩家想要哪个。

test('输入限制：姓名不许带括号（半角全角都不行）', () => {
  for (const bad of ['老王（大爷）', '老王(大爷)']) {
    const result = renamePerson([P('p1', 1, '老陈')], { id: 'p1', name: bad })
    assert.equal(result.ok, false, `${bad} 本该被拒`)
  }
})

test('输入限制：姓名不许带逗号／顿号（那是别名分隔符）', () => {
  for (const bad of ['老陈,陈掌柜', '老陈，陈掌柜', '老陈、陈掌柜']) {
    const result = renamePerson([P('p1', 1, '老陈')], { id: 'p1', name: bad })
    assert.equal(result.ok, false, `${bad} 本该被拒`)
  }
})

test('输入限制：别名也不许带括号或逗号', () => {
  const withParen = setPersonNames([P('p1', 1, '老陈')], { id: 'p1', name: '老陈', aliases: '老陈（头）' })
  assert.equal(withParen.ok, false)
  const withComma = setPersonNames([P('p1', 1, '老陈')], { id: 'p1', name: '老陈', aliases: ['老陈,头'] })
  assert.equal(withComma.ok, false)
})

test('输入限制：正常名字照常通过（间隔号、连字符、空格、英文、数字）', () => {
  for (const good of ['阿·卡', 'Anne-Marie', '张 三', '老王3号']) {
    const result = renamePerson([P('p1', 1, '老陈')], { id: 'p1', name: good })
    assert.equal(result.ok, true, `${good} 本该能过：${result.reason ?? ''}`)
  }
})

test('导入体检：姓名带括号 → 拒', () => {
  const result = validateArchivePersons([P('p1', 1, '老王（大爷）')])
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('姓名'), result.reason)
})

test('导入体检：姓名里带逗号 → 拒', () => {
  const result = validateArchivePersons([P('p1', 1, '老陈,陈掌柜')])
  assert.equal(result.ok, false)
  assert.ok(result.reason.includes('姓名'), result.reason)
})

// ── 玩家称呼也要限制：它同样是名字，参与撞名、还要拼进提示词 ──

test('玩家称呼：带括号／逗号等不能用的符号 → 读回来当作没填', () => {
  for (const bad of ['林(澈)', '林（澈）', '林澈,阿澈']) {
    assert.equal(resolveIdentity({ playerName: bad }).playerName, '', `${bad} 本该被清掉`)
  }
})

test('玩家称呼：正常名字照常保留（间隔号、空格、英文）', () => {
  for (const good of ['林澈', '阿·卡', 'Lin Che']) {
    assert.equal(resolveIdentity({ playerName: good }).playerName, good)
  }
})
