// 把 assets 里三段提示词同步进 plugin/prompt.js 的兜底常量
//
// 为什么要有这个脚本：提示词有两份——运行期真读的 assets/*.txt，
// 和读不到文件时用的兜底常量 prompt.js。两份手抄迟早会飘。
//
// 用法：node scripts/sync-prompt.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const targetPath = fileURLToPath(new URL('plugin/prompt.js', root))

/** 三段：asset 文件 → prompt.js 里的常量名 */
const SEGMENTS = [
  { name: 'PROMPT_TEMPLATE', file: 'plugin/assets/system-prompt.txt' },
  { name: 'WRITE_TEMPLATE', file: 'plugin/assets/write-prompt.txt' },
  { name: 'RECALL_TEMPLATE', file: 'plugin/assets/recall-prompt.txt' },
]

const src = readFileSync(targetPath, 'utf8')
const lines = src.split('\n')

// 用 JSON 字符串而不是模板字符串：提示词里本身带反引号（`char_archives_submit`）
for (const segment of SEGMENTS) {
  const text = readFileSync(fileURLToPath(new URL(segment.file, root)), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/, '')
  const line = `export const ${segment.name} = ${JSON.stringify(text)}`
  // 按行找，不用正则：这一行有几千字符，正则的 `.*` 碰到行分隔符会提前收尾
  const index = lines.findIndex((item) => item.startsWith(`export const ${segment.name} = `))
  if (index < 0) {
    // 常量不存在就追加到文件末尾（第一次对称化时会有这种情况）
    lines.push(line)
  } else {
    lines[index] = line
  }
  console.log(`已同步 ${segment.name} ← ${segment.file}（${text.length} 字）`)
}

writeFileSync(targetPath, lines.join('\n'))
