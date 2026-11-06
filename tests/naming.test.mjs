// 接口名字必须过酒馆的校验规则（实名踩过两次坑，加测试守住）
//
// 规则来自 dsh-tavern-plugin 的 plugin-api.js：
//   SECTION_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/       turnSection / section 的 name
//   HANDLER_NAME = /^[a-z0-9][a-z0-9._:/-]{0,95}$/     handle 的 name
//   TOOL_NAME    = /^[a-z][a-z0-9_]{2,47}$/            工具名（不许连字符）
//
// 这些错都发生在 apply() 里，**一旦抛错整个插件起不来**，而且不写测试很难提前发现。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'plugin', 'index.mjs'), 'utf8')

const SECTION_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
const HANDLER_NAME = /^[a-z0-9][a-z0-9._:/-]{0,95}$/
const TOOL_NAME = /^[a-z][a-z0-9_]{2,47}$/

test('所有 handle 名字都合法（只许小写）', () => {
  const names = [...source.matchAll(/ctx\.tavern\.handle\(\s*'([^']+)'/g)].map((m) => m[1])
  assert.ok(names.length >= 8, `只找到 ${names.length} 个 handle，正则可能过时了`)
  for (const name of names) {
    assert.match(name, HANDLER_NAME, `handle 名字不合法：${name}`)
  }
})

test('turnSection 的 name 合法（不许中文）', () => {
  const match = source.match(/ctx\.tavern\.turnSection\(\{[\s\S]*?name:\s*'([^']+)'/)
  assert.ok(match, '没找到 turnSection 的 name')
  assert.match(match[1], SECTION_NAME, `section 名字不合法：${match[1]}`)
})

test('工具名合法（不许连字符）', () => {
  const names = [...source.matchAll(/name:\s*'([a-z][a-z0-9_-]*)',\s*\n\s*description:/g)].map((m) => m[1])
  for (const name of names) {
    assert.match(name, TOOL_NAME, `工具名不合法：${name}`)
  }
})

test('客户端调用的接口名，宿主侧都注册了', () => {
  const client = readFileSync(join(here, '..', 'plugin', 'client.js'), 'utf8')
  const registered = new Set(
    [...source.matchAll(/ctx\.tavern\.handle\(\s*'character-archives\/([^']+)'/g)].map((m) => m[1]),
  )

  // 两种写法都要抓：模板串里直接拼的、以及当参数传的 call('xxx', …)
  const literal = [...client.matchAll(/`\$\{PLUGIN\}\/([a-z0-9-]+)`/g)].map((m) => m[1])
  const passed = [...client.matchAll(/\b(?:call|callHost)\(\s*'([a-z0-9-]+)'/g)].map((m) => m[1])
  const called = new Set([...literal, ...passed])

  assert.ok(called.size >= 5, `客户端只调用了 ${called.size} 个接口，正则可能过时了`)
  for (const name of called) {
    assert.ok(registered.has(name), `客户端调了 ${name}，但宿主侧没注册`)
  }
})

test('客户端里不许留旧名字（大小写混合的接口名）', () => {
  const client = readFileSync(join(here, '..', 'plugin', 'client.js'), 'utf8')
  const bad = [...client.matchAll(/['"`]([a-z]+[A-Z][A-Za-z]*)['"`]/g)].map((m) => m[1])
  // 只关心像接口名的（setValue / deleteValue / addEntry 这种）
  const suspicious = bad.filter((name) => /^(set|delete|add|get|update)[A-Z]/.test(name))
  assert.deepEqual(suspicious, [], `客户端里还有驼峰接口名：${suspicious.join(', ')}`)
})

// ── 宿主接口的参数形状（已经踩过坑，加守卫）──
// savePluginData 收的是 { data }，传裸对象会解构成 undefined → "data 不能省略"
test('savePluginData 必须包成 { data }', () => {
  const calls = [...source.matchAll(/savePluginData\(\s*([^)]*)/g)].map((m) => m[1].trim())
  assert.ok(calls.length > 0, '没找到 savePluginData 调用，正则可能过时了')
  for (const arg of calls) {
    assert.ok(arg.startsWith('{ data'), `savePluginData 的参数要写成 { data }，实际是：${arg.slice(0, 30)}`)
  }
})

test('saveGameData / saveTurnData 必须带 gameId 的具名参数', () => {
  for (const name of ['saveGameData', 'saveTurnData']) {
    const calls = [...source.matchAll(new RegExp(name + '\\(\\s*([^)]*)', 'g'))].map((m) => m[1].trim())
    for (const arg of calls) {
      assert.match(arg, /^\{\s*gameId/, `${name} 的参数要写成 { gameId, ... }，实际是：${arg.slice(0, 30)}`)
    }
  }
})

test('readPluginData 不传参数', () => {
  const calls = [...source.matchAll(/readPluginData\(\s*([^)]*)/g)].map((m) => m[1].trim())
  for (const arg of calls) {
    assert.equal(arg, '', `readPluginData 不该有参数，实际是：${arg.slice(0, 30)}`)
  }
})
