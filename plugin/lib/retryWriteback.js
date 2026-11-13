// 手动补写（ADR 0111）：面板上一个「补写这一轮」按钮，兜住自动写入失败。
//
// 为什么要有：自动写回是「射后不管」的后台任务，模型偶尔交空、或者写回中途失败，
// 那一轮的内容就永久缺了——玩家只能回退重跑（会连带重算 MVU），代价太大。
//
// 这个模块只放**纯判断与一句话回执**（不碰 ctx、不读文件）：
//   1. 什么时候不许补：正在生成/结算、还没结算过、写入方式是「关闭」；
//   2. 补完怎么用一句人话告诉玩家补到了什么。
// 真正的补写动作在 index.mjs 的 handle 里，复用自动结算那套 `runWriteback`（D6）。

/**
 * 补写前的判断。
 *
 * @param {{turnState?:object|null, mode?:string, inFlight?:boolean}} input
 *   `turnState` 是宿主 `getTurnState` 的返回（用到 `turn`／`busy`）；
 *   `mode` 是 `settings.writeback.mode`（`off`／`background`／`subagent`）；
 *   `inFlight` 是**我们自己的**标记：这一轮的自动写回还在跑（宿主不知道这个，`busy` 覆盖不到）。
 * @returns {{ok:boolean, reason:string}} 不能补时 `reason` 是给玩家看的一句人话
 */
export function retryRefusal({ turnState, mode, inFlight = false } = {}) {
  // 布尔／字符串冒充轮次一律当「读不到」：`Number(true) === 1`，放它过去就等于认了一个假轮次
  const rawTurn = turnState?.turn
  const turn = Number.isInteger(rawTurn) ? rawTurn : NaN
  if (!Number.isInteger(turn)) {
    return { ok: false, reason: '读不到这一局现在在第几轮（宿主版本可能太旧），没法补写' }
  }
  if (turn < 1) {
    return { ok: false, reason: '这一局还没有结算过任何一轮，没什么可补的' }
  }
  // 结算中补写会跟后台任务抢同一份整局数据（整份覆盖写），必须让路
  if (turnState?.busy) {
    return { ok: false, reason: '这一轮正在生成或结算，等它结束了再补写' }
  }
  // 宿主只在「前台生成／后台结算」时置 busy；**插件自己的自动写回**它不知道（它不等我们），
  // 所以还得看 in-flight：否则同一轮会并发跑两遍写回，同轮快照互相覆盖、整局数据后写覆盖先写。
  if (inFlight) {
    return { ok: false, reason: '这一轮的自动写回还在跑，等它结束了再补写' }
  }
  if (String(mode ?? '') === 'off') {
    return { ok: false, reason: '档案写入方式是「关闭」，先在设置里打开写入方式再补写' }
  }
  return { ok: true, reason: '' }
}

/**
 * 补写回执：一句人话说清补到了什么（面板上直接显示这句）。
 *
 * @param {{judgeActions?:number, created?:number, writeActions?:number, bad?:number}} [counts]
 *   就是 `state.debugWriteback` 里那几个数
 * @returns {string}
 */
export function retrySummary(counts) {
  // 只认正整数：负数/小数/字符串不进文案（否则会显示「判定 -1 条」这种怪话）
  const count = (value) => (Number.isInteger(value) && value > 0 ? value : 0)
  const judge = count(counts?.judgeActions)
  const created = count(counts?.created)
  const write = count(counts?.writeActions)
  const bad = count(counts?.bad)
  // 「没读出可写的内容」会让人以为解析失败；真实情况多半是「模型这轮没给动作」，所以换个说法
  if (![judge, created, write, bad].some((one) => one > 0)) return '补写完成：这轮没有新内容可写'
  const parts = []
  if (judge) parts.push(`判定 ${judge} 条`)
  if (created) parts.push(`建档 ${created} 人`)
  if (write) parts.push(`写入 ${write} 条`)
  if (bad) parts.push(`拒 ${bad} 条`)
  return `补写完成：${parts.join(' · ')}`
}
