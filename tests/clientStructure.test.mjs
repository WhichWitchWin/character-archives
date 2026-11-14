// 守卫：客户端面板的几个关键结构不能被改丢。
//
// 背景：有一次从已装副本恢复 client.js，把「设置页三段折叠」的逻辑一起弄丢了，
// 而且**没被发现**（页面照常渲染，只是点不开）。这类"少了一块"的回归最难查，
// 所以在这里用静态检查钉住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const client = readFileSync(fileURLToPath(new URL('../plugin/client.js', import.meta.url)), 'utf8')

// 只盯某一段源码：整份文件里「别处也有这几个字」太容易误判，
// 比如「查人物」在注释里也出现过，得按组件切开来断言。
function sliceBetween(source, from, to) {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `找不到起点：${from}`)
  const end = source.indexOf(to, start + from.length)
  assert.ok(end > start, `找不到终点：${to}`)
  return source.slice(start, end)
}

test('设置页有三段折叠：openSections 状态 + 按 section.scope 渲染', () => {
  assert.match(client, /const \[openSections, setOpenSections\] = useState/, '少了 openSections 状态')
  assert.match(client, /list\.map\(\(section\) =>/, '设置页没有按段渲染')
  assert.match(client, /section\.scope/, '没有用 scope 当 key / 过滤')
  assert.match(client, /const toggleSection = \(scope\) =>/, '没有 toggleSection')
  assert.match(client, /onClick: \(\) => toggleSection\(section\.scope\)/, '段标题点了没反应')
  assert.match(client, /set-ui/, '折叠状态没有存盘')
})

test('面板里几个主要视图都在（别被恢复操作弄丢）', () => {
  for (const name of ['ArchivePanel', 'SettingsView', 'PromptView', 'PresetView', 'DataLocations', 'DeletedView', 'DebugSection', 'DebugView']) {
    assert.ok(client.includes(`function ${name}`), `少了 ${name}`)
  }
})

test('四个标签页都在（已删除是从工具栏按钮进的，不是标签页）', () => {
  for (const key of ['archive', 'settings', 'prompts', 'presets']) {
    assert.ok(client.includes(`tab('${key}'`), `少了 ${key} 标签页`)
  }
})

test('删除按钮、已删除入口、单字名标记都在', () => {
  assert.match(client, /delete-person/, '少了删除人物')
  assert.match(client, /已删除/, '少了已删除入口')
  assert.match(client, /singleCharName/, '少了单字名标记')
})

test('调试窗口的折叠还在（每条日志默认收起）', () => {
  assert.match(client, /function DebugRow/, '少了 DebugRow')
  assert.match(client, /function TurnGroup/, '少了按轮次分组的 TurnGroup')
})

// 守卫：数值输入框必须自己拦字符、自己夹紧。
// 以前用 type="number"：浏览器允许键入 e/+/-/.，清空后 value 变成空串，
// 而 Number('') 是 0 → 清空一次就把设置改成了 0。
test('数值输入框：键入时过滤字符，失焦时夹紧并回显', () => {
  assert.ok(!client.includes("type: 'number'"), '数值框不该用 type=number（浏览器拦不住 e/+/-/.）')
  assert.match(client, /inputMode: 'numeric'/, '数值框要 inputMode: numeric（手机上仍弹数字键盘）')
  assert.match(client, /onInput:/, '数值框要有 onInput 过滤字符')
  assert.match(client, /parseNumberInput/, '夹紧要复用 parseNumberInput（前后端同一把尺子）')
})

test('数值输入的格式规则：前端副本与 lib 那份必须是同一个正则', () => {
  const lib = readFileSync(fileURLToPath(new URL('../plugin/lib/settingsView.js', import.meta.url)), 'utf8')
  const pattern = String.raw`/^-?\d+(?:\.\d+)?$/u`
  assert.ok(lib.includes(pattern), 'lib 里找不到数值格式正则')
  assert.ok(client.includes(pattern), 'client 里找不到数值格式正则——两份规则分叉了')
})

// 守卫：历史快照预览（下拉选轮次 + 只读预览那一轮）。
test('历史快照预览：下拉、文案拼装、只读预览都在', () => {
  assert.ok(client.includes('function SnapshotPicker'), '少了 SnapshotPicker')
  assert.ok(client.includes('function SnapshotPreview'), '少了 SnapshotPreview')
  assert.ok(client.includes('function snapshotLabel'), '少了文案拼装 snapshotLabel')
  // 文案改成玩家话：第N轮 · 时间 · 地点。轮次必须在最前，时间/地点缺哪段就少哪段。
  const label = sliceBetween(client, 'function snapshotLabel', 'function SnapshotPicker')
  assert.ok(label.includes('`第${item?.turn ?? 0}轮`'), '玩家话文案要能拼出「第N轮」，不能只剩一大串字段名')
  assert.ok(label.includes("join(' · ')"), '各段之间要用「 · 」分隔（原来那根竖线太像程序日志）')
  assert.ok(!label.includes("join('|')"), '拼竖线的老写法必须清掉，否则下拉里还是 gt|loc|轮次')
  assert.match(client, /maxHeight: 5 \* 26/, '下拉最多显示 5 条')
  assert.match(client, /snapshot-at/, '要调预览接口')
  assert.match(client, /snapshot-list/, '要调轮次列表接口')
})

// 守卫：预设页要能「按卡保存」和「回到全局」（2026-11-05）。
test('预设页：按卡保存 / 回到全局按钮都在', () => {
  assert.match(client, /按卡保存/, '少了「按卡保存」按钮')
  assert.match(client, /回到全局/, '少了「回到全局」按钮')
})

// 守卫：提示词页要显示只读的动态上下文（本局视角/称呼/栏目定义）。
test('提示词页：动态上下文只读展示', () => {
  assert.match(client, /动态上下文（只读）/, '少了只读上下文标题')
  assert.match(client, /state\.data\.contextText/, '要显示 contextText')
})

// ── 2026-11 面板瘦身（用户要求：设置页/提示词页太长，翻不到底） ──

// 设置页九组平铺一屏根本翻不完，改成一组一行的手风琴。
// 这里钉住三件事：折叠状态在组件里、默认只开两组（最常动的）、组标题真的能点。
test('设置页：每组可折叠，默认只展开「档案写入方式」和「召回」', () => {
  const view = sliceBetween(client, 'function SettingsView', '// 动作类型 → 颜色')
  assert.match(view, /const \[openGroups, setOpenGroups\] = useState/, '少了每组的折叠状态')
  assert.ok(
    view.includes("const DEFAULT_OPEN_GROUPS = ['档案写入方式', '召回']"),
    '默认展开集合必须正好是「档案写入方式」和「召回」这两组',
  )
  assert.match(view, /new Set\(DEFAULT_OPEN_GROUPS\)/, '折叠状态要从默认集合起手')
  assert.match(view, /const toggleGroup = \(title\) =>/, '少了切换某一组的函数')
  assert.match(view, /onClick: \(\) => toggleGroup\(group\.title\)/, '组标题点了没反应')
  assert.match(view, /openGroups\.has\(group\.title\)/, '没有按展开状态决定画不画组里的项')
})

// 提示词页三块大 textarea 竖排太深，改成三张可折叠卡片。
// **顶部「生效边界」那段说明必须常显**——它讲的是"什么时候生效"，藏起来就等于没写。
test('提示词页：三张卡片可折叠，顶部说明常显在折叠之外', () => {
  const view = sliceBetween(client, 'function PromptView', 'function DebugView')
  assert.match(view, /const \[openCards, setOpenCards\] = useState\(\{ system: true \}\)/, '默认只该展开「系统提示词」')
  assert.match(view, /const toggleCard = \(key\) =>/, '少了切换某张卡片的函数')
  // 说明必须在卡片列表之前，而且这段源码里不许再出现 openCards ——否则说明就被卷进折叠里了
  const head = view.slice(0, view.indexOf('rows.map('))
  assert.ok(head.includes('这一页就是模型真正拿到的那份'), '顶部「生效边界」说明不能挪走')
  assert.equal((head.match(/\bopenCards\b/gu) ?? []).length, 1, '顶部说明被折叠状态包住了（只剩 useState 那一处才对）')
  // 行为不能顺手改掉：离开输入框即保存、恢复默认按钮
  assert.ok(view.includes('onBlur:'), '离开输入框即保存的行为丢了')
  assert.ok(view.includes('恢复默认'), '恢复默认按钮丢了')
})

// 「数据位置」里 trash／快照／插件数据这些词是开发者话，玩家看不懂。
// 「立即清理」是不可恢复操作，必须先问一句——点错一次的代价是数据没了。
test('数据位置：说人话，且「立即清理」要先 confirm 二次确认', () => {
  const view = sliceBetween(client, 'function DataLocations', '// 预设表')
  assert.match(view, /历史存档（回退时用）/, '快照要说成「历史存档（回退时用）」')
  assert.match(view, /废文件（自动清）/, 'trash 要说成「废文件（自动清）」')
  assert.match(view, /插件自己的文件夹/, '插件数据目录要说成「插件自己的文件夹」')
  const emptyStart = view.indexOf('const emptyTrash = async () =>')
  assert.ok(emptyStart > 0, '少了清理入口')
  const empty = view.slice(emptyStart, view.indexOf('return h(', emptyStart))
  assert.match(empty, /window\.confirm\(/, '「立即清理」必须先弹 confirm')
  assert.match(empty, /不能恢复/, '确认文案要说清删了不能恢复')
  // 接口名/参数一个字都不能变（宿主那边没动）
  assert.ok(view.includes('`${PLUGIN}/empty-trash`, {}'), 'empty-trash 的调用方式被改了')
  assert.ok(view.includes('`${PLUGIN}/open-folder`, { target: key }'), 'open-folder 的调用方式被改了')
})

// 查询条原来一排四个按钮（查认知／查人物／召回／搜内容），前三个语义重叠。
// 合成「一个输入框 + 类型选择 + 搜索」，召回是注入动作、留着并单独说明。
test('查询条：合并成类型选择，不再有三个重叠的搜索按钮', () => {
  const box = sliceBetween(client, 'function QueryBox', 'function Group')
  for (const gone of ['查人物', '查认知', '搜内容']) {
    assert.ok(!box.includes(gone), `「${gone}」按钮该合并掉，不能再单独出现`)
  }
  for (const label of ["'人物'", "'认知'", "'内容'"]) {
    assert.ok(box.includes(label), `少了类型选项 ${label}`)
  }
  assert.ok(box.includes("'search'") || box.includes('搜索'), '少了统一的「搜索」按钮')
  // 三个搜索入口的接口名一个都不许变
  assert.ok(box.includes('`${PLUGIN}/find-person`, { gameId, name: wanted }'), '人物搜索没走 find-person')
  assert.ok(box.includes('`${PLUGIN}/lookup-person`, { gameId, name: wanted }'), '认知查询没走 lookup-person')
  assert.ok(box.includes('`${PLUGIN}/search-claims`, { gameId, keyword: wanted }'), '内容搜索没走 search-claims')
  // 召回是注入动作（会改下一轮正文），不是搜索，必须还在
  assert.ok(box.includes('`${PLUGIN}/recall-person`, { gameId, name: wanted }'), '召回按钮被顺手删了')
  assert.match(box, /title: '[^']*召回/, '召回按钮要有一句 title 说清它做什么')
})

// 守卫：颜色走酒馆主题变量。写死颜色在浅色/花色主题上会糊成一片。
test('主题色：抽了语义色常量 ui，样式里不再写死那几档灰和红', () => {
  const found = client.match(/const ui = \{[\s\S]*?\n    \}\r?\n/u)
  assert.ok(found, '少了语义色常量 ui（要放在文件顶部）')
  assert.ok(client.includes('var(--SmartTheme'), '一处主题变量都没用上')
  // 兜底值留在 ui 里就行，别处不许再出现这些具体值——否则就是没抽干净
  const outside = client.replace(found[0], '')
  for (const literal of ['rgba(120,120,140', 'rgba(120,120,130', 'rgba(90,90,105', '#c0392b']) {
    assert.ok(!outside.includes(literal), `${literal} 还写死在样式里，没换成 ui 常量`)
  }
})

// 守卫：字号跟酒馆走。写死像素 → 玩家调大酒馆字号，面板还是小字。
// 做法是 em（相对宿主继承下来的字号）+ 表单控件显式继承（浏览器默认不让 input 继承）。
test('字号：抽了以宿主字号为基准的阶梯 font，不再写死像素字号', () => {
  const found = client.match(/const font = (?:Object\.freeze\()?\{[\s\S]*?\n    \}\)?\r?\n/u)
  assert.ok(found, '少了字号阶梯 font（要放在文件顶部）')
  // 必须是「基准 × 倍数」而不是裸 em：裸 em 会跟父元素叠乘，嵌套一深就越改越小
  assert.ok(found[0].includes('calc(var(--ca-base'), '字号要按 --ca-base 的倍数算')
  assert.ok(!/font\.\w+: '\d*\.?\d+em'/u.test(found[0]), '不要裸 em（会叠乘）')
  const px = client.match(/fontSize: \d+/gu)
  assert.equal(px, null, `还有写死的像素字号：${px ? px.slice(0, 5).join('、') : ''}`)
  assert.ok(client.includes("setProperty('--ca-base'"), '要把宿主实际字号量出来写到 --ca-base')
})

// 守卫：hook 必须排在标签页分支之前。
// 踩过的坑（React #300 "Rendered more hooks than during the previous render"）：
// 把新的 useEffect 写在 `if (view === 'prompts') return …` 之后，切标签页时
// 有的分支跑了 hook、有的没跑，hook 数量对不上，整个面板当场崩掉。
test('面板：所有顶层 hook 都排在标签页分支之前', () => {
  const panel = client.slice(client.indexOf('function ArchivePanel('))
  const firstBranch = panel.indexOf("if (view === 'deleted')")
  assert.notEqual(firstBranch, -1, '找不到标签页分支，守卫失效了')
  for (const hook of ["useState('archive')", 'useFitHeight()', "setProperty('--ca-base'", 'FONT_STYLE_ID']) {
    const at = panel.indexOf(hook)
    assert.notEqual(at, -1, `找不到 ${hook}，守卫要更新`)
    assert.ok(at < firstBranch, `${hook} 排在了标签页分支之后——切标签页会崩（React #300）`)
  }
})

test('字体：面板继承宿主字体，表单控件单独补继承', () => {
  assert.ok(/panelRoot = \{[\s\S]{0,400}fontFamily: 'inherit'/.test(client), 'panelRoot 要继承宿主字体')
  assert.ok(client.includes('ca-panel'), '根节点要有 ca-panel 类名给样式勾住')
  assert.ok(
    /\.ca-panel (?:input|textarea)[^{]*\{[^}]*font-family: ?inherit/u.test(client),
    '表控件不继承字体，必须显式写一条 font-family: inherit',
  )
})

// ── 2026-11 窄面板适配 / 扫读优化 / 变化可见 ──

// 组件里的 hook 必须排在**任何 return 之前**。
// 这条比 ArchivePanel 那条更狠：DetailBlock / WordsChip 里都是按条数 map 出子块的，
// hook 一旦跟着条数走（有的分支调、有的不调），React 直接抛 #300，整个面板当场白屏。
function firstReturnIndex(source) {
  const at = source.indexOf('return ')
  assert.notEqual(at, -1, '这段源码里找不到 return，守卫失效了')
  return at
}

function assertHooksBeforeReturns(source, hooks, label) {
  const ret = firstReturnIndex(source)
  for (const hook of hooks) {
    const at = source.indexOf(hook)
    assert.notEqual(at, -1, `${label} 里找不到 ${hook}，守卫要更新`)
    assert.ok(at < ret, `${label} 的 ${hook} 排在了第一个 return 之后——hook 顺序会跟着数据变，React #300 当场崩`)
  }
}

test('窄面板：两块的外层能换行，每块给 240px 最小宽度（纯 CSS，不量宽度）', () => {
  const view = sliceBetween(client, 'function FoldHeader', '// 模糊建档候选')
  assert.match(view, /flexWrap: 'wrap'/, '两块的外层要能换行，否则窄侧栏会挤成两条缝')
  const flexed = view.match(/flex: '1 1 240px'/gu) ?? []
  assert.equal(flexed.length, 2, `两块都要 flex: '1 1 240px'，实际找到 ${flexed.length} 处`)
  assert.ok(!view.includes('clientWidth'), '不许用 JS 量宽度（量宽度要监听 resize，还会抖）')
})

test('窄面板：两块可折叠，标题行带 ▸/▾ 和条数，默认展开', () => {
  const view = sliceBetween(client, 'function FoldHeader', '// 模糊建档候选')
  assert.ok(view.includes('function FoldHeader'), '少了可折叠小标题 FoldHeader')
  assert.match(view, /open \? '▾' : '▸'/, '标题行要有 ▸/▾')
  assert.ok(view.includes('· ${count} 条'), '标题要写「标题 · N 条」')
  assert.match(view, /const \[openAbout, setOpenAbout\] = useState\(true\)/, '「他是什么样」默认展开')
  assert.match(view, /const \[openCognitions, setOpenCognitions\] = useState\(true\)/, '「他的认知」默认展开')
  // 收起时只留标题行：两块的内容都要挂在 open 判断后面
  assert.match(view, /openAbout\s*\?\s*[\s\S]{0,40}row\.aboutColumns\.map/, '收起时不该还画「他是什么样」的栏目')
  assert.match(view, /openCognitions\s*\?\s*[\s\S]{0,40}row\.cognitionColumns\.map/, '收起时不该还画「他的认知」的栏目')
  // hook 要在任何 return 之前
  const detail = view.slice(view.indexOf('function DetailBlock'))
  assertHooksBeforeReturns(detail, ['const [openAbout, setOpenAbout]', 'const [openColumns, setOpenColumns]'], 'DetailBlock')
})

test('窄面板：一栏超过 6 条先只给前 6 条，剩下的点开', () => {
  const view = sliceBetween(client, 'function FoldHeader', '// 模糊建档候选')
  assert.ok(client.includes('COLUMN_LIMIT = 6'), '阈值要写成一个常量 6')
  assert.ok(view.includes('还有 ${'), '要有「还有 N 条」的入口')
  assert.ok(view.includes('（点开）'), '要写清点开才能看全')
  // 两块都得用上，不能只管「他是什么样」；另外多选/Shift 连选会再用两次（算「看得见的行」）
  const used = view.match(/shownItems\(/gu) ?? []
  assert.ok(used.length >= 3, `shownItems 要有定义 + 两块各用一次，实际 ${used.length} 处`)
})

// 2026-11 改回常显：以前把改名／锁／眼睛／删除收进「⋯」，玩家得点两下才看得见；
// 现在四个按钮直接摆出来，连「⋯」的展开状态一起删掉。
test('PersonRow：改名／锁／眼睛／删除常显，不再有「⋯」折叠', () => {
  const row = sliceBetween(client, 'function PersonRow', '档案操作条')
  assert.ok(!row.includes('moreOpen'), '「⋯」的展开状态要一并删掉')
  assert.ok(!row.includes("'⋯'"), '「⋯」入口要摘掉')
  for (const hook of ["toggle('lock')", "toggle('hidden')", 'delete-person']) {
    assert.ok(row.includes(hook), `少了 ${hook}`)
  }
  assert.ok(row.includes('改姓名'), '改名入口丢了')
  // hook 顺序守卫不能跟着删：这行还有 4 个 state，位置错了照样 React #300
  assertHooksBeforeReturns(row, ['const [open, setOpen]', 'const [editingName, setEditingName]'], 'PersonRow')
})

// 名字后面紧跟「主角」徽章和 ★，然后才是状态 chip / 操作按钮。
// 以前 ★ 排在状态 chip 之后，一眼看过去像是"操作按钮那一串"里的一个。
test('PersonRow：名字后面紧跟主角徽章与 ★，在状态 chip 之前', () => {
  const row = sliceBetween(client, 'function PersonRow', '档案操作条')
  const nameAt = row.indexOf('row.name ||')
  const badgeAt = row.indexOf("'主角',")
  const starAt = row.indexOf("row.starred ? '★' : '☆'")
  const chipAt = row.indexOf("'点击切换在场／离场'")
  assert.ok(nameAt >= 0, '找不到名字节点')
  assert.ok(badgeAt >= 0, '找不到主角徽章')
  assert.ok(starAt >= 0, '找不到 ★')
  assert.ok(chipAt >= 0, '找不到状态 chip')
  assert.ok(badgeAt > nameAt, '主角徽章要排在名字之后')
  assert.ok(starAt > nameAt, '★ 要排在名字之后')
  assert.ok(starAt < chipAt, '★ 要挪到状态 chip 之前（紧跟名字），不能留在按钮那一串里')
})

// 删除键：命题行删的是**整条命题**（连指针一起），认知行删的是**这条认知**（只摘指针）。
// 两个动作杀伤力完全不同，所以文案要说清，且都要先 confirm。
test('DetailBlock：命题行与认知行各有删除键，都带 confirm', () => {
  const detail = sliceBetween(client, 'function DetailBlock', 'function DraftBlock')
  assert.ok(detail.includes('删除这条命题（会一起删掉谁知道它）'), '命题行少了删除键的 title')
  assert.ok(detail.includes('删除这条认知（只删"谁知道"，不删命题本身）'), '认知行少了删除键的 title')

  const claimAt = detail.indexOf("'delete-claim'")
  assert.ok(claimAt >= 0, '少了 delete-claim 调用')
  assert.ok(detail.slice(Math.max(0, claimAt - 600), claimAt).includes('window.confirm('), '删命题要先 confirm')
  assert.ok(detail.slice(claimAt, claimAt + 200).includes('claimId: claim.claimId'), '删命题要传这条命题的 id')

  const cogAt = detail.indexOf("'delete-cognition'")
  assert.ok(cogAt >= 0, '少了 delete-cognition 调用')
  assert.ok(detail.slice(Math.max(0, cogAt - 600), cogAt).includes('window.confirm('), '删认知要先 confirm')
  const cogCall = detail.slice(cogAt, cogAt + 200)
  assert.ok(cogCall.includes('personId: row.id'), '删的是「当前行这个人」的认知')
  assert.ok(cogCall.includes('claimId: cog.claimId'), '删的是这一条认知')
})

// 眼睛：不用 emoji（各家字体画出来大小不一、还会被当成表情撑高行），改成跟着字号走的内联 SVG。
test('隐藏按钮：换成内联 SVG 的眼睛划掉，不再用 emoji', () => {
  assert.ok(!client.includes('🙈'), '🙈 要换成画出来的图标')
  assert.ok(!client.includes('👁'), '👁 也要换掉')
  assert.ok(client.includes('function EyeOffIcon'), '少了划掉的眼睛')
  assert.ok(client.includes('function EyeIcon'), '少了正常眼睛')

  // 底板抽成 ICON_SVG 后所有图标共用（2026-11-06 起 emoji 全换 SVG）
  const icons = sliceBetween(client, 'const ICON_SVG', 'function DetailBlock')
  assert.ok(icons.includes("stroke: 'currentColor'"), '描边要跟文字颜色走')
  assert.ok(icons.includes("width: '1em'") && icons.includes("height: '1em'"), '尺寸要跟字号走（1em）')

  const row = sliceBetween(client, 'function PersonRow', '档案操作条')
  assert.ok(row.includes('h(EyeOffIcon'), '隐藏时要用划掉的眼睛')
  assert.ok(row.includes('h(EyeIcon'), '显示时要用正常的眼睛')
  assert.ok(row.includes('对模型隐藏'), 'title 要说清「对模型隐藏」')
})

test('索引词默认收起：有词才给「索引词 N」，点开才看见 chip 和 ✎', () => {
  const chipView = sliceBetween(client, 'function WordsChip', '查询条')
  assert.match(chipView, /const \[open, setOpen\] = useState\(false\)/, '索引词默认要收起')
  assert.ok(chipView.includes('索引词 ${'), '要有「索引词 N」开关')
  assert.ok(chipView.includes('✎'), '编辑入口还要能点到')
  // chip 只能画在展开之后
  assert.match(chipView, /open \? list\.map/, 'chip 只在展开时画')
  assertHooksBeforeReturns(chipView, ['const [open, setOpen]'], 'WordsChip')
})

test('Group 标题：带人数，本轮有变化时说「本轮 N 处变化」', () => {
  const group = sliceBetween(client, 'function Group', '数值输入的字符限制')
  assert.ok(group.includes('${title} · ${rows.length}'), '标题要写「在场 · 7」这种人数')
  assert.ok(group.includes('处变化'), '少了「本轮 N 处变化」')
  assert.ok(group.includes('changedThisTurn'), '人数要按 changedThisTurn 数出来')
  // 分组的折叠/拖放行为不许顺手改
  assert.ok(group.includes('onDragOver'), '拖放还在')
  assert.ok(group.includes('setOpen((value) => !value)'), '折叠还在')
})

test('变化可见：人物行有「本轮有变化」的小圆点（走主题色）', () => {
  const row = sliceBetween(client, 'function PersonRow', '档案操作条')
  assert.ok(row.includes('本轮有变化'), '小圆点要有 title 说清它是什么')
  assert.ok(row.includes('changedThisTurn'), '圆点要按 changedThisTurn 显示')
  assert.match(row, /borderRadius: '50%'/, '得是个圆点，不是方块')
  assert.ok(row.includes('ui.accent'), '圆点颜色要走 ui 里的语义色，别在组件里写死颜色')
})

test('图标：操作按钮一律内联 SVG，不用 emoji', () => {
  // emoji 在不同系统/主题下长得不一样（有的还是彩色方块），而这些是操作按钮，
  // 应该跟旁边的字同色同大小、跟着字号缩放。眼睛先换了，剩下几个一起换掉。
  for (const emoji of ['🙈', '👁', '🗑', '✏', '🔒', '🔓']) {
    assert.ok(!client.includes(emoji), `还剩 emoji ${emoji}，应换成内联 SVG`)
  }
  for (const icon of ['EyeIcon', 'EyeOffIcon', 'TrashIcon', 'PencilIcon', 'LockIcon']) {
    assert.ok(new RegExp(`function ${icon}\\(`).test(client), `缺少图标组件 ${icon}`)
  }
  // 图标底板只抽一次（D8）：不许每个图标各抄一份 width/height/viewBox
  assert.equal((client.match(/viewBox: '0 0 24 24'/gu) ?? []).length, 1, '图标底板应只定义一次')
})

// 拖拽只在人物行的标题行生效（2026-11-06 用户反馈）：
// 整行可拖会让展开后在正文里选中文字也变成拖动人物。
test('拖拽：人物行只有标题行可拖，根容器不再 draggable', () => {
  const at = client.indexOf('function PersonRow(')
  assert.ok(at >= 0, '找不到 PersonRow')
  const block = client.slice(at, at + 4000)
  const rootStart = block.indexOf('ref: nodeRef')
  assert.ok(rootStart >= 0, '找不到根容器')
  const between = block.slice(rootStart, block.indexOf('draggable: true'))
  assert.ok(!between.includes('ref: nodeRef, draggable'), '根容器不该自己 draggable')
  assert.ok(between.length > 40, 'draggable 应该挂在里面的标题行，不是根容器')
  assert.ok(block.includes("cursor: 'grab'"), '标题行要给出可拖的视觉提示')
})
