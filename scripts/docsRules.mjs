// 文档守卫的规则集合：`npm test`（tests/docsGuard.test.mjs）与 `npm run docs:check` 共用一份。
//
// 为什么要有它：文档靠人记着同步，必然会漂移——2026-11-14 人工核了两轮，查出 8 处
// 「文档还停在旧模型」（MVU 人物字段映射早退役、人物结构早变 4 格、visibility 三项早隐藏）。
// 其中大部分是**机器能判**的：模块漏登、设置项已删、版本号没跟上、ADR 索引对不上。
// 这里只放能机器判定的规则；「状态行对不对」「描述语义是否过时」抓不到，仍靠偶尔人工复核。
//
// 设计取舍：规则只圈「模块清单 / 设置表 / 版本号 / ADR 索引 / 表格形状 / 路径与符号」，
// 不做全文语义扫描——全文扫一定会误报满天飞，误报多了守卫就会被关掉，等于没有。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_ROOT = join(HERE, '..')

const FENCE = /^\s*(```|~~~)/
const ADR_INDEX_ROW = /^\|\s*\[(\d{4})\]/

/** 读文件成行数组（保留行号信息，1 基）。 */
function linesOf(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/)
}

/** 逐行产出 `[行号, 文本]`，跳过 ``` / ~~~ 围栏里的内容（那里面的 `|` 与反引号不是文档数据）。 */
function* mdLines(file) {
  let inFence = false
  const lines = linesOf(file)
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]
    if (FENCE.test(text)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    yield [index + 1, text]
  }
}

/** 删掉 ~~删除线~~ 片段：线里的东西是「已删除」的说明，不该当现状校验。 */
function stripStruck(text) {
  return text.replace(/~~[^~]*~~/g, '')
}

/** markdown 表格一行的列数（`\|` 是转义，不算分隔符）。不是表格行返回 0。 */
export function cellCount(row) {
  const trimmed = row.trim()
  if (!trimmed.startsWith('|')) return 0
  const cells = trimmed.replace(/\\\|/g, '\u0000').split('|')
  // 行以 `|` 开头结尾 → 首尾各多一个空串
  return cells.length - 2
}

/** 表格单元格内容（同样处理 `\|` 转义）。 */
export function cells(row) {
  const trimmed = row.trim()
  if (!trimmed.startsWith('|')) return null
  const parts = trimmed.replace(/\\\|/g, '\u0000').split('|')
  return parts.slice(1, -1).map((cell) => cell.replace(/\u0000/g, '|').trim())
}

/** 从一段 markdown 里切出某标题到下一个同级（或更高）标题之间的正文。 */
function sliceByHeading(text, startPattern, endPattern) {
  const start = text.search(startPattern)
  if (start < 0) return ''
  const rest = text.slice(start)
  const end = rest.search(endPattern)
  return end < 0 ? rest : rest.slice(0, end)
}

/** 代码池：`plugin/`、`scripts/`、`tests/` 的所有源码拼在一起，用来判「文档提到的符号是否真的存在」。 */
function codePool(root) {
  const parts = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'assets') continue
        walk(full)
        continue
      }
      if (/\.(m?js|json)$/.test(entry.name)) parts.push(readFileSync(full, 'utf8'))
    }
  }
  walk(join(root, 'plugin'))
  walk(join(root, 'scripts'))
  walk(join(root, 'tests'))
  return parts.join('\n')
}

/** 文档里反引号包的内容。 */
function* backticks(text) {
  const pattern = /`([^`\n]+)`/g
  let match
  while ((match = pattern.exec(text))) yield match[1]
}

function issue(list, file, line, rule, detail) {
  list.push({ file, line, rule, detail })
}

/**
 * 跑完全部规则。
 * @param {{root?:string, allowlist?:object}} options
 * @returns {Array<{file:string,line:number,rule:string,detail:string}>}
 */
export async function collectDocIssues({ root = DEFAULT_ROOT, allowlist = {} } = {}) {
  const problems = []
  const allow = {
    symbols: new Set(allowlist.symbols ?? []),
    paths: new Set(allowlist.paths ?? []),
    settings: new Set(allowlist.settings ?? []),
  }

  const designFile = join(root, 'docs', 'DESIGN.md')
  const roadmapFile = join(root, 'docs', 'ROADMAP.md')
  const readmeFile = join(root, 'README.md')
  const changelogFile = join(root, 'CHANGELOG.md')
  const adrDir = join(root, 'docs', 'adr')
  const adrIndexFile = join(adrDir, 'README.md')

  const designText = readFileSync(designFile, 'utf8')
  const roadmapText = readFileSync(roadmapFile, 'utf8')
  const readmeText = readFileSync(readmeFile, 'utf8')
  const changelogText = readFileSync(changelogFile, 'utf8')
  const pool = codePool(root)

  // ── 规则 1：§十三 模块清单 ↔ plugin/lib 双向对齐 ──
  // 只查一边就会漏：文档写了不存在的文件（删了模块忘改表），代码加了文件忘登表。
  {
    const section = sliceByHeading(designText, /^## 十三、代码模块清单/m, /^## 附录 A/m)
    const sectionLines = section.split(/\r?\n/)
    // 报错要指回 DESIGN 的真实行号，不然读者得自己数
    const startLine = designText.slice(0, designText.search(/^## 十三、代码模块清单/m)).split(/\r?\n/).length
    const listed = new Map() // 文件名 → 行号
    sectionLines.forEach((raw, index) => {
      const text = stripStruck(raw)
      for (const match of text.matchAll(/`([A-Za-z0-9_-]+\.js)`/g)) {
        if (!listed.has(match[1])) listed.set(match[1], startLine + index)
      }
    })
    const libDir = join(root, 'plugin', 'lib')
    const libFiles = existsSync(libDir)
      ? readdirSync(libDir).filter((name) => name.endsWith('.js'))
      : []
    for (const name of listed.keys()) {
      const candidates = [
        join(libDir, name),
        join(root, 'plugin', name),
        join(root, 'scripts', name),
        join(root, 'tests', name),
      ]
      if (!candidates.some((path) => existsSync(path)) && !allow.paths.has(name)) {
        issue(problems, 'docs/DESIGN.md', listed.get(name), 'module-missing', `§十三 列了 \`${name}\`，但文件不存在`)
      }
    }
    for (const name of libFiles) {
      if (!listed.has(name) && !allow.paths.has(name)) {
        issue(problems, 'plugin/lib', 0, 'module-unlisted', `\`${name}\` 没有登进 §十三 模块清单`)
      }
    }
  }

  // ── 规则 2：DESIGN 里的 `组.键` 必须真在 DEFAULT_SETTINGS 里 ──
  // 只检查「组名认得」的：`data.debug.enabled` 这种讲历史的引用不该被误抓。
  {
    const { DEFAULT_SETTINGS } = await import(pathToFileURL(join(root, 'plugin', 'lib', 'settings.js')).href)
    const groups = Object.keys(DEFAULT_SETTINGS)
    const keyPattern = new RegExp(`\\b(${groups.join('|')})\\.([A-Za-z][A-Za-z0-9]*)`, 'g')
    // `lib/draft.js`、`lib/names.js` 会被上一条正则读成「组 draft 的键 js」——扩展名不是设置键
    const EXTENSIONS = new Set(['js', 'mjs', 'json', 'md', 'txt', 'test', 'ts'])
    for (const [lineNo, raw] of mdLines(designFile)) {
      const text = stripStruck(raw)
      for (const match of text.matchAll(keyPattern)) {
        const [, group, key] = match
        if (EXTENSIONS.has(key)) continue
        const token = `${group}.${key}`
        if (allow.settings.has(token)) continue
        if (!(key in (DEFAULT_SETTINGS[group] ?? {}))) {
          issue(problems, 'docs/DESIGN.md', lineNo, 'setting-missing', `\`${token}\` 在 settings.js 里不存在`)
        }
      }
    }
  }

  // ── 规则 3：ADR 文件数 ↔ 索引行数 ──
  {
    const files = existsSync(adrDir)
      ? readdirSync(adrDir).filter((name) => name.endsWith('.md') && name !== 'README.md')
      : []
    const rows = linesOf(adrIndexFile).filter((line) => ADR_INDEX_ROW.test(line))
    if (files.length !== rows.length) {
      issue(problems, 'docs/adr/README.md', 0, 'adr-index', `ADR 文件 ${files.length} 个，索引 ${rows.length} 行`)
    }
  }

  // ── 规则 4：版本号三处一致（plugin/package.json ↔ README ↔ 根 CHANGELOG 最新段） ──
  {
    const pkg = JSON.parse(readFileSync(join(root, 'plugin', 'package.json'), 'utf8'))
    const version = String(pkg.version ?? '')
    const readmeMatch = readmeText.match(/版本\s*`([0-9]+\.[0-9]+\.[0-9]+)`/)
    const changelogMatch = changelogText.match(/^##\s*\[([0-9]+\.[0-9]+\.[0-9]+)\]/m)
    if (readmeMatch && readmeMatch[1] !== version) {
      issue(problems, 'README.md', 0, 'version', `README 写 ${readmeMatch[1]}，plugin/package.json 是 ${version}`)
    }
    if (changelogMatch && changelogMatch[1] !== version) {
      issue(problems, 'CHANGELOG.md', 0, 'version', `根 CHANGELOG 最新段 ${changelogMatch[1]}，plugin/package.json 是 ${version}`)
    }
  }

  // ── 规则 5：ROADMAP 功能条目的状态只能是五种之一 ──
  {
    const allowed = ['✅', '🚧', '⬜', '⏸', '❌']
    for (const [lineNo, raw] of mdLines(roadmapFile)) {
      const row = cells(raw)
      if (!row || !/^(M\d+|P\d+|B\d+)$/.test(row[0])) continue
      const status = row[2] ?? ''
      if (!allowed.some((mark) => status.startsWith(mark))) {
        issue(problems, 'docs/ROADMAP.md', lineNo, 'roadmap-status', `${row[0]} 的状态「${status}」不是五种之一`)
      }
    }
  }

  // ── 规则 6：markdown 表格形状（每行列数一致） ──
  // 表格错位不会报错，只会渲染成断掉的一大段——2026-11-05 DESIGN §7.10.3 就断过。
  for (const file of [designFile, roadmapFile, readmeFile, changelogFile, adrIndexFile]) {
    let header = null
    for (const [lineNo, raw] of mdLines(file)) {
      const count = cellCount(raw)
      if (count === 0) {
        header = null
        continue
      }
      if (header === null) {
        header = { count, line: lineNo }
        continue
      }
      if (count !== header.count) {
        const rel = file.slice(root.length + 1).replace(/\\/g, '/')
        issue(problems, rel, lineNo, 'table-columns', `这行 ${count} 列，表头（第 ${header.line} 行）${header.count} 列`)
      }
    }
  }

  // ── 规则 7：DESIGN 反引号里的代码符号必须真存在 ──
  // 只认「小写开头 + 至少 8 个字符 + 含大写字母」：`publishState`／`SNAPSHOT_VERSION` 这类，
  // 通用词（git／npm／json）与全小写文件名都放过，避免误报。
  {
    const symbol = /^[a-z][A-Za-z0-9]{7,}$/
    for (const [lineNo, raw] of mdLines(designFile)) {
      const text = stripStruck(raw)
      for (const token of backticks(text)) {
        if (!symbol.test(token)) continue
        if (!/[A-Z]/.test(token)) continue
        if (allow.symbols.has(token)) continue
        if (!pool.includes(token)) {
          issue(problems, 'docs/DESIGN.md', lineNo, 'symbol-missing', `\`${token}\` 在代码里搜不到`)
        }
      }
    }
  }

  // ── 规则 8：反引号里的仓库内路径必须存在 ──
  {
    const repoPath = /^(?:plugin\/|scripts\/|tests\/|docs\/|assets\/|lib\/|\.github\/)[\w./-]+\.(?:m?js|json|txt|md|ya?ml)$/
    for (const [file, rel] of [[designFile, 'docs/DESIGN.md'], [roadmapFile, 'docs/ROADMAP.md']]) {
      for (const [lineNo, raw] of mdLines(file)) {
        const text = stripStruck(raw)
        for (const token of backticks(text)) {
          if (!repoPath.test(token)) continue
          if (allow.paths.has(token)) continue
          const candidates = [join(root, token), join(root, 'plugin', token)]
          if (!candidates.some((path) => existsSync(path))) {
            issue(problems, rel, lineNo, 'path-missing', `\`${token}\` 不存在`)
          }
        }
      }
    }
  }

  return problems.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)))
}
