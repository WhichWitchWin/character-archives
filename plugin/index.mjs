// 人物冷存档 · 宿主侧入口（M1 骨架）
//
// M1 只做三件事，用来验证「插件能加载 → 事件能收到 → 数据能落盘 → 侧栏能读到」这条链路：
//   1. 每轮结算完成后，往整局数据记一笔「最近结算轮次」；
//   2. 提供 handle('dsh-tavern-npc-archives/summary')，给侧栏面板与状态分节读摘要；
//   3. 整局数据的初始形状（字典、锁/眼睛、快照索引）。
//
// 接口依据：presets/tavern/skills/tavern-plugin/references/plugin-api.md、plugin-api-data.md
// 人物册本体不在这里：它按轮存进 saveTurnData（M2 做）。

export const name = 'dsh-tavern-npc-archives'
export const inject = ['tavern']

/** 整局数据的结构版本（与快照的 v 无关；快照的 v 见设计稿 §4.8）。 */
export const DATA_VERSION = 1

/**
 * 整局数据的初始形状。这部分不占 64 KB 的按轮快照额度。
 * dict   —— 字典本体（§4.5）：d 原文数组、t 类型数组，下标即号码
 * flags  —— 锁与可见性（§8.7）：按人物编号存，不写入快照
 * snapshots.index —— 快照索引（§3.4）：轮次、字节数、变化率
 */
export function createGameState() {
  return {
    v: DATA_VERSION,
    meta: { updatedTurn: null, updatedAt: null },
    dict: { v: 1, d: [], t: [] },
    // 该局的条目定义：码 → { name, prompt, unique, mode }（ADR 0008）
    // 放整局数据而不是快照：每条约 50 字节，2000 份快照各带一份会撑爆 8 MB 上限。
    entries: {},
    flags: { status: {}, lock: {}, hidden: {} },
    snapshots: { index: [] },
    anchors: {},              // ADR 0005 在场名单（临时结构，做「在场人物进快照」时要删）
    nextId: 1,                // 人物编号计数器（ADR 0004：号码永不复用）
    cooldowns: {},            // 召回冷却 + 归档缓冲（ADR 0005 / 临时文档第十节）
    pending: [],              // ADR 0005 暂存批：同一轮的值共享一条 gt
    notice: { v: 1, items: [] }, // 提示记录（容量事件与每轮动作）
  }
}

/**
 * 读整局数据。没有数据、或结构版本对不上时返回初始形状。
 * M1 不做 v→v+1 的迁移链（设计稿 §4.8 的迁移策略留到真有 v2 时再写）。
 */
export async function loadGameState(tavern, gameId) {
  const data = await tavern.readGameData({ gameId })
  if (!data || data.v !== DATA_VERSION) return createGameState()
  return {
    ...createGameState(),
    ...data,
    meta: { ...createGameState().meta, ...data.meta },
    flags: { ...createGameState().flags, ...data.flags },
  }
}

export function apply(ctx) {
  // saveGameData / onTurnSettled / handle 都是第 2 版接口。
  if (ctx.tavern.apiVersion < 2) return

  // 每轮结算完成后记一笔（证明事件通路与存储通路都是通的）。
  ctx.tavern.onTurnSettled(async (turn) => {
    const state = await loadGameState(ctx.tavern, turn.gameId)
    state.meta.updatedTurn = turn.turn
    state.meta.updatedAt = new Date().toISOString()
    await ctx.tavern.saveGameData({ gameId: turn.gameId, data: state })
  })

  // 浏览器侧（侧栏面板、酒馆状态页分节）来取摘要。
  ctx.tavern.handle('dsh-tavern-npc-archives/summary', async ({ gameId } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    return {
      version: state.v,
      updatedTurn: state.meta.updatedTurn,
      updatedAt: state.meta.updatedAt,
      dictSize: state.dict.d.length,
      snapshotCount: state.snapshots.index.length,
    }
  })
}
