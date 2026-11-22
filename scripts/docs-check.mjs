// 开工体检：`npm run docs:check`
//
// 为什么单独做一份而不只是测试：测试是「红了才知道」，而开工前想要的是
// 「一条命令看到底有没有漂，以及多久没人工复核了」。规则与测试共用 docsRules.mjs，
// 所以两处口径永远一致（一份实现，两个出口）。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { collectDocIssues, DEFAULT_ROOT } from './docsRules.mjs'

const allowFile = new URL('../tests/docsGuard.allowlist.json', import.meta.url)
const allowlist = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : {}
const issues = await collectDocIssues({ root: DEFAULT_ROOT, allowlist })

const today = new Date()
const stamp = today.toISOString().slice(0, 10)
console.log(`文档体检（${stamp}）\n`)

if (issues.length === 0) {
  console.log('✓ 8 条机器可判定的规则全部通过：ADR 索引、模块清单、设置键、版本号、状态值、表格形状、路径、符号')
} else {
  for (const item of issues) {
    const where = item.line ? `${item.file}:${item.line}` : item.file
    console.log(`✗ ${where} [${item.rule}] ${item.detail}`)
  }
  console.log(`\n共 ${issues.length} 处不一致——跑 \`npm test\` 会红在 docsGuard.test.mjs`)
}

// 「状态行对不对」「描述语义是否过时」机器判不了，只能靠人偶尔看一眼——
// 所以这里给个天数提醒，别等到下次开工才发现半年没核过。
const designFile = join(DEFAULT_ROOT, 'docs', 'DESIGN.md')
const synced = readFileSync(designFile, 'utf8').match(/最后同步\*\*[：:]\s*(\d{4}-\d{2}-\d{2})/)
if (synced) {
  const days = Math.floor((today.getTime() - new Date(`${synced[1]}T00:00:00`).getTime()) / 86400000)
  const hint = days > 30 ? '（超过 30 天，建议人工复核一遍状态行与语义描述）' : ''
  console.log(`\nℹ 上次人工同步 DESIGN：${synced[1]}，距今 ${days} 天${hint}`)
}

process.exit(issues.length === 0 ? 0 : 1)
