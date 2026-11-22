// 文档守卫：把「文档与代码漂移」变成 `npm test` 会红的事故。
//
// 为什么：2026-11-14 人工核了两轮才发现 8 处过期（MVU 人物字段映射早退役、人物结构
// 早变 4 格、visibility 三项早隐藏）。靠人记着同步必然会再漂；这里把能机器判定的
// 8 条钉住，剩下的（状态行对不对、描述语义是否过时）仍靠偶尔人工复核。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { collectDocIssues, cellCount, cells, DEFAULT_ROOT } from '../scripts/docsRules.mjs'

const ALLOWLIST_FILE = new URL('./docsGuard.allowlist.json', import.meta.url)

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

// 下面三条守住工具本身：规则写歪（比如正则永远不匹配）会让上面那条测试永远绿，等于没有守卫。
test('表格列数：普通行按竖线数', () => {
  assert.equal(cellCount('| M4-1 | 预设表 | ✅ |'), 3)
})

test('表格列数：`\\|` 是转义，不当作分隔符', () => {
  assert.equal(cellCount('| a \\| b | c |'), 2)
})

test('表格单元格还原转义内容', () => {
  assert.deepEqual(cells('| a \\| b | c |'), ['a | b', 'c'])
})
