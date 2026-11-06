// 后台成员（member）交卷的中转盒（ADR 0100）
//
// 为什么需要这个模块：宿主调用插件工具时**只传 args**——
// `plugin-task-execution.js` 里是 `tool.execute(structuredClone(args ?? {}))`，
// 第二个参数永远是 undefined。所以「这一轮往哪个盒子里交」不能从工具参数里找，
// 必须在派发任务之前先定好，工具只管往当前那只盒子写。
//
// 以前写的是 `memberBox(execution?.sessionId)`：execution 拿不到，键就变成空串，
// 内容写进一只没人读的盒子，`runPhase` 读到 null，
// 表现是「模型一条动作都没返回」——而且工具还返回 ok，日志里什么都看不出。
//
// 纯逻辑：不 import 酒馆接口、不接触 ctx。

/** 当前正在跑的那一轮的交卷盒（宿主规定同一成员的任务串行，所以同时只有一个）。 */
let active = null

/**
 * 派发一轮之前调用：声明这一轮往哪只盒子交。
 * @param {{payload:any, merged?:boolean, submissions?:any[]}} box
 */
export function beginMemberRun(box) {
  active = box && typeof box === 'object' && !Array.isArray(box) ? box : null
  return active
}

/** 一轮结束（成功／超时／中止都要调）：只清自己那只，避免踩到下一轮。 */
export function endMemberRun(box) {
  if (!box || active === box) active = null
}

/**
 * 交卷：把模型报的载荷并进当前盒子。
 * @param {any} args 工具收到的参数（宿主只会给这一个）
 * @returns {{ok:boolean, error?:string}} 交给模型看的结果
 */
export function submitMemberPayload(args) {
  if (!active) {
    // 明确报错，别静默丢：模型还能重试，日志里也留得下痕迹
    return { ok: false, error: '没有正在运行的档案任务，这次提交被丢弃' }
  }
  const incoming = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
  active.submissions = [...(active.submissions ?? []), incoming]
  // 同一轮可能交多次：合并，不许后交覆盖先交（否则前半块静默消失，/debug 里只剩 0 条）
  if (active.payload != null) active.merged = true
  active.payload = { ...(active.payload ?? {}), ...incoming }
  return { ok: true }
}
