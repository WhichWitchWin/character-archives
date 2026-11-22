// 文档守卫：把「文档与代码漂移」变成 `npm test` 会红的事故。
//
// 为什么：2026-11-14 人工核了两轮才发现 8 处过期（MVU 人物字段映射早退役、人物结构
// 早变 4 格、visibility 三项早隐藏）。靠人记着同步必然会再漂；这里把能机器判定的
// 8 条钉住，剩下的（状态行对不对、描述语义是否过时）仍靠偶尔人工复核。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { collectDocIssues, cellCount, cells, DEFAULT_ROOT } from '../scripts/docsRules.mjs'

const ALLOWLIST_FILE = new URL('./docsGuard.allowlist.json', import.meta.url)
const FIXTURE = fileURLToPath(new URL('./fixtures/docs-guard', import.meta.url))
const FIXTURE_EMPTY = fileURLToPath(new URL('./fixtures/docs-guard-empty', import.meta.url))

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_FILE)) return {}
  return JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8'))
}

test('文档与代码不许漂移（ADR 索引 / 模块清单 / 设置键 / 版本号 / 状态值 / 表格 / 路径 / 符号）', async () => {
  const issues = await collectDocIssues({ root: DEFAULT_ROOT, allowlist: loadAllowlist() })
  const report = issues
    .map((item) => `  ${item.file}${item.line ? `:${item.line}` : ''} [${item.rule}] ${item.detail}`)
    .join('\n')
  assert.equal(issues.length, 0, `文档体检发现 ${issues.length} 处不一致：\n${report}`)
})

// 下面两条是「负向样例」：如果规则写歪（正则不匹配、锚点找不到就静默返回空数组），
// 上面那条正式断言会永远绿，等于没守。用故意写坏的 fixture 逼每条规则开口。
test('负向样例：坏文档上 9 条规则必须各抓到至少一处（防规则空转）', async () => {
  const issues = await collectDocIssues({ root: FIXTURE, allowlist: {} })
  const found = new Set(issues.map((item) => item.rule))
  const expected = [
    'adr-index',
    'module-missing',
    'module-unlisted',
    'setting-missing',
    'roadmap-status',
    'table-columns',
    'path-missing',
    'symbol-missing',
    'version',
  ]
  const missing = expected.filter((rule) => !found.has(rule))
  assert.deepEqual(missing, [], `这些规则在坏样例上一条都没抓到：${missing.join('、')}`)
})

test('负向样例：锚点与版本号找不到时要报，不许静默通过', async () => {
  const issues = await collectDocIssues({ root: FIXTURE_EMPTY, allowlist: {} })
  const found = new Set(issues.map((item) => item.rule))
  assert.ok(found.has('module-section-missing'), '§十三 锚点缺失没有报')
  assert.ok(found.has('version-missing'), '版本号匹配不到没有报')
})

// 下面三条守住工具本身：正则写歪会让上面几条永远绿。
test('表格列数：普通行按竖线数', () => {
  assert.equal(cellCount('| M4-1 | 预设表 | ✅ |'), 3)
})

test('表格列数：`\\|` 是转义，不当作分隔符', () => {
  assert.equal(cellCount('| a \\| b | c |'), 2)
})

test('表格列数：省略尾竖线的行也要数对', () => {
  assert.equal(cellCount('| a | b'), 2)
})

test('表格单元格还原转义内容', () => {
  assert.deepEqual(cells('| a \\| b | c |'), ['a | b', 'c'])
})
