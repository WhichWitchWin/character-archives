// 设置读取守卫：`resolveSettings()` 返回的是**分组结构**（`settings.recall.cooldownTurns`），
// 不是扁平键。按扁平键读会永远拿到 undefined，于是玩家改了设置也没用——
// 这类 bug 不会报错、不会让测试挂，只会让人以为"这个开关是假的"（2026-11-06 发现 12 处）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../plugin/index.mjs', import.meta.url), 'utf8')

const FLAT_READS = [
  ['召回冷却开关', /settings\.cooldownOn/],
  ['召回冷却轮数', /settings\.cooldownTurns/],
  ['召回字数预算', /settings\.budgetChars/],
  ['查档案默认档位', /settings\.queryLevel/],
  ['查询工具开关', /settings\.modelQueryTool/],
  ['沉降轮数', /settings\.dormantTurns/],
]

test('设置必须按分组读，不能读扁平键', () => {
  for (const [what, pattern] of FLAT_READS) {
    assert.ok(!pattern.test(src), `${what} 还在按扁平键读（要写成 settings.recall?.xxx）`)
  }
})

test('调用模型方式读的是 mode 字段，不是整个分组对象', () => {
  // 传整个对象进去 → 档位认不出 → 回落默认「跟随后台」→ 玩家选「关闭」也关不掉
  assert.ok(!/mode:\s*settings\.writeback\s*[,}]/.test(src), 'mode 传了分组对象')
  assert.ok(!/settings\.writeback\s*!==/.test(src), '拿分组对象跟字符串比，永远为真')
  assert.match(src, /settings\.writeback\?\.mode/, '应当读 settings.writeback?.mode')
})

test('分组读法确实接上了（不是把整段删掉蒙过去）', () => {
  assert.match(src, /settings\.recall\?\.cooldownTurns/, '冷却轮数要读 recall 组')
  assert.match(src, /settings\.recall\?\.budgetChars/, '字数预算要读 recall 组')
  assert.match(src, /settings\.recall\?\.queryLevel/, '默认档位要读 recall 组')
  assert.match(src, /settings\.recall\?\.modelQueryTool/, '查询工具开关要读 recall 组')
  assert.match(src, /settings\.recall\?\.dormantTurns/, '沉降轮数要读 recall 组')
})
