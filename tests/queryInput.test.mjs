// 查询框的输入限制（2026-11-05 定）。
//
// 查询框输的是「姓名或别名」，口径必须和改名／建档一致：
//   · 括号会跟素材里「名字(p7)」的编号尾巴打架，逗号／顿号是别名分隔符 —— 一律不许；
//   · 长度上限跟姓名一样（超过上限的名字在档案里根本不存在，查也白查）。
//
// 浏览器脚本不能 import lib，所以 client.js 照抄一份正则与上限；下面两条守卫测试比对两边。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { NAME_MAX, filterNameChars } from '../plugin/lib/inputLimit.js'

const client = readFileSync(new URL('../plugin/client.js', import.meta.url), 'utf8')
const host = readFileSync(new URL('../plugin/index.mjs', import.meta.url), 'utf8')

test('过滤：括号（半角全角）、逗号、顿号都剔掉', () => {
  assert.equal(filterNameChars('老王（大爷）'), '老王大爷')
  assert.equal(filterNameChars('老王(大爷)'), '老王大爷')
  assert.equal(filterNameChars('老陈,陈掌柜'), '老陈陈掌柜')
  assert.equal(filterNameChars('老陈，陈掌柜'), '老陈陈掌柜')
  assert.equal(filterNameChars('老陈、陈掌柜'), '老陈陈掌柜')
})

test('过滤：正常名字原样保留（间隔号、连字符、空格、英文、数字）', () => {
  for (const good of ['阿·卡', 'Anne-Marie', '张 三', '老王3号']) {
    assert.equal(filterNameChars(good), good, `${good} 不该被改`)
  }
})

test('过滤：超长截到姓名上限', () => {
  const long = '陈'.repeat(NAME_MAX + 10)
  assert.equal([...filterNameChars(long)].length, NAME_MAX)
})

test('过滤：空值不炸', () => {
  assert.equal(filterNameChars(null), '')
  assert.equal(filterNameChars(undefined), '')
})

// ── 守卫：前后端同一把尺子 ──
// 两边写岔了，面板能输进去、服务端却拒，玩家只会看到莫名其妙的一句「找不到」。

test('守卫：client.js 的名字白名单正则与 lib/inputLimit.js 完全一致', () => {
  const literal = String.raw`/^[\u4e00-\u9fff\u3400-\u4dbfA-Za-z0-9·\- \u3000]+$/u`
  assert.ok(client.includes(literal), 'client.js 没抄同一份名字正则（或抄岔了）')
})

test('守卫：client.js 的姓名上限与 NAME_MAX 一致', () => {
  assert.ok(client.includes(`NAME_MAX = ${NAME_MAX}`), `client.js 的上限不是 ${NAME_MAX}`)
})

test('守卫：client.js 的查询框真的用了过滤函数', () => {
  assert.match(client, /filterNameChars\(/, '查询框没接过滤函数')
})

test('守卫：三个查询接口都做了名字校验（防绕过面板直接打接口）', () => {
  for (const name of ['lookup-person', 'find-person', 'recall-person']) {
    const start = host.indexOf(`'character-archives/${name}'`)
    assert.ok(start > 0, `宿主没注册 ${name}`)
    const next = host.indexOf('ctx.tavern.handle', start + 10)
    const block = host.slice(start, next === -1 ? undefined : next)
    assert.match(block, /checkText\(/, `${name} 没有做名字校验`)
  }
})
