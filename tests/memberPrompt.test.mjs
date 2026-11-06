// 后台成员（跟随后台档）的系统提示词，要和面板里那份**是同一份**。
//
// 为什么要有这组守卫：成员的 `system` 是注册时定下的**前缀**（宿主 `tavern.member()`），
// 面板改完如果不重挂，成员那边还念着旧规则——面板显示的和实际注入的就会各说各话（ADR 0096）。
// 前缀只在注册时进宿主的表里，所以「重挂」必须是一条明确的代码路径，不能靠"应该会同步"。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const indexSrc = readFileSync(new URL('../plugin/index.mjs', import.meta.url), 'utf8')
const clientSrc = readFileSync(new URL('../plugin/client.js', import.meta.url), 'utf8')

/** `mountMember` 的函数体（从定义到 apply 之前）。 */
function mountBody() {
  const from = indexSrc.indexOf('function mountMember(')
  assert.notEqual(from, -1, '应当有 mountMember(ctx, system) 这样的重挂入口')
  const to = indexSrc.indexOf('export function apply(', from)
  assert.ok(to > from, 'mountMember 应当在 apply 之前定义')
  return indexSrc.slice(from, to)
}

/** 取某个 handle 注册块的源码（从锚点起，到下一个 handle 之前）。 */
function handleBlock(src, name) {
  const from = src.indexOf(`handle('character-archives/${name}'`)
  assert.notEqual(from, -1, `找不到 handle('character-archives/${name}')`)
  const rest = src.slice(from + 1)
  const next = rest.indexOf('ctx.tavern.handle(')
  return next === -1 ? rest : rest.slice(0, next)
}

test('重挂：先卸掉上一次注册，再挂新的', () => {
  const body = mountBody()
  assert.match(body, /memberDispose\(\)/, '重挂前必须调用上一次注册返回的卸载函数')
  assert.match(body, /ctx\.tavern\.member\(/, '然后用新文本注册')
  assert.match(indexSrc, /mountMember\(ctx,\s*defaultSystemPrompt\(\)\)/, 'apply 里应当用它挂上默认系统提示词')
})

test('重挂失败要回滚：不能让成员凭空消失（评审 A1）', () => {
  const body = mountBody()
  // 宿主同名重复注册会抛错，所以必须先卸；但卸完挂失败就等于没成员了——
  // 派发时 plugin-task-execution.js 会直接报「没有注册成员 档案员」，后台写回整档失效。
  assert.match(body, /previousText/, '要留一份旧文本用于回滚')
  assert.match(body, /return false/, '挂失败要能被调用方看出来')
})

test('启动期读盘不覆盖玩家刚保存的那份（评审 A2）', () => {
  assert.match(indexSrc, /memberSeq/, '异步刷新要有序号校验，晚到的旧文本不能盖回新的')
})

test('面板保存系统提示词后，按刚保存的那份重挂', () => {
  const block = handleBlock(indexSrc, 'set-prompts')
  assert.match(block, /mountMember\(ctx,\s*templates\.system\)/, '重挂用的必须是 savePrompts 返回的那份 system')
})

test('提示词长度上限不超过宿主的成员前缀上限（评审 A1 根因）', () => {
  // 宿主 MAX_MEMBER_SYSTEM = 20000（plugin-api.js:34）；插件上限比它大，
  // 就会出现「面板存得下、成员挂不上」的半截状态。
  assert.match(indexSrc, /const MAX_PROMPT_CHARS = 20000/, '插件上限必须 ≤ 宿主成员前缀上限 20000')
})

test('面板上写明：跟随后台档保存后下一轮结算生效', () => {
  // 宿主把成员的 system 当「每次组装现取」的函数段（background-agent-task.js:165-175 的 text 闭包读
  // state.input.system，而 state.input 每次派发都换，background-agent-sessions.js:309），
  // 所以既有会话下一轮就吃到新文本——别写「要新开一局」，那是错的、会白劝玩家重开。
  assert.match(clientSrc, /下一轮结算/, 'hint 要说清是下一轮结算生效')
  assert.ok(!/要新开一局|才注入/.test(clientSrc), '不需要新开一局，别把错的边界写进面板')
})
