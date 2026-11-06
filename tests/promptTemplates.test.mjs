// 三段可编辑的提示词：系统、写入、召回（注入正文）
//
// 为什么让玩家改：这三段是"我们怎么跟模型说话"，措辞直接影响模型行为；
// 不同人/不同卡都想调，写死在代码里只能等我们发版。
//
// 存在**整局数据**（跟卡无关）：它是交流方式，不随卡变。
// 空字符串 = 用默认（这样随时能"恢复默认"，不用记住原文）。
//
// 占位符用 `{{NAME}}`；填模板时**只替换已知的键**，未知的保持原样（方便以后加变量）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_TEMPLATES,
  PLACEHOLDERS,
  fillTemplate,
  resolveTemplates,
} from '../plugin/lib/promptTemplates.js'

/** 运行期那份系统提示词（新增守卫都对着它写，不再各读各的）。 */
const systemText = () => readFileSync(fileURLToPath(new URL('../plugin/assets/system-prompt.txt', import.meta.url)), 'utf8')

test('写入/召回有默认模板，占位符齐全（系统那段由调用方注入）', () => {
  assert.deepEqual(Object.keys(DEFAULT_TEMPLATES).sort(), ['recall', 'system', 'write'])
  assert.ok(DEFAULT_TEMPLATES.write.includes('{{GT}}'))
  assert.ok(DEFAULT_TEMPLATES.write.includes('{{PEOPLE}}'))
  assert.ok(DEFAULT_TEMPLATES.recall.includes('{{VIEWPOINT}}'))
  assert.ok(DEFAULT_TEMPLATES.recall.includes('{{STAMP}}'))
  assert.ok(DEFAULT_TEMPLATES.recall.includes('{{BLOCKS}}'))
})

test('PLACEHOLDERS 列出每段能用的占位符（给界面做提示）', () => {
  // 冻结数组不能原地 sort，复制一份再比
  assert.deepEqual([...PLACEHOLDERS.system].sort(), ['ENTRIES', 'PERSON', 'PLAYER'])
  assert.deepEqual([...PLACEHOLDERS.write].sort(), ['GT', 'PEOPLE'])
  assert.deepEqual([...PLACEHOLDERS.recall].sort(), ['BLOCKS', 'GT', 'LOC', 'STAMP', 'VIEWPOINT'])
})

test('填模板：替换已知占位符，未知的原样保留', () => {
  const out = fillTemplate('A {{GT}} B {{UNKNOWN}}', { GT: '永安三年' })
  assert.equal(out, 'A 永安三年 B {{UNKNOWN}}')
})

test('填模板：值里带 $ 不会被当成替换模式（不用 replace 的特殊语法坑）', () => {
  const out = fillTemplate('{{TEXT}}', { TEXT: '价格 $& $1 $` 都要原样' })
  assert.equal(out, '价格 $& $1 $` 都要原样')
})

test('读取：没存过就用默认；空串也算没存', () => {
  assert.deepEqual(resolveTemplates(null), DEFAULT_TEMPLATES)
  const mixed = resolveTemplates({ system: '', write: '我的写入 {{GT}}', recall: undefined })
  assert.equal(mixed.system, DEFAULT_TEMPLATES.system, '空串回落默认')
  assert.equal(mixed.write, '我的写入 {{GT}}')
  assert.equal(mixed.recall, DEFAULT_TEMPLATES.recall, '缺失回落默认')
})

test('读取：非字符串的脏值也回落默认', () => {
  const out = resolveTemplates({ system: 123, write: { a: 1 }, recall: [] })
  assert.equal(out.system, DEFAULT_TEMPLATES.system)
  assert.equal(out.write, DEFAULT_TEMPLATES.write)
  assert.equal(out.recall, DEFAULT_TEMPLATES.recall)
})

test('默认模板渲染出来：抬头说清是什么 + 本局人称', () => {
  const tpl = resolveTemplates(null)
  const text = fillTemplate(tpl.recall, {
    VIEWPOINT: '第二人称',
    STAMP: '永安三年·冬 · 临安·旧港',
    BLOCKS: '▍老陈\n身份职业：账房',
  })
  assert.ok(text.includes('【人物档案参考】'))
  assert.ok(text.includes('本局写作人称：第二人称'))
  assert.ok(text.includes('当前：永安三年·冬 · 临安·旧港'))
  assert.ok(text.includes('▍老陈'))
})

test('默认召回模板：没有地点时不留孤零零的分隔点', () => {
  const tpl = resolveTemplates(null)
  const text = fillTemplate(tpl.recall, { VIEWPOINT: '第二人称', STAMP: '永安三年·冬', BLOCKS: '▍老陈' })
  assert.ok(text.includes('当前：永安三年·冬'))
  assert.ok(!text.includes('· \n'))
})

// 守卫：运行期读的那份 txt 和编译进的 prompt.js 必须一致，否则"面板看到的"和"实际用的"会分叉。
test('assets/system-prompt.txt 与 prompt.js 内容一致', async () => {
  const { PROMPT_TEMPLATE } = await import('../plugin/prompt.js')
  assert.equal(systemText().trim(), PROMPT_TEMPLATE.trim(), '改了 docs 之后要同时重新生成 prompt.js 和 assets/system-prompt.txt')
})

test('系统提示词里的示例人名已换成「示例甲」这类占位', () => {
  const txt = systemText()
  assert.ok(txt.includes('示例甲'), '没有「示例甲」')
  for (const old of ['老陈', '值班店长张', '卖炭翁', '瞎眼的鱼贩']) {
    assert.ok(!txt.includes(old), `还有旧示例名：${old}`)
  }
})

// 守卫：动态上下文（视角/称呼/栏目定义）随工单发，不写死在系统提示词里（ADR 0095）。
test('动态上下文随工单发，不写死在系统提示词里', () => {
  const txt = systemText()
  assert.ok(!txt.includes('{{ENTRIES}}'), '系统提示词里不该再有 {{ENTRIES}}')
  assert.ok(txt.includes('见每轮工单开头'), '要指路到工单')

  const host = readFileSync(fileURLToPath(new URL('../plugin/index.mjs', import.meta.url)), 'utf8')
  assert.ok(host.includes('buildContextText('), '要拼动态上下文')
  const followup = readFileSync(fileURLToPath(new URL('../plugin/lib/followup.js', import.meta.url)), 'utf8')
  assert.ok(followup.includes('export function buildContextText'), 'followup 里要有 buildContextText')
})

// 工具 schema 是 type:'object'，一次提交要把判人五块和命题数组放在同一个对象里（ADR 0092）。
test('合并输出：判人五块 + 命题数组在同一个对象里', () => {
  const txt = systemText()
  assert.ok(txt.includes('一次交一个对象'), '要说清一次提交')
  assert.ok(txt.includes('"回头测试": { "通过"'), '判人块在同一个对象里')
  assert.ok(txt.includes('"命题": [ {'), '命题数组也在同一个对象里')
  assert.ok(!txt.includes('一次任务只提交当前那一类动作'), '不许再说分两次任务')
  assert.ok(!txt.includes('写入给 `{ "命题": [] }`'), '不许再说写入单独交空')
})

// 守卫：模型常把「回头测试·通过」当成已建档（老陈连续 5 轮只在通过名单里、从没进档案）。
test('提示词讲清：回头测试通过 ≠ 建档，够格必须报建档', () => {
  const txt = systemText()
  assert.ok(txt.includes('「通过」只是资格证'), '没写清「通过」只是资格证')
  assert.ok(txt.includes('没写进 `建档`'), '没写清只写进通过名单不算建档')
  assert.ok(txt.includes('模糊建档里的人每轮都要重新判'), '没写清模糊建档里的人要每轮重判')
})

// 守卫：合并调用后，提示词抬头不许再说「两类任务、每次只做一件」（ADR 0092）。
test('提示词抬头：一次提交里同时回答判定和写入', () => {
  const txt = systemText()
  assert.ok(!txt.includes('每次只做当前那一件'), '不许再说每次只做一件')
  assert.ok(!txt.includes('两类任务'), '不许再说两类任务')
  assert.ok(!txt.includes('只在【判人】里用'), '不许再说只在判人里用')
  assert.ok(txt.includes('同一次提交'), '要说清一起提交')
})

// 守卫：认知口径（拿不准给什么态度／亲眼见到算不算真）已经挪进设置，每轮随工单发（P20）。
test('提示词：态度口径指路到工单开头的【认知口径】，不再写死', () => {
  const txt = systemText()
  assert.ok(txt.includes('【认知口径】'), '要指路到【认知口径】')
  assert.ok(txt.includes('亲眼'), '要提到亲眼见到算不算真这条')
  assert.ok(!txt.includes('一律 `未定`'), '不许再写死「一律未定」')
  assert.ok(txt.includes('`真` = 该角色信这个说法'))
  assert.ok(txt.includes('`未定` = 该角色拿不准'))
  assert.ok(txt.includes('被洗脑'), '洗脑那条规则要保留')
})

// 守卫：档案是人物摘要，不是事件流水——故事里做的事本身不记，只记它留下的结果。
// 「一条动作」在本文里同时指提交的一条动作，容易混淆，故改成「他做的事」。
test('提示词：他做的事本身不记，只记它留下的结果', () => {
  const txt = systemText()
  assert.ok(txt.includes('他做的事本身不记'), '没有「他做的事本身不记」这条')
  assert.ok(!txt.includes('动作本身不记'), '「动作」这个词要留给提交格式，不再指故事里做的事')
  assert.ok(txt.includes('没有合适的栏目就不记'), '玩家删掉栏目后没有兜底')
})

// 守卫：同行的标配不算人物特征，反常才算（跟回头测试同一个道理）。
test('提示词：这个身份本来就会的不记，跟同身份的人不一样的才记', () => {
  const txt = systemText()
  assert.ok(txt.includes('这个身份本来就会的不记'), '没有身份标配这条')
  assert.ok(txt.includes('管家会叫车'), '没有管家叫车这个反例')
})

// 守卫：栏目定义每轮随工单发、写的是「记进哪一栏」；值不值得记归硬规矩 3、4。
test('提示词：栏目定义只管记哪一栏，值与不值以硬规矩 3、4 为准', () => {
  const txt = systemText()
  assert.ok(txt.includes('硬规矩 3、4'), '没有「冲突时以硬规矩 3、4 为准」这句')
  assert.ok(txt.includes('四条硬规矩'), '硬规矩的条数没跟着改')
  assert.ok(txt.includes('是真是假拿不准照记'), '真假拿不准会被「拿不准就不动」挡掉')
  assert.ok(txt.includes('宁可少写，不要乱写'), '原来的「拿不准就不动」不该被删掉')
})

// 守卫：撤回（ADR 0102）的用法与三条边界必须写在提示词里，且「关于」＝改口的人。
test('提示词：教了撤回怎么用、不许替别人撤，且「关于」＝改口的人', () => {
  const txt = systemText()
  assert.ok(txt.includes('**撤回'), '没有撤回那一段')
  assert.ok(txt.includes('别人还信旧说法的不要替他撤'), '没说清不许替别人撤')
  assert.ok(txt.includes('只能用素材里印出来的那些号'), '没说清序号只能用素材里的')
  assert.ok(txt.includes('"谁":"改口的人"'), '撤回段要说明「谁」填改口的人')
  assert.ok(txt.includes('不用报命题说的是谁'), '要说明命题说的是谁由程序按序号查')
  assert.ok(txt.includes('"撤回": [ { "谁":"示例丁", "序号":3 } ]'), '输出示例里没有撤回块')
})

// 守卫：两类命题的原句「与亲见设置无关，永远这么判」把界线扩到了整段，
// 会架空 ADR 0103 默认关的亲见口径；「不受默认态度影响」又让 defaultAttitude 对推断类失效。
// 只保留「推断不能因看见就给真」这条不受设置影响，其余一律听【认知口径】。
test('提示词：态度口径优先级写清，且口径真的跟着默认态度变', async () => {
  const txt = systemText()
  assert.ok(txt.includes('按【认知口径】判'), '可观察事实的态度要归口径管')
  assert.ok(txt.includes('看不出来按【认知口径】给'), '推断类看不出来时要回落到口径的默认态度')
  assert.ok(!txt.includes('不受默认态度影响'), '这句会让玩家设的默认态度失效')
  assert.ok(!txt.includes('跟「亲见算不算真」的设置无关，永远这么判'), '整段都写成与设置无关会架空 ADR 0103')
  assert.ok(txt.includes('不能因为看见了就给「真」'), '唯一不受设置影响的界线要保留')
  const { buildContextText } = await import('../plugin/lib/followup.js')
  const truth = buildContextText({ cognition: { defaultAttitude: '真' } })
  assert.ok(truth.includes('态度给「真」'), '默认态度要真能改，不是写死未定')
})

// 守卫：撤回与「写成假」的界线。旧版「亲口否定」和「认定是谎话」语义重叠，
// 模型仍要猜；且「写成假」没说要复用旧序号，可能被当成新建一条命题。
test('提示词：撤回与「假」的界线写清，且写明复用序号', () => {
  const txt = systemText()
  assert.ok(txt.includes('旧说法只是过时了'), '要写清何时用撤回')
  assert.ok(txt.includes('认定旧说法是谎话'), '要写清何时改用「假」')
  assert.ok(txt.includes('复用旧命题的 `序号`'), '「写成假」要复用旧命题，不许新建一条')
  assert.ok(txt.includes('认定旧说法是谎话'), '要写清何时改用「假」')
})

// 守卫：示例与规则不许打架（旧版一条命题同时带 序号 与 索引词）。
test('提示词：序号与索引词互斥，且措辞不许把「不带索引词」安到新命题头上', () => {
  const txt = systemText()
  assert.ok(txt.includes('复用时不带 `索引词`'), '要说清是复用旧命题时不带索引词')
  assert.ok(txt.includes('新命题不写 `序号`'), '要说清新命题不写序号')
  assert.ok(!txt.includes('新命题不写这个字段，也不用带 `索引词`'), '旧句主语写反，会变成新命题不带索引词')
  assert.ok(txt.includes('"索引词": [{ "词": "旧港码头"'), '示例里新命题要带索引词')
})
test('提示词：改名反例不再用像真名的示例甲', () => {
  const txt = systemText()
  assert.ok(!txt.includes('"那掌柜的"→"示例甲"'), '旧反例会让模型把真名当普通叫法')
  assert.ok(txt.includes('叫他「老哥」'), '要换成明显不是名字的叫法')
})

// 守卫：抬头不许自相矛盾（不写正文）、栏目定义不许错指位置。
test('提示词：抬头没有「让你写正文」的职责矛盾，栏目定义指路正确', () => {
  const txt = systemText()
  assert.ok(txt.includes('你不写正文'), '要保留"不写正文"')
  assert.ok(!txt.includes('让你写正文'), '给写正文模型的说明不该发给档案员')
  assert.ok(!txt.includes('从下面「栏目定义」表'), '栏目定义在工单开头，不在下面')
  assert.ok(txt.includes('看工单开头的【栏目定义】表'), '要指路到工单开头')
})

// 守卫：「每轮必须给回头测试」与「可以交 {}」不该同时无条件成立（ADR 0062）。
// 守卫：回头测试的强制条件要对齐程序（requireLook 只在有建档动作时才拦），
// 否则正文里出现一个未建档路人就要每轮输出回头测试块，削弱「允许交空」。
test('提示词：回头测试条件对齐程序，只在要建档时强制', () => {
  const txt = systemText()
  assert.ok(txt.includes('要报 `建档` 时，必须先给「回头测试」'), '强制条件要对齐 requireLook')
  assert.ok(txt.includes('整个交 `{}`'), '要保留允许交空')
  assert.ok(!txt.includes('正文里有还没建档的人，就必须给「回头测试」'), '旧条件比程序宽得多')
  assert.ok(!txt.includes('「回头测试」块**每轮都要给**'), '不该再无条件要求每轮给')
})

// 守卫：输出示例把七块全填满，与「其余块只写有的／没有就交 {}」有张力。
test('提示词：输出示例标明只演示字段形状，不表示每轮都要填满', () => {
  const txt = systemText()
  assert.ok(txt.includes('仅演示字段形状'), '示例要说明七块不会同时出现')
  assert.ok(txt.includes('整个交 `{}`'), '要保留允许交空')
})

// 守卫：重复内容清理。
test('提示词：称呼原样规则只出现一次，撤回规则不重复三遍', () => {
  const txt = systemText()
  const count = (needle) => txt.split(needle).length - 1
  assert.equal(count('不许自己拼'), 2, '「不许自己拼」只在回头测试与改名各出现一次')
  assert.equal(count('不许自己起名'), 0, '不该再单列一条重复的原样规则')
  assert.equal(count('没人知道的事'), 1, '「没人知道就不建」重复了')
  assert.equal(count('`撤回` 的含义是'), 0, '撤回解释不该在输出段再抄一遍')
  assert.equal(count('二、命题 + 指针'), 0, '不该再引用不存在的章节标题')
})

// 守卫：约定细则回到固定系统提示词（ADR 0106 推翻 0105 的「按需发」）。
// 理由：约定规则不随局变，属固定内容，放固定处才能被模型缓存；放每轮工单是每轮全价。
test('提示词：约定细则在系统提示词里，且说明没有约定栏目就别带这个字段', () => {
  const txt = systemText()
  assert.ok(txt.includes('约定状态只有四个'), '四个状态要回到系统提示词')
  assert.ok(txt.includes('上一轮素材里给你的约定类命题'), '沿用规则要回到系统提示词')
  assert.ok(txt.includes('"约定": "没完成"'), '约定示例要回到系统提示词')
  assert.ok(txt.includes('没有约定栏目'), '要说清本局没有约定栏目就别带这个字段')
})

// 守卫：撤回只写「谁」＋「序号」，命题说的是谁由程序查（ADR 0106）。
test('提示词：撤回只写谁和序号，不再让模型报关于', () => {
  const txt = systemText()
  assert.ok(txt.includes('"谁":"改口的人"'), '撤回段要用「谁」')
  assert.ok(txt.includes('不用报命题说的是谁'), '要说明关于由程序查')
  assert.ok(!txt.includes('"关于":"改口的人"'), '不该再把「关于」当持指针者')
})

// 守卫：加粗到处都是＝等于没有重点；同时整体比旧版短（省 token）。
test('提示词：加粗不过量，且比手改版更短', () => {
  const txt = systemText().trim()
  const boldPairs = (txt.match(/\*\*/g) || []).length / 2
  assert.ok(boldPairs <= 20, `加粗还有 ${boldPairs} 处，太多了`)
  assert.ok(txt.length < 5804, `还有 ${txt.length} 字，没比手改版（5804）短`)
})
