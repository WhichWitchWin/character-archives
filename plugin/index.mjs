// 人物档案馆 · 宿主侧入口
//
// 目前做四件事：
//   1. **召回注入**（turnSection）：正文生成前，把离场人物的档案塞进提示词；
//   2. 每轮结算完成后，往整局数据记一笔「最近结算轮次」；
//   3. 提供 handle('character-archives/summary')，给侧栏面板与状态分节读摘要；
//   4. 整局数据的初始形状（字典、锁/眼睛、快照索引）。
//
// 接口依据：presets/tavern/skills/tavern-plugin/references/plugin-api.md、plugin-api-data.md
// 纯逻辑一律在 lib/ 里，这里只做「读数据 → 调 lib → 交结果」的胶水。

import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { pickDataRoot, PLUGIN_NAME } from './lib/dataRoot.js'
import { createSegmenter } from './lib/segment.js'
import { configureSegmenter } from './lib/match.js'
import { readFileSync, writeFileSync } from 'node:fs'

import { SNAPSHOT_VERSION, readOrCreateSnapshot, readSnapshot, resolveTurn, STATUS } from './lib/snapshot.js'
import { mergeSettings, resolveSettings, splitSettings } from './lib/settings.js'
import { properNounsOf, wordsOfClaim, filterIndexWords, withClaimWords, configureWordSegmenter } from './lib/indexWords.js'
import { buildWriteMaterial } from './lib/writeMaterial.js'
import { applyWriteActions } from './lib/writeActions.js'
import { addGlobalWords, globalWordList, normalizeGlobalWords } from './lib/globalWords.js'
import { matchText } from './lib/match.js'
import { splitAliases, namesOfPerson } from './lib/names.js'
import { buildCombinedPrompt, buildContextText } from './lib/followup.js'
import {
  applyPersonActions,
  passedWithoutBuild,
  renamePerson,
  resolvePersonByName,
  resolvePersonRef,
  setPersonNames,
  validatePersonActions,
} from './lib/actions.js'
import { createIdCounter, takePersonId } from './lib/person.js'
import { dropLeft, setLeft } from './lib/gametime.js'
import { PROMPT_TEMPLATE, RECALL_TEMPLATE, WRITE_TEMPLATE } from './prompt.js'
import { parseJudgePayload, parseWritePayload, parseWritePayloadBundle } from './lib/payload.js'
import { knownPlaces, resolvePlace } from './lib/place.js'
import { checkText, NAME_MAX } from './lib/inputLimit.js'
import { beginMemberRun, endMemberRun, submitMemberPayload } from './lib/memberBox.js'
import { createQueryCounter } from './lib/queryBudget.js'
import { applyRetractions } from './lib/retract.js'
import { claimsOfPerson, filterDeletedPersonActions, pointersOfPerson, splitPersons, idSet } from './lib/deleted.js'
import { pruneFutureFlags } from './lib/rollback.js'
import { PLAYER_ID, ensurePlayer, isPlayer, isPronounName } from './lib/player.js'
import { fuzzyLeaveIds, markSeen } from './lib/fuzzy.js'
import { buildRecallSection } from './lib/recallEngine.js'
import { buildPendingRecallText, normalizeLevel, queryPerson } from './lib/recallQuery.js'
import { pointerKey, pruneExpired } from './lib/cooldown.js'
import { DEFAULT_TEMPLATES, PLACEHOLDERS, fillTemplate, resolveTemplates } from './lib/promptTemplates.js'
import { buildPresetDefinitions } from './lib/presets.js'
import { buildPanelView, DORMANT_TURNS } from './lib/panelView.js'
import { listLeafPaths, parseMvu, readStatData } from './lib/mvu.js'
import { addClaim, dropClaim, findClaim, pruneOrphanClaims } from './lib/claims.js'
import { addPointer, dropPointer, hasSelf, pointersTo, setEntry, TRUTH as PTRUTH } from './lib/pointers.js'
import { surveyStatData } from './lib/mvuMap.js'
import { DEFAULT_MAX_IDLE, expireDraft, pruneDraft, scanDraft } from './lib/draft.js'
import { DEFAULT_IDENTITY, MAX_PLAYER_NAME, PERSON_OPTIONS, applyIdentityPatch, identityProblem, personLabel, pronounOf, resolveIdentity } from './lib/identity.js'
import { createFileStore, DEFAULT_KEEP_TURNS, hashKey } from './lib/store.js'
import { createQueue } from './lib/queue.js'
import { applySettingPatch, describeSettings } from './lib/settingsView.js'
import { DEFAULT_SETTINGS } from './lib/settings.js'
import { nextFreeCode } from './lib/entries.js'
import { buildArchiveExport, importBundle } from './lib/exportBundle.js'

export const name = 'character-archives'
// 用到宿主服务就要写进 inject —— 少写一个，apply() 里访问它就抛错、整个插件起不来
// （2026-11-04：漏了 'tools'，插件启动直接崩，面板全报"没有处理函数"）
export const inject = ['tavern', 'tools']

/** 最近一次正文请求的 gameId（工具的兜底；正常走 execution.sessionId）。 */
let activeGameId = ''

/** 栏目说明的字数上限：只防"粘进来一个大文件"，不限写法。 */
const MAX_FIELD_CHARS = 500

/**
 * 栏目「抓取提示词」的字数上限（2026-11-06 定 40 字）。
 * 为什么单独卡这么紧：它会被拼进**每一轮**工单开头的【栏目定义】（`entryLinesOf`），
 * 8 条 × 40 字 = 320 字；再长就是从召回预算里抢字数。默认那 8 条都在 23～39 字之间。
 */
const MAX_ENTRY_PROMPT_CHARS = 40

/**
 * 三段提示词各自的上限：只防超长粘贴。
 * 必须 ≤ 宿主的成员前缀上限 20000（plugin-api.js 的 MAX_MEMBER_SYSTEM）——
 * 系统提示词还要注册成后台成员的前缀，插件这边放进去 25000 字，
 * 就成了「面板存得下、成员挂不上」的半截状态（2026-11-06 评审 A1）。
 */
const MAX_PROMPT_CHARS = 20000

/** 把一条值的原文解出来：字符串直接用，数字是字典下标（§4.3）。 */
function decodeValue(value, dict) {
  if (typeof value === 'number') return String(dict?.d?.[value] ?? '')
  return String(value ?? '')
}

/** 整局数据的结构版本（与快照的 v 无关；快照的 v 见设计稿 §4.8）。 */
// ── 自持存储（issue 讨论 / ADR 0057）──
// 快照与整局数据写**插件自己的 data/ 目录**，酒馆里只留几十字节的指针。
// 为什么放插件目录而不是酒馆数据区：这是我们自己的数据，跟着插件走最好排查；
// 代价是重装插件（清目录）会丢，所以导出包（ADR 0050）仍然要能带走全部内容。
// ── 中文分词器（ADR 0060）──
// 词表放 assets/dict/zh.txt（jieba 的 dict.txt.small 精简版，MIT）。
// 读不到就退回字串包含，绝不让插件起不来。
let segmenter = null
try {
  const dictText = readFileSync(new URL('./assets/dict/zh.txt', import.meta.url), 'utf8')
  segmenter = createSegmenter({ dictText })
  configureSegmenter(segmenter)
  // 同一只分词器也交给「程序自动抽词」：召回时用它把命题值分出通用词，
  // 模型只负责专名（见 lib/indexWords.js 的 autoWordsOf）
  configureWordSegmenter(segmenter)
  console.log(`[人物档案馆] 分词词表已加载：${segmenter.size} 词`)
} catch (error) {
  console.warn('[人物档案馆] 词表加载失败，退回字串匹配', error?.message ?? error)
}

/**
 * 每轮把「当前人物的姓名/别名 + 模糊建档的名字 + 跨局专名」灌进用户词典。
 * 不灌的话，「老陈」会被切成「老/陈」，反而更容易误命中。
 *
 * ⚠️ 是**整体替换**（`setExtraWords` 内部先重建 Map），不是追加：
 * 上一轮还在、这一轮被摘掉的名字，下一轮就干净了，不会越攒越多。
 *
 * @param {string[]} [globalWords] 跨局专名词库（ADR 0077）：地名、店名、组织名
 */
function syncUserWords(snapshot, draft, globalWords = []) {
  if (!segmenter) return
  const words = new Set()
  for (const person of Array.isArray(snapshot?.p) ? snapshot.p : []) {
    const name = String(person?.[2] ?? '').trim()
    if (name) words.add(name)
    for (const alias of splitAliases(person?.[4])) {
      words.add(alias)
    }
  }
  for (const name of Object.keys(draft ?? {})) {
    const trimmed = String(name ?? '').trim()
    if (trimmed) words.add(trimmed)
  }
  // 跨局专名：地名/店名/组织名，让「香格里拉酒吧」不被切开
  for (const word of Array.isArray(globalWords) ? globalWords : []) {
    const trimmed = String(word ?? '').trim()
    if (trimmed) words.add(trimmed)
  }
  segmenter.setExtraWords([...words])
}
/**
 * 三段模板：**全局存**（插件数据，不跟局也不跟卡）——
 * 它是"我们怎么跟模型说话"，换局换卡都该是同一套。
 * 空串回落默认（系统那段的默认值来自 prompt.js）。
 */
async function readPrompts(ctx) {
  // 三段都以 assets/*.txt 为**唯一真相**：改文件、改面板都落到它身上，
  // 文件 / 面板 / prompt.js 兜底三处不会各说各话。
  const fromFile = {
    system: defaultSystemPrompt(),
    write: defaultWritePrompt(),
    recall: defaultRecallPrompt(),
  }
  try {
    const data = await ctx.tavern.readPluginData()
    return resolveTemplates(data?.prompts, fromFile)
  } catch {
    return resolveTemplates(null, fromFile)
  }
}

/** 合并保存模板；传空串表示"恢复默认"。 */
async function savePrompts(ctx, patch) {
  const data = (await ctx.tavern.readPluginData()) ?? {}
  const next = { ...(data.prompts ?? {}) }
  for (const key of ['system', 'write', 'recall']) {
    if (!patch || !Object.hasOwn(patch, key)) continue
    const value = patch[key]
    if (typeof value !== 'string') continue
    if (value.trim()) next[key] = value
    else delete next[key]          // 空串 = 恢复默认
  }

  // 三段都落盘到 txt：让「改面板」和「改文件」是同一件事。
  // 写不进去（比如安装目录只读）就只存插件数据，面板照常能用。
  for (const [key, file, fallback] of [
    ['system', SYSTEM_PROMPT_FILE, PROMPT_TEMPLATE],
    ['write', WRITE_PROMPT_FILE, DEFAULT_TEMPLATES.write],
    ['recall', RECALL_PROMPT_FILE, DEFAULT_TEMPLATES.recall],
  ]) {
    if (!patch || typeof patch[key] !== 'string') continue
    const text = patch[key].trim() ? patch[key] : fallback
    try {
      writeFileSync(file, text, 'utf8')
    } catch {
      // 忽略：下面照常存插件数据
    }
  }

  data.prompts = next
  await ctx.tavern.savePluginData({ data })
  return resolveTemplates(next, {
    system: defaultSystemPrompt(),
    write: defaultWritePrompt(),
    recall: defaultRecallPrompt(),
  })
}
const PLUGIN_DIR = fileURLToPath(new URL('.', import.meta.url))

/** 系统提示词的**运行期来源**：每次读这个 txt，改完装上就生效，不用重启。 */
const SYSTEM_PROMPT_FILE = fileURLToPath(new URL('./assets/system-prompt.txt', import.meta.url))
/** 写入段 / 召回段同样以 txt 为唯一真相（2026-11-04 对称化）。 */
const WRITE_PROMPT_FILE = fileURLToPath(new URL('./assets/write-prompt.txt', import.meta.url))
const RECALL_PROMPT_FILE = fileURLToPath(new URL('./assets/recall-prompt.txt', import.meta.url))

function readTemplateFile(file, fallback) {
  try {
    const text = readFileSync(file, 'utf8').trim()
    if (text) return text
  } catch {
    // 读不到就用编译进来的那份兜底
  }
  return fallback
}

function defaultSystemPrompt() {
  return readTemplateFile(SYSTEM_PROMPT_FILE, PROMPT_TEMPLATE)
}

function defaultWritePrompt() {
  return readTemplateFile(WRITE_PROMPT_FILE, WRITE_TEMPLATE)
}

function defaultRecallPrompt() {
  return readTemplateFile(RECALL_PROMPT_FILE, RECALL_TEMPLATE)
}

/**
 * 把条目定义拼成「每个栏目该写什么」的清单，塞进系统提示词的 {{ENTRIES}}。
 * 模型光看栏目名不知道怎么下笔（「职业」里塞"管车与早饭"就是这么来的）。
 */
function entryLinesOf(definitions) {
  const entries = Object.entries(definitions ?? {})
  if (!entries.length) return '（这一局还没有栏目）'
  return entries
    .map(([, item]) => {
      const name = String(item?.name ?? '').trim() || '（未命名栏目）'
      // 两个召回标记要**标在栏目名后面**：模型看到【约定】才知道该栏目的动作要带 `约定` 字段，
      // 看到【必带】就知道它每次都会被召回（不用它操心，但标出来更不容易写偏）。
      const marks = [
        item?.convention === true ? '【约定】' : '',
        item?.mustRecall === true ? '【必带】' : '',
      ].filter(Boolean).join('')
      const label = marks ? `${name}${marks}` : name
      const prompt = String(item?.prompt ?? '').trim()
      return prompt ? `· ${label} —— ${prompt}` : `· ${label}`
    })
    .join('\n')
}

const STORE_ROOT = pickDataRoot({ pluginDir: PLUGIN_DIR, env: process.env })


const store = createFileStore({ root: STORE_ROOT })

/**
 * 整局数据的「读-改-写」串行队列（lib/queue.js 终于接线）。
 *
 * 为什么需要：整局数据是**整份覆盖**写的。宿主派发 onTurnSettled 是「射后不管」，
 * 玩家连发时第 5、6 轮的结算可能并发——两个回调同时「读→改→写」，后写的会覆盖
 * 先写的（丢 flags/冷却这类小账）。把**写回**这一步排进同一条队列，
 * 覆盖窗口就关死了；快照按轮写文件，天然不冲突，不用排。
 *
 * 队列任务只包「落盘」那几毫秒，不等模型——长任务在队列外跑完再进来。
 */
const stateWriteQueue = createQueue()

/** 存整局数据：内容进文件，酒馆里只留指针。串行队列保证并发结算不互相覆盖。 */
async function saveGameState(ctx, gameId, state) {
  return stateWriteQueue(async () => {
    // 预设不再跟着「存局」自动写卡级（2026-11-05）：改成全局默认 + 按卡覆盖，
    // 玩家在面板改预设走 presets-save，由它决定写全局还是写这张卡。
    const rest = { ...state }
    delete rest.entries
    delete rest.mvuChecklist
    if (rest.settings) {
      rest.settings = { ...rest.settings }
      delete rest.settings.checkedCodes
    }
    store.writeGame(gameId, rest)
    await ctx.tavern.saveGameData({ gameId, data: { v: DATA_VERSION, store: 'file', at: new Date().toISOString() } })
  })
}

/**
 * 读「按卡」的预设（ADR 0090）。拿不到返回 null，调用方回落到默认预设。
 * @returns {Promise<null|{entries:object|null, checkedCodes:string[]|null,
 *                       mvuChecklist:object|null}>}
 */
async function readCardPreset(tavern, cardKey) {
  const key = String(cardKey ?? '')
  if (!key) return null
  try {
    const data = await tavern.readPluginData()
    const found = data?.presetsByCard?.[key]
    if (!found || typeof found !== 'object') return null
    return {
      entries: found.entries && typeof found.entries === 'object' ? found.entries : null,
      checkedCodes: Array.isArray(found.checkedCodes) ? found.checkedCodes : null,
      mvuChecklist: found.mvuChecklist && typeof found.mvuChecklist === 'object' ? found.mvuChecklist : null,
    }
  } catch {
    return null
  }
}

/** 写「按卡」的预设。没有卡 id（极少见）就跳过，别把预设写到全局去。 */
async function writeCardPreset(ctx, cardKey, preset) {
  const key = String(cardKey ?? '')
  if (!key) return
  const data = (await ctx.tavern.readPluginData()) ?? {}
  const map = { ...(data.presetsByCard ?? {}) }
  map[key] = { ...preset, at: new Date().toISOString() }
  data.presetsByCard = map
  await ctx.tavern.savePluginData({ data })
}

/**
 * 读「全局」预设（插件数据 `presets`）。没有返回 null，调用方回落到内置默认。
 * 2026-11-05：预设改成「全局是默认、按卡是可选覆盖」——以前是每张卡各存一份。
 */
async function readGlobalPreset(tavern) {
  try {
    const data = await tavern.readPluginData()
    const found = data?.presets
    if (!found || typeof found !== 'object') return null
    return {
      entries: found.entries && typeof found.entries === 'object' ? found.entries : null,
      checkedCodes: Array.isArray(found.checkedCodes) ? found.checkedCodes : null,
      mvuChecklist: found.mvuChecklist && typeof found.mvuChecklist === 'object' ? found.mvuChecklist : null,
    }
  } catch {
    return null
  }
}

/** 写「全局」预设。 */
async function writeGlobalPreset(ctx, preset) {
  const data = (await ctx.tavern.readPluginData()) ?? {}
  data.presets = { ...preset, at: new Date().toISOString() }
  await ctx.tavern.savePluginData({ data })
}

/** 删掉这张卡的卡级覆盖（回到全局）。 */
async function clearCardPreset(ctx, cardKey) {
  const key = String(cardKey ?? '')
  if (!key) return
  const data = (await ctx.tavern.readPluginData()) ?? {}
  const map = { ...(data.presetsByCard ?? {}) }
  if (!Object.hasOwn(map, key)) return
  delete map[key]
  data.presetsByCard = map
  await ctx.tavern.savePluginData({ data })
}
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
    // 该局的栏目定义：码 → { name, prompt, mustRecall, convention }（ADR 0008）
    // 放整局数据而不是快照：每条约 50 字节，2000 份快照各带一份会撑爆 8 MB 上限。
    // 新局先落一份「通用预设」的 8 条；形象包由设置项决定，默认不开（§8.8）。
    entries: buildPresetDefinitions().definitions,
    flags: { status: {}, lock: {}, hidden: {}, left: {}, seen: {}, draft: {}, lastHits: {} },
    snapshots: { index: [] },
    nextId: 1,                // 人物编号计数器（ADR 0004：号码永不复用）
    cooldowns: {},            // 召回冷却（§7.5）
  }
}

/**
 * 读整局数据。没有数据、或结构版本对不上时返回初始形状。
 * M1 不做 v→v+1 的迁移链（设计稿 §4.8 的迁移策略留到真有 v2 时再写）。
 */
export async function loadGameState(tavern, gameId) {
  const pointer = await tavern.readGameData({ gameId })
  // 酒馆里只有指针，内容在文件里。指针没了、或文件丢了 → 从头开始。
  // **不兼容旧格式**：一版没发过，实验数据不值得背兼容包袱（ADR 0058 之后的清理）。
  const data = pointer?.store === 'file' ? store.readGame(gameId) : null
  const state = !data || data.v !== DATA_VERSION
    ? createGameState()
    : {
        ...createGameState(),
        ...data,
        meta: { ...createGameState().meta, ...data.meta },
        flags: { ...createGameState().flags, ...data.flags },
      }
  // 预设：全局是默认、按卡是可选覆盖（2026-11-05）。读的时候卡级优先，没有就用全局，
  // 再没有就用 createGameState 的内置默认。
  const cardKey = String(state?.meta?.cardKey ?? '')
  const cardPreset = cardKey ? await readCardPreset(tavern, cardKey) : null
  const globalPreset = await readGlobalPreset(tavern)
  const preset = cardPreset ?? globalPreset
  if (preset) {
    if (preset.entries) state.entries = preset.entries
    if (preset.checkedCodes) state.settings = { ...(state.settings ?? {}), checkedCodes: preset.checkedCodes }
    if (preset.mvuChecklist) state.mvuChecklist = preset.mvuChecklist
  }

  // 回退（B1）：酒馆的当前轮次会变小，但整局数据里的 updatedTurn 不会自己回退。
  // 读的时候先问酒馆（getTurnState 在回退/重新生成后给的是当前状态），拿不到才用旧值。
  let turnState = null
  try {
    if (typeof tavern.getTurnState === 'function') {
      turnState = await tavern.getTurnState({ gameId })
    }
  } catch {
    // 旧宿主没有这个接口，回落 updatedTurn
  }
  const currentTurn = resolveTurn({ updatedTurn: state.meta?.updatedTurn, turnState })
  if (currentTurn != null) {
    state.meta.updatedTurn = currentTurn
    // flags 里的记录也可能指向回退后的「未来轮次」（候选表、离场、露面），一并清掉
    state.flags = pruneFutureFlags({ flags: state.flags, turn: currentTurn })
  }

  return state
}

/**
 * 读某一轮（或它之前最近一份）的快照。
 *
 * ⚠️ `readTurnData` 返回的是 **`{ turn, textVersion, data }`**，快照在 `.data` 里——
 * 以前直接把它当快照传给 readSnapshot，结果永远「读不到」。另外它要求 `turn >= 1`。
 */
async function readSnapshotAt(ctx, gameId, turn) {
  const safeTurn = Number.isInteger(turn) && turn >= 1 ? turn : 1
  const record = await ctx.tavern.readTurnData({ gameId, turn: safeTurn })
  const payload = record?.data

  // 酒馆里只存 `{ f, h }` 指针，内容在文件里。**不认旧格式**（一版没发过）。
  if (!payload || typeof payload.f !== 'string') {
    return readOrCreateSnapshot(null, safeTurn)
  }
  const at = Number.isInteger(record?.turn) ? record.turn : safeTurn
  const stored = store.readSnapshot(gameId, at)
  // 指针在、文件没了（被清理或手删）→ 当作这一轮没有快照，别崩
  return readOrCreateSnapshot(stored?.data, at)
}

/**
 * 「手动操作」该写到第几轮。
 *
 * 结算过就用 `updatedTurn`；**还没结算**（第一轮）时退回第 1 轮——
 * 平台按轮存数据，第 1 轮正文已经存在的话就能挂上去，第一轮结算时
 * `readSnapshotAt` 读到它，玩家改的东西不会丢。
 *
 * 连第 1 轮正文都没有（真空局）就返回 null，调用方给一句人话。
 * @returns {Promise<number|null>}
 */
async function editTurnOf(ctx, gameId, state) {
  const settled = state?.meta?.updatedTurn
  if (Number.isInteger(settled) && settled >= 1) return settled
  try {
    const first = await ctx.tavern.getTurn({ gameId, turn: 1 })
    if (first) return 1
  } catch {
    // 没有第 1 轮
  }
  return null
}

/** 调试日志最多留多少条。 */
const DEBUG_LOG_MAX = 100

/**
 * 往调试日志里塞一条。
 *
 * **常开**（2026-11-05）：原来的「显示调试窗口」开关从来没生效过——它读的是
 * `data.debug.enabled`，而设置实际存在 `data.settings.debug.enabled`，路径对不上，
 * 玩家点了等于没点，面板上永远显示"调试没打开"。日志本来也不占多少空间，干脆去掉开关、一直记。
 *
 * @param {object} state 整局数据
 * @param {'info'|'warn'|'error'} level
 * @param {string} message 人话描述
 * @param {any} [data] 附带的结构化数据（会原样显示在调试页）
 */

/** 消息 → 动作类型，界面按这个上色（不用在每个打点处写一遍）。 */
const DEBUG_KINDS = [
  [/结算开始/, 'settle'],
  [/MVU/, 'mvu'],
  [/判定/, 'judge'],
  [/被拒/, 'reject'],
  [/失败/, 'error'],
  [/值动作|写入|分组|没有要写入/, 'write'],
]

function debugKindOf(message) {
  const text = String(message ?? '')
  for (const [pattern, kind] of DEBUG_KINDS) {
    if (pattern.test(text)) return kind
  }
  return 'other'
}

function pushDebug(state, level, message, data = undefined) {
  if (!Array.isArray(state.debugLog)) state.debugLog = []
  state.debugLog.push({
    at: new Date().toISOString(),
    turn: Number.isInteger(state.meta?.updatedTurn) ? state.meta.updatedTurn : null,
    kind: debugKindOf(message),
    level,
    message,
    ...(data === undefined ? {} : { data }),
  })
  if (state.debugLog.length > DEBUG_LOG_MAX) {
    state.debugLog = state.debugLog.slice(-DEBUG_LOG_MAX)
  }
}

/**
 * 玩家称呼：**酒馆是唯一真相源**（issue #464 补的接口）。
 *
 * 三级兜底：
 *   1. `ctx.tavern.getPlayerName({ gameId })` —— 本局当前称呼（玩家可能改过，优先用它）
 *   2. 我们自己的按卡记录 —— 旧宿主没这个接口时用
 *   3. 空串 —— 都没有就不参与「拒建同名」，免得误伤
 */
async function resolvePlayerName(ctx, gameId, cardKey) {
  try {
    if (typeof ctx.tavern.getPlayerName === 'function') {
      const name = await ctx.tavern.getPlayerName({ gameId })
      // 称呼就是称呼：代词（「你」）也是玩家的真名，不许偷偷改掉——
      // 改了以后 `resolvePersonByName('你')` 就找不到主角，主视角的认知全被拒。
      if (typeof name === 'string' && name.trim()) return name.trim()
    }
  } catch {
    // 旧宿主、或本局还没初始化：走兜底
  }
  const identity = await readIdentity(ctx, cardKey)
  return identity.playerName
}

/**
 * 第一轮结算前我们还不知道 cardKey，身份只能按 gameId 存；
 * 结算后有了真 cardKey，要把那条记录挪过去，否则玩家刚填的称呼会"消失"。
 */
async function migrateIdentityKey(ctx, fromKeys, toKey) {
  const keys = (Array.isArray(fromKeys) ? fromKeys : []).filter((key) => key && key !== toKey)
  if (!keys.length) return
  try {
    const data = (await ctx.tavern.readPluginData()) ?? {}
    const map = data.identity ?? {}
    if (map[toKey]) return                     // 目标已有值，别覆盖玩家后来的选择
    let moved
    for (const key of keys) {
      if (map[key]) { moved = map[key]; delete map[key]; break }
    }
    if (!moved) return
    map[toKey] = moved
    data.identity = map
    await ctx.tavern.savePluginData({ data })
  } catch {
    // 挪不动就算了，不影响使用
  }
}

/** 身份设置（玩家称呼＋人称）：插件数据、按卡 id 分区（ADR 0054）。 */
async function readIdentity(ctx, cardKey) {
  try {
    const data = await ctx.tavern.readPluginData()
    return resolveIdentity(data?.identity?.[cardKey])
  } catch {
    return resolveIdentity(DEFAULT_IDENTITY)
  }
}

async function saveIdentity(ctx, cardKey, identity) {
  const data = (await ctx.tavern.readPluginData()) ?? {}
  data.identity = { ...(data.identity ?? {}), [cardKey]: identity }
  await ctx.tavern.savePluginData({ data })
}

/**
 * MVU 勾选表：**跟预设表放一起**（存整局数据的 state.mvuChecklist，ADR 0070）。
 * 不碰玩家的卡；想跟着卡走的人以后可以手动"存进卡里"。
 */
async function readChecklist(ctx, state) {
  return state?.mvuChecklist ?? {}
}

// ── 子代理（写回用）：一局一个、可 resume、任务排队 ──
// 接口形状照 narrative-anchor 验证过的写法（agents 从 ctx.get('agents') 取）。

const RESIDENT_IDLE_MS = 30 * 60 * 1000
const residents = new Map()   // gameId → { handle, agent, box, lastUsedAt }
let agentInfo = null          // 最近一次建/复用子代理时的模型信息，供调试窗口显示

/** 这一轮把动作放在哪儿——工具 execute 往里写，runPhase 读出来。 */
function freshBox() {
  return { payload: null, payloadMerged: false, submissions: [], viewpoint: '第二人称', playerName: '', systemTemplate: '', entriesText: '' }
}

/** 交卷工具说明共用一份：子代理档与后台成员档注册的是同一个契约（ADR 0092/0102）。 */
const SUBMIT_TOOL_DESCRIPTION = '提交本轮的动作。一次交一个对象：判人五块 {回头测试,建档,改状态,改名,模糊建档} + 命题数组 {命题:[{关于,栏目,值,认知}]} + 可选撤回块 撤回:[{谁,序号}]；本局有约定栏目时认知还要带约定字段，规则见系统提示词的「约定状态」段。没有要做的就交 {}。'

/**
 * 「这一轮查了几次」的账本（纯逻辑在 lib/queryBudget.js，见那里的说明）。
 * 每轮上限 2 次：不限制的话模型能连查十几次，把上下文预算吃光。
 */
const queryCounter = createQueryCounter()

/**
 * 拿到这一局的常驻子代理（没有就建）。
 * @returns {Promise<{agent:any, box:object, handle:any}|null>} 平台没有 agents 服务时返回 null
 */
async function ensureResident(ctx, gameId) {
  const agents = typeof ctx.get === 'function' ? ctx.get('agents') : null
  if (!agents || typeof agents.create !== 'function') return null
  const parent = agents.get?.(String(gameId))
  if (!parent) return null

  const existing = residents.get(gameId)
  if (existing) {
    existing.lastUsedAt = Date.now()
    return existing
  }

  const box = freshBox()
  const setup = (childCtx) => {
    childCtx.systemPrompt?.section?.({
      name: 'character-archives:prompt',
      order: 0,
      complete: true,
      text: () => fillTemplate(box.systemTemplate || defaultSystemPrompt(), { PERSON: box.viewpoint || '第二人称', PLAYER: box.playerName || '主角', ENTRIES: box.entriesText || entryLinesOf({}) }),
    })
    childCtx.tools?.register?.({
      name: 'char_archives_submit',
      description: SUBMIT_TOOL_DESCRIPTION,
      // 一次交一个对象：判人五块 + 命题数组（ADR 0092）。
      // schema 只约束到 object（工具入参不收顶层数组），具体形状由系统提示词的动作示例说清。
      parameters: {
        type: 'object',
        additionalProperties: true,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
      },
      async execute(args) {
        // 同一轮可能被调多次（模型分两次交）：**合并**，不许后交覆盖先交，
        // 否则先交的那半块会静默丢掉，/debug 里只剩「0 条动作」。
        // 每次提交原样留档（submissions），合并后出问题能看出分几次各交了什么。
        const incoming = args && typeof args === 'object' ? args : {}
        box.submissions = [...(box.submissions ?? []), incoming]
        if (box.payload != null) box.payloadMerged = true
        box.payload = { ...(box.payload ?? {}), ...incoming }
        return JSON.stringify({ ok: true })
      },
    })
  }

  const sessionId = `character-archives-${String(gameId).replace(/[^\w-]/g, '_')}`
  const meta = { parentSession: parent.id, origin: 'subagent', delegationDepth: 1 }

  // **必须传 agentOptions**：不指定 provider/model 的话，子代理拿到的可能是不支持工具的默认模型，
  // 于是它根本调不了 submit_actions —— 表现就是"子代理起来了但一句话都不报"。
  // 用酒馆「后台模型」的选择，和官方后台 Agent 保持一致。
  let agentOptions = null
  try {
    const bg = await ctx.tavern.backgroundModel?.({ gameId })
    if (bg?.provider && bg.model) {
      agentOptions = {
        provider: bg.provider,
        model: bg.model,
        ...(bg.reasoningEffort ? { reasoningEffort: bg.reasoningEffort } : {}),
      }
    }
  } catch {
    agentOptions = null
  }
  const optionsPart = agentOptions ? { agentOptions } : {}
  agentInfo = {
    hasOptions: Boolean(agentOptions),
    provider: agentOptions?.provider ?? null,
    model: agentOptions?.model ?? null,
    reasoningEffort: agentOptions?.reasoningEffort ?? null,
  }

  let handle = null
  if (typeof agents.resume === 'function') {
    try {
      handle = await agents.resume({ resumeSessionId: sessionId, ...optionsPart, setup })
    } catch {
      handle = null   // 会话不存在（新局 / 被清过）→ 往下走 create
    }
  }
  if (!handle) handle = await agents.create({ sessionId, meta, ...optionsPart, setup })

  const resident = { handle, agent: handle.agent, box, lastUsedAt: Date.now() }
  residents.set(gameId, resident)
  return resident
}

// 后台成员（ADR 0028 / 0094）：跟「书记」「润色师」同列，`background` 档用它跑结算。
const MEMBER_NAME = 'character-archives'
const MEMBER_TITLE = '档案员'
const memberBoxes = new Map()

/** 每局一个交卷盒（member 是常驻的，按 gameId 分开存）。 */
function memberBox(gameId) {
  const key = String(gameId ?? '')
  if (!memberBoxes.has(key)) memberBoxes.set(key, { payload: null, merged: false })
  return memberBoxes.get(key)
}

/** 成员用的交卷工具：契约跟子代理的 `char_archives_submit` 完全一样。 */
function submitToolSpec() {
  return {
    name: 'char_archives_submit',
    description: SUBMIT_TOOL_DESCRIPTION,
    parameters: { type: 'object', additionalProperties: true },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value ?? '') }],
    },
    // 宿主调插件工具时**只传 args**（`plugin-task-execution.js`：`tool.execute(structuredClone(args ?? {}))`），
    // 第二个参数永远是 undefined —— 交卷目标必须在派发前定好（ADR 0100、lib/memberBox.js）
    async execute(args) {
      return JSON.stringify(submitMemberPayload(args))
    },
  }
}

/**
 * 发一次素材、等它做完、把动作取回来。
 * @returns {Promise<{payload:any, merged:boolean}>} 拿不到（没有 agents 服务 / 出错）就返回空
 */
async function runPhase(ctx, gameId, promptText, { viewpoint = '第二人称', playerName = '', systemTemplate = '', entriesText = '', definitions = {}, mode = 'subagent', cognition = undefined } = {}) {
  // 动态上下文（视角／称呼／代词／栏目定义／认知口径／约定规则）每轮随工单发：成员的系统提示词是**固定**的（ADR 0095）
  const contextText = buildContextText({ viewpoint, playerName, entriesText, definitions, cognition })
  const taskText = `${contextText}\n\n${promptText}`

  // 跟随后台档：用 member 跑（跟书记/润色师同列），阻塞到出结果（ADR 0028）
  if (mode === 'background' && typeof ctx.tavern.runTask === 'function' && typeof ctx.tavern.member === 'function') {
    const box = memberBox(gameId)
    box.payload = null
    box.merged = false
    box.submissions = []
    // 派发前把「这一轮往哪只盒子交」定好：工具侧拿不到 gameId（见 lib/memberBox.js 的注释）
    beginMemberRun(box)
    try {
      await ctx.tavern.runTask({
        gameId,
        member: MEMBER_NAME,
        prompt: taskText,
      })
    } finally {
      endMemberRun(box)
    }
    return { payload: box.payload, merged: Boolean(box.merged), submissions: box.submissions }
  }

  const resident = await ensureResident(ctx, gameId)
  if (!resident) {
    // 这里是最容易被忽略的断点：平台没 agents 服务、或建子代理失败，都会静默返回 null
    ctx.tavern.log?.warn?.('人物档案馆：拿不到子代理，这一阶段跳过')
    return { payload: null, merged: false, submissions: [] }
  }

  resident.box.payload = null
  resident.box.payloadMerged = false
  resident.box.submissions = []
  resident.box.viewpoint = viewpoint
  resident.box.playerName = playerName
  resident.box.systemTemplate = systemTemplate || ''
  resident.box.entriesText = entriesText || entryLinesOf({})
  resident.agent.followup({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: taskText }],
    // ⚠️ 会话格式 v4 要求「producer-owned source kind」，写 'plugin' 会直接抛错
    source: { kind: 'plugin:character-archives' },
  })
  await resident.agent.whenIdle()
  return { payload: resident.box.payload, merged: Boolean(resident.box.payloadMerged), submissions: resident.box.submissions }
}

/** 释放在跑的子代理（删局 / 插件卸载时用）。 */
export function disposeResidents() {
  for (const [gameId, resident] of residents) {
    Promise.resolve()
      .then(() => resident.handle?.dispose?.())
      .catch(() => {})
    residents.delete(gameId)
  }
}

/**
 * 本轮正文里提到了哪些已建档人物（程序扫，不问模型，ADR 0032）。
 */
function findMentioned(persons, text) {
  const list = Array.isArray(persons) ? persons : []
  return list.filter((person) => {
    const subject = { name: person?.[2], aliases: person?.[3], clueWords: [] }
    const hit = matchText(text, subject, { bareSingleName: false })
    return hit.name || hit.alias || hit.singleName
  })
}

/**
 * 写回一轮：判定（人物级）→ 程序建档改状态 → 写入（值级）→ 校验落盘。
 * 每一步都只读/写内存里的 state 与 snapshot，最后由调用方统一 saveGameData。
 */
async function runWriteback(ctx, state, { gameId, turn, text, textVersion, settings, mvu = undefined }) {
  // 回退清理：回退后开始的新一轮，把「未来轮次」的旧快照挪进 trash。
  // 命题/指针就住在快照里，旧快照删掉它们自然没了；冷却表只对存在的指针生效，脏键无害。
  const rolled = store.pruneAfter(gameId, turn)
  if (rolled.removed.length) {
    pushDebug(state, 'info', `回退清理：删掉 ${rolled.removed.length} 份旧轮次快照`, { 轮次: rolled.removed.slice(0, 10) })
  }

  // trash 过期回收（P22③）：按设置的天数清掉文件名时间戳超龄的废文件（默认 15 天）。
  // 每轮都调，但 emptyTrash 扫一遍目录很快；没超龄的就什么都不做。
  try {
    const emptied = store.emptyTrash({ maxAgeDays: settings.storage?.trashMaxAgeDays })
    if (emptied.removed > 0) {
      pushDebug(state, 'info', `trash 清掉 ${emptied.removed} 个过期废文件`, { 释放: `${Math.round(emptied.freedBytes / 1024)} KB` })
    }
  } catch {
    // trash 清理失败不挡结算
  }

  // **第一轮没有快照是正常的**——读不到就从空册开始，否则第一份永远造不出来
  const { snapshot, bootstrapped } = await readSnapshotAt(ctx, gameId, turn)
  // 快照是复用的，轮次号要跟着当前轮走，否则面板上显示的是"第 2 轮"的老数据
  snapshot.t = Number.isInteger(turn) ? turn : snapshot.t

  // 这一轮什么都没变就别再存一份快照：省容量，也少一次写盘（M4-8 的前置）
  // 第一份快照必须写（bootstrapped），否则永远造不出来。
  const snapshotBefore = JSON.stringify(snapshot)
  const flushSnapshot = async () => {
    if (!bootstrapped && JSON.stringify(snapshot) === snapshotBefore) return false
    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion })
    return true
  }

  const definitions = state.entries ?? {}

  // ── ⓪ MVU 只落时间和地点（ADR 0005 / 0053）──
  // 2026-11-05：人物字段映射退役（ADR 0091）——以前按勾选表把 MVU 人物字段抄成条目/命题，
  // 现在一律由模型读正文写入；MVU 只兜底"程序自己抓不到的时间与地点"。
  // 顺序很重要：写在判定之前，模型这一轮就能看到刚抄进来的时间与地点。
  if (mvu?.ok) {
    if (mvu.gt) snapshot.gt = mvu.gt
    if (mvu.loc) snapshot.loc = mvu.loc
  }
  const definedCodes = Object.keys(definitions)
  const checkedCodes = Array.isArray(settings.checkedCodes)
    ? new Set(settings.checkedCodes)
    : new Set(definedCodes)
  // 身份按卡存（ADR 0054/0055）：玩家称呼决定「谁不该被建档」，人称决定提示词怎么写
  const identity = await readIdentity(ctx, String(state.meta?.cardKey ?? gameId))
  identity.playerName = await resolvePlayerName(ctx, gameId, String(state.meta?.cardKey ?? gameId))
  const viewpoint = personLabel(identity.person)
  const templates = await readPrompts(ctx)

  // 主角常驻（ADR 0085）：**必须在建素材和写回之前**就把 p0 建出来。
  // 以前只在写入之后 ensure，于是这一轮素材里没有主角，
  // 模型报「谁＝主角名」的认知一律被判「人物不在档案里」，整条动作被拒（ADR 0101）。
  // 轮末那次 ensure 仍然保留：模型可能本轮给他改名或改状态，要在收尾时再同步一次。
  const playerAtStart = ensurePlayer(snapshot.p, {
    name: identity.playerName,
    alwaysPresent: identity.person !== 'third',
  })
  snapshot.p = playerAtStart.persons

  // 跨局专名词库（ADR 0077）：每轮读一次，既喂给分词，也承接本轮新收的专名
  let globalWords = store.readGlobalWords()

  // 匹配之前先同步用户词典（人名优先成词）
  syncUserWords(snapshot, state.flags?.draft, globalWordList(globalWords))

  // 程序扫本轮正文：谁被提到（不问模型，ADR 0032）
  const mentioned = findMentioned(snapshot.p, text)
  const mentionedIds = new Set(mentioned.map((person) => person[0]))



  // ── ① 判定 ──
  // 模糊建档：**程序扫是主路径**（ADR 0036）——只把「本轮真的出现」的列进素材。
  // 整张表可能有几百个名字，全塞过去会让模型"看谁都像"（ADR 0033 同一个毛病）。
  const draftTable = state.flags?.draft ?? {}
  const draftHits = scanDraft(draftTable, text)
  const draftForPrompt = Object.fromEntries(draftHits.map((name) => [name, draftTable[name]]))

  // 锁住的人（🔒）：模型压根不该知道有这么个人——判定素材与写入素材都剔掉（ADR 0038 / 0089）
  const lockedIds = new Set(
    Object.keys(state.flags?.lock ?? {}).filter((id) => state.flags.lock[id] === true),
  )
  // 合并素材（ADR 0092）：判人 + 写入一次发出去——后台结算档每轮只能发一次消息。
  // 写入素材用「判人前」的在场名单；刚建档的人素材里没有，但模型自己知道刚建了谁。
  const presentBefore = new Set(
    snapshot.p
      .filter((person) => {
        const id = person?.[0]
        if (state.flags?.lock?.[id]) return false
        return person[1] === STATUS.PRESENT
      })
      .map((person) => person[0]),
  )
  const mentionedOnlyBefore = new Set(
    mentioned.map((person) => person[0]).filter((id) => !presentBefore.has(id)),
  )
  const materialBefore = buildWriteMaterial({
    snapshot,
    presentIds: presentBefore,
    mentionedIds: mentionedOnlyBefore,
    checkedCodes,
    hitWords: new Set(),
    turn,
    locked: lockedIds,
  })
  const phase = await runPhase(ctx, gameId, buildCombinedPrompt({
    gt: snapshot.gt,
    loc: snapshot.loc,
    mentioned: mentioned
      .filter((person) => !lockedIds.has(person[0]))
      .map((person) => ({ id: person[0], name: person[2], status: person[1] })),
    draft: draftForPrompt,
    body: text,
    people: materialBefore.people,
    mentionedPeople: materialBefore.mentioned,
    definitions,
    checkedCodes,
    textOf: (claim) => decodeValue(claim[3], state.dict),
    nameOf: (id) => String(snapshot.p.find((item) => item?.[0] === id)?.[2] ?? ''),
    askPlace: !String(snapshot.loc ?? '').trim(),
    writeTemplate: templates.write,
  }), { viewpoint, playerName: identity.playerName, systemTemplate: templates.system, entriesText: entryLinesOf(state.entries ?? {}), definitions: state.entries ?? {}, mode: settings.writeback?.mode, cognition: settings.cognition })
  if (phase.merged) {
    pushDebug(state, 'warn', '模型分多次提交，已合并为一个对象', {
      各次提交: Array.isArray(phase.submissions) ? phase.submissions.map((one) => String(JSON.stringify(one ?? {})).slice(0, 600)) : null,
    })
  }
  const combinedPayload = phase.payload
  const judgePayload = combinedPayload

  const deletedBlocked = judgePayload
    ? filterDeletedPersonActions(parseJudgePayload(judgePayload), store.readDeleted(gameId))
    : { kept: null, blocked: [] }
  const judgeActions = judgePayload ? deletedBlocked.kept : null
  if (deletedBlocked.blocked.length) {
    ctx.tavern.log?.info?.('人物档案馆：已删除的人不再建档', deletedBlocked.blocked.map((item) => item.姓名))
  }
  // 模型常把「回头测试·通过」当成已建档（只写通过名单、不写 `建档`）——
  // 记一条日志，/debug 里一眼能看出「为什么这个人没进档案」。
  const passedNoBuild = passedWithoutBuild(judgeActions)
  if (passedNoBuild.length) {
    pushDebug(state, 'warn', `回头测试通过但没报建档 ${passedNoBuild.length} 人`, {
      名单: passedNoBuild.slice(0, 5),
    })
  }
  pushDebug(state, judgePayload ? 'info' : 'warn',
    judgeActions ? `判定阶段返回 ${judgeActions.length} 条动作` : '判定阶段没返回动作（子代理不可用或没调 submit_actions）',
    {
      扫到已建档人物: mentioned.length,
      // 交卷次数是「模型到底调没调交卷工具」的唯一线索：0 次＝模型没交，
      // >0 次却还空＝程序侧读错了盒子（ADR 0100 就是这种）
      交卷次数: Array.isArray(phase.submissions) ? phase.submissions.length : 0,
      动作数: Array.isArray(judgeActions) ? judgeActions.length : null,
      原始: Array.isArray(judgeActions) ? judgeActions.slice(0, 5) : null,
      子代理: agentInfo,
    })

  let createdIds = []
  if (judgeActions) {
    const { valid, rejected } = validatePersonActions(judgeActions, {
      persons: snapshot.p,
      draft: state.flags?.draft ?? {},
      mainNames: identity.playerName ? [identity.playerName] : [],
      body: text,   // 层 1：名字必须在本轮正文里原样出现（ADR 0067）
      requireLook: true,   // 回头测试必须表态（ADR 0062）
      person: identity.person,   // 第二人称下「你」认成主角本人
    })
    // 人物级动作被拒的原因一定要记下来：不然"为什么没建档"只能靠猜
    if (rejected?.length) {
      pushDebug(state, 'warn', `人物动作被拒 ${rejected.length} 条`, {
        前几条: rejected.slice(0, 5).map((item) => ({ 原因: item.reason, 动作: item.action })),
      })
    }
    let counter = Number.isInteger(state.nextId) ? state.nextId : createIdCounter()
    const applied = applyPersonActions(snapshot.p, valid, {
      turn,
      takeId: () => {
        const next = takePersonId(counter)
        counter = next.next
        return next.id
      },
    })
    snapshot.p = applied.persons
    state.nextId = counter
    createdIds = applied.created

    // 模型给主角改了名：写回身份设置。不写的话下一轮 ensurePlayer 会把名字同步回旧称呼。
    const playerRename = valid.find((item) => item?.type === 'rename' && item.id === PLAYER_ID)
    if (playerRename) {
      await saveIdentity(ctx, String(state.meta?.cardKey ?? gameId), {
        ...identity,
        playerName: playerRename.name,
      })
    }

    if (Object.keys(applied.draft).length) {
      state.flags.draft = { ...(state.flags?.draft ?? {}), ...applied.draft }
    }
    // 刚建档的人要从模糊建档表里摘掉，否则同一人同时出现在两段素材里，
    // 模型会当成两个人、反复报「建档」（ADR 0036 的卫生工作）
    if (createdIds.length) {
      const pruned = pruneDraft(state.flags?.draft ?? {}, snapshot.p)
      state.flags.draft = pruned.draft
      if (pruned.removed.length) {
        ctx.tavern.log?.info?.(`人物档案馆：建档后从模糊建档表摘掉 ${pruned.removed.join('、')}`)
      }
    }
    // 状态变更 → 写/清离场记录（ADR 0025）
    for (const action of valid) {
      if (action.type !== 'status') continue
      state.flags.left = action.status === STATUS.OFFLINE
        ? setLeft(state.flags.left, action.id, turn, snapshot.gt)
        : dropLeft(state.flags.left, action.id)
    }
  }

  // ── 模糊建档候选过期清理（ADR 0075）──
  // 放在这里：刚建档的人已经摘出去了，本轮新入表的人也已经在表里（时间戳＝当前轮，
  // 差 0 轮，不会被清）。判定阶段失败也照样清理——露没露面是程序算的，跟模型无关。
  {
    const { draft: kept, removed, touched } = expireDraft(state.flags?.draft ?? {}, {
      hits: draftHits,
      turn,
      maxIdle: settings?.draft?.maxIdleTurns,
    })
    // 只有真的变了才回写，否则每轮都把快照标脏、白多写一次盘
    if (removed.length || touched.length) state.flags.draft = kept
    if (removed.length) {
      const idle = settings?.draft?.maxIdleTurns ?? DEFAULT_MAX_IDLE
      ctx.tavern.log?.info?.(`人物档案馆：模糊建档候选太久没露面，清掉 ${removed.join('、')}`)
      pushDebug(state, 'info', `模糊建档候选清掉 ${removed.length} 个（连续 ${idle} 轮没露面）`, {
        名单: removed.slice(0, 10),
      })
    }
  }

  // ── ② 写入：本轮在场的人（含刚建档），锁住的不列（ADR 0038）──
  // 命题 + 指针模型下，**只有在场的人才能获得新认知**（ADR 0083 阶段二）；
  // 被提到但不在场的人只把现有命题摆出来给模型复用，不给他们建指针。
  const createdSet = new Set(createdIds)
  const presentIds = new Set(
    snapshot.p
      .filter((person) => {
        const id = person?.[0]
        if (state.flags?.lock?.[id]) return false
        return person[1] === STATUS.PRESENT || createdSet.has(id)
      })
      .map((person) => person[0]),
  )
  const mentionedOnlyIds = new Set(mentioned.map((person) => person[0]).filter((id) => !presentIds.has(id)))
  if (!presentIds.size && !mentionedOnlyIds.size) {
    pushDebug(state, 'warn', '本轮没有可写入的人，跳过写入应用', {
      新建: createdIds.length,
      扫到已建档人物: mentioned.length,
    })
    // 主角先落盘再跳过：否则空局（第一轮没人可写）主角只活在面板的临时显示里，
    // 要再等一轮才真正进快照——回退到第 1 轮还会读到空册（ADR 0085 的「保证存在」应不受出口影响）
    const emptyTurnPlayer = ensurePlayer(snapshot.p, {
      name: identity.playerName,
      alwaysPresent: identity.person !== 'third',
    })
    snapshot.p = emptyTurnPlayer.persons
    await flushSnapshot()
    return
  }

  state.debugWriteback = {
    at: new Date().toISOString(),
    turn,
    mentioned: mentioned.length,
    judgeActions: Array.isArray(judgeActions) ? judgeActions.length : null,
    created: createdIds.length,
    targets: presentIds.size,
    draftHits: draftHits.length,
  }

  // 素材已经在判人前发过（materialBefore）；写入解析用同一次返回的 payload（ADR 0092）
  const material = materialBefore
  const writePayload = combinedPayload

  const writeBundle = writePayload ? parseWritePayloadBundle(writePayload) : { actions: null, place: '' }
  const valueActions = writeBundle.actions

  // 当前地点三路：MVU 已有就用；否则模型报的；再否则从正文抓——**只认本局已有的地类索引词**
  if (!String(snapshot.loc ?? '').trim()) {
    const place = resolvePlace({
      modelLoc: writeBundle.place,
      text,
      known: knownPlaces(snapshot),
    })
    if (place) snapshot.loc = place
  }

  // 把模型报的值动作原样记下来：值校验全拒绝时，这是唯一能看到"它到底写了什么"的地方。
  // **载荷**存的是解析前的原始形状——光看 valueActions 分不清「模型主动交空」和「交了对象被读成空」。
  pushDebug(state, 'info', writePayload ? `写入阶段返回 ${valueActions.length} 条值动作` : '写入阶段没返回动作', {
    载荷形状: Array.isArray(writePayload) ? 'array' : (writePayload && typeof writePayload === 'object' ? 'object' : typeof writePayload),
    载荷: writePayload == null ? null : String(JSON.stringify(writePayload)).slice(0, 2000),
    原始: Array.isArray(valueActions) ? valueActions.slice(0, 8) : null,
  })

  if (valueActions) {
    const result = applyWriteActions({
      snapshot,
      actions: valueActions,
      seqMap: material.seqMap,
      definitions,
      turn,
      gt: snapshot.gt ?? '',   // 来源组要记「听到时的游戏时间」（ADR 0086）
      resolvePerson: (name) => resolvePersonRef(snapshot.p, name, { person: identity.person }),
      allowedIds: presentIds,
      // 一条指针最多挂几组「别人说的」，由设置决定（P20）
      maxOtherSources: settings?.cognition?.maxOtherSources,
    })

    state.debugWriteback.writeActions = Array.isArray(valueActions) ? valueActions.length : null
    state.debugWriteback.bad = result.bad.length
    pushDebug(state, 'info', '值动作应用完成', { 命题: result.applied.length, 拒绝: result.bad.length })

    // 拒绝原因一定要记：模型报了动作却一条都没落盘时，这里是唯一线索
    if (result.bad.length) {
      ctx.tavern.log?.warn?.(`人物档案馆：本轮丢弃 ${result.bad.length} 条动作`, result.bad.map((item) => item.reason))
      pushDebug(state, 'warn', `写入动作被拒 ${result.bad.length} 条`, {
        前几条: result.bad.slice(0, 5).map((item) => ({ 原因: item.reason, 动作: item.action })),
        可用的栏目: Object.values(definitions).map((item) => item?.name).filter(Boolean),
      })
    }

    // 索引词跟着命题走（ADR 0081）：挑其中的**专名**收进跨局词库（ADR 0077）
    const nouns = []
    for (const claim of result.applied) {
      const words = wordsOfClaim(claim)
      if (words.length) nouns.push(...properNounsOf(words))
    }
    if (nouns.length) {
      globalWords = addGlobalWords(globalWords, nouns, turn).store
      store.writeGlobalWords(globalWords)
      // 新词立刻让分词认识：不重灌的话，本轮刚写进去的值要到下一轮才分得准
      syncUserWords(snapshot, state.flags?.draft, globalWordList(globalWords))
      pushDebug(state, 'info', '跨局专名词库已更新', { 词条数: globalWordList(globalWords).length })
    }
  }

  // ── ③ 撤回（ADR 0102）：模型说「这个人不再这么认为了」──
  // 排在写入之后：写入可能用 `序号` 复用旧命题，撤回先把旧命题删了会让那些序号失效。
  const retracts = Array.isArray(writeBundle?.retracts) ? writeBundle.retracts : []
  if (retracts.length) {
    const retraction = applyRetractions({
      snapshot,
      retracts,
      seqMap: material.seqMap,
      resolvePerson: (name) => resolvePersonRef(snapshot.p, name, { person: identity.person }),
      allowedIds: presentIds,
    })
    if (retraction.applied.length) {
      const nameOfId = (id) => String(snapshot.p.find((person) => person?.[0] === id)?.[2] ?? id ?? '?')
      pushDebug(state, 'info', `撤回 ${retraction.applied.length} 条认知`, {
        // 谁 → 关于谁 · 命题内容：命题说的是谁由程序按序号查（ADR 0106），
        // 模型只报「谁＋序号」。这样调试里能一眼看出撤掉的是谁的哪条认知。
        明细: retraction.applied.slice(0, 8).map((item) => ({
          谁: nameOfId(item.personId),
          关于: nameOfId(item.aboutId),
          命题: decodeValue(item.claimText, state.dict),
          连带清掉命题: item.droppedClaim,
        })),
      })
    }
    if (retraction.bad.length) {
      ctx.tavern.log?.warn?.('人物档案馆：撤回被拒', retraction.bad.map((item) => item.reason))
      pushDebug(state, 'warn', `撤回被拒 ${retraction.bad.length} 条`, {
        前几条: retraction.bad.slice(0, 5).map((item) => ({ 原因: item.reason, 动作: item.item })),
      })
    }
  }

  // 主角「离场 → 在场」是唯一一次全量注入的触发（ADR 0085）：这里记下写入前的状态
  const playerBefore = snapshot.p.find((item) => Array.isArray(item) && item[0] === PLAYER_ID)
  const playerWasOffline = Boolean(playerBefore && playerBefore[1] === STATUS.OFFLINE)

  // 主角常驻档案（ADR 0085）：保证 p0 在、名字跟玩家称呼同步；
  // 一/二人称下强制在场——模型报过离场也会被拉回来（主角就是视角，不能走）。
  const playerState = ensurePlayer(snapshot.p, {
    name: identity.playerName,
    alwaysPresent: identity.person !== 'third',
  })
  snapshot.p = playerState.persons

  // 三人称下主角从离场变在场 → 下一轮召回全量注入一次（ADR 0085）
  const playerAfter = snapshot.p.find((item) => Array.isArray(item) && item[0] === PLAYER_ID)
  if (playerWasOffline && playerAfter && playerAfter[1] === STATUS.PRESENT) {
    state.flags.playerBack = { turn, gt: snapshot.gt }
  }

  // 最后确认轮次（ADR 0039）：本轮在场上、或被正文提到的人，都刷新到当前轮。
  // 同一份数据喂两个功能：模糊离场判定 + 面板「冷档」（沉降）。
  state.flags.seen = markSeen(state.flags.seen, [...presentIds, ...mentionedIds], turn)

  // 模糊离场（ADR 0030）：连续 N 轮没出现、这轮又不在场上 → 判离场，并记离场时间
  const fuzzyTurns = Number.isInteger(settings?.firstExit?.fuzzyTurns) ? settings.firstExit.fuzzyTurns : 3
  const fuzzyIds = fuzzyLeaveIds(snapshot.p, {
    seen: state.flags.seen,
    presentIds,
    turn,
    turns: fuzzyTurns,
  })
  for (const id of fuzzyIds) {
    const person = snapshot.p.find((item) => Array.isArray(item) && item[0] === id)
    if (person) person[1] = STATUS.OFFLINE
    state.flags.left = setLeft(state.flags.left, id, turn, snapshot.gt)
    // 记一笔「这是程序按轮次判的离场」——面板据此显示「模糊离场」标签
    state.flags.fuzzyLeft = { ...(state.flags.fuzzyLeft ?? {}), [id]: turn }
  }

  // 孤儿命题清理（P22②）：零指针的命题永远召不回、面板也看不见，摘掉（本轮新建的豁免）。
  // 摘了会让快照变化 → flushSnapshot 自然落盘，不需要额外标记。
  const orphans = pruneOrphanClaims(snapshot.c ?? [], snapshot.pt ?? [], { turn })
  if (orphans.removed.length) {
    snapshot.c = (snapshot.c ?? []).filter((claim) => !orphans.removed.includes(claim?.[0]))
    pushDebug(state, 'info', `孤儿命题清掉 ${orphans.removed.length} 条`, { id: orphans.removed.slice(0, 10) })
  }

  await flushSnapshot()
}

/**
 * 读三种作用域的设置并合并（ADR 0072）。
 *
 * 定义在模块级而不是 `apply()` 里：`saveSnapshot` 这类不在 apply 内的函数也要读设置
 * （快照保留轮数是玩家可调的）。
 */
async function readScopedSettings(ctx, state) {
  const cardKey = String(state?.meta?.cardKey ?? '')
  let globalPart = {}
  let cardPart = {}
  try {
    const data = await ctx.tavern.readPluginData()
    globalPart = data?.settings ?? {}
    cardPart = (cardKey && data?.settingsByCard?.[cardKey]) || {}
  } catch {
    globalPart = {}
    cardPart = {}
  }
  const gamePart = state?.settings ?? {}
  return mergeSettings({ global: globalPart, card: cardPart, game: gamePart })
}

/**
 * 这一轮**当前显示**的正文版本。
 *
 * 手动操作（建人／改状态／改名／改认知…）都发生在结算之后，用 `readTurnData` 读回来的是
 * **我们自己上次存的那份**——玩家重新生成、编辑过正文后它就过期了，再拿去 `saveTurnData`
 * 会报「textVersion 不是这一轮当前显示的正文版本」。`getTurn` 给的才是当前版本。
 *
 * 拿不到就返回 undefined（= 省略这个参数），平台会自己挂到当前版本上。
 */
async function currentTextVersion(ctx, gameId, turn) {
  try {
    const current = await ctx.tavern.getTurn({ gameId, turn })
    return current?.textVersion
  } catch {
    return undefined
  }
}

/** 快照落盘：唯一落盘点（§10.3）。 */
async function saveSnapshot(ctx, { gameId, turn, snapshot, textVersion }) {
  // 内容写文件，酒馆里只存 `{ f, h }` 指针 —— 回退时酒馆会丢掉旧指针，版本正确性照旧
  const pointer = store.writeSnapshot(gameId, { turn, key: textVersion ?? '', data: snapshot })
  await ctx.tavern.saveTurnData({ gameId, turn, data: pointer, textVersion })

  // 写完顺手剪枝：窗口外的挪进 trash（不硬删）。
  // 保留轮数是玩家可调的（默认 200、100～1000）；读不到设置就用默认值，不能因此不剪。
  let keepTurns = DEFAULT_KEEP_TURNS
  try {
    const state = await loadGameState(ctx.tavern, gameId)
    const settings = resolveSettings(await readScopedSettings(ctx, state))
    const wanted = settings.storage?.keepTurns
    if (Number.isInteger(wanted)) keepTurns = wanted
  } catch {
    keepTurns = DEFAULT_KEEP_TURNS
  }
  try {
    store.pruneSnapshots(gameId, { keepTurns, currentTurn: turn })
  } catch {
    // 剪枝失败不影响这一轮
  }
}

// 后台成员的注册与重挂。
// 宿主把 `system` 存成成员前缀（background-members.js:52-55），同名再注册会直接抛
// 「成员 已注册」（:51）——所以想换前缀，只能先卸掉再挂一次。
// 换完**下一轮结算就生效**（既有会话也算）：前缀不是烙进会话的，宿主的系统提示词段是
// 组装时现取的函数（background-agent-task.js:165-175 读 state.input.system），而每次派发都会
// 重读注册表并覆盖 state.input（domain/plugin-task-execution.js:74、93；background-agent-sessions.js:309）。
// 代价只是提供方的提示词缓存失效一次。
let memberDispose = null
let memberSystem = ''
// 每次真正换前缀就 +1：apply 里那次异步读盘要拿它比对，晚到的旧文本不能盖回玩家刚存的那份
let memberSeq = 0

/** 把后台成员的前缀换成 `system`；成功（或无需换）返回 true。 */
function mountMember(ctx, system) {
  if (typeof ctx?.tavern?.member !== 'function') return true
  const text = String(system ?? '').trim() || defaultSystemPrompt()
  // 文本没变就不折腾：每次重挂都会让宿主的模型缓存从头再来一遍
  if (memberDispose && text === memberSystem) return true
  const previousText = memberSystem
  const hadMember = Boolean(memberDispose)
  memberSeq += 1
  try {
    if (memberDispose) {
      memberDispose()
      memberDispose = null
    }
    memberDispose = ctx.tavern.member({
      name: MEMBER_NAME,
      title: MEMBER_TITLE,
      system: text,
      tools: [submitToolSpec()],
    })
    memberSystem = text
    return true
  } catch (error) {
    const reason = String(error?.message || error)
    // 卸掉旧的、新的又没挂上 = 成员凭空消失：派发时宿主会直接报「没有注册成员 档案员」，
    // 后台写回整档失效。所以失败时把上一次的文本挂回去——宁可继续用旧的，也不能没有。
    ctx.tavern.log?.warn?.('人物档案馆：注册后台成员失败', { 原因: reason, 字数: [...text].length })
    if (hadMember && previousText) {
      try {
        memberDispose = ctx.tavern.member({
          name: MEMBER_NAME,
          title: MEMBER_TITLE,
          system: previousText,
          tools: [submitToolSpec()],
        })
        memberSystem = previousText
      } catch (rollbackError) {
        ctx.tavern.log?.warn?.('人物档案馆：把旧的提示词挂回成员也没成功', rollbackError)
      }
    }
    return false
  }
}

export function apply(ctx) {
  if (ctx.tavern.apiVersion < 2) return

  // 后台成员「档案员」：跟「书记」「润色师」同列，`background` 档用它跑结算（ADR 0028）
  // ⚠️ 宿主规定：带 tools 就必须带 system（plugin-api.js:1080），否则直接抛错、注册不上。
  mountMember(ctx, defaultSystemPrompt())
  // 面板里那份（插件数据能覆盖 txt）才是玩家看到的：读到之后按它再挂一次，
  // 面板显示的和成员念的才是同一句话。文本一样时 mountMember 内部会跳过，不会白挂。
  // 序号校验：读盘期间玩家可能刚在面板存了新文本，晚到的旧文本不许盖回去。
  const seqAtStart = memberSeq
  readPrompts(ctx)
    .then((templates) => {
      if (memberSeq !== seqAtStart) return
      if (templates?.system) mountMember(ctx, templates.system)
    })
    .catch(() => {})

  // ── 正文模型的查档案工具（ADR 0089 §9）──
  // 用 DSH 的 tools 服务注册，再 `toolModes(['play'])` 限定只出现在「写正文」的请求里。
  // gameId 从 `execution.sessionId` 拿（官方口径：gameId ＝ DSH 会话编号）；
  // `activeGameId` 只是兜底——turnSection 每次跑的时候顺手记一下。
  if (typeof ctx.tools?.register === 'function') {
    const dispose = ctx.tools.register({
      name: 'archive_query',
      description: [
        '查人物档案：按名字拉出这个角色「知道的事」（他知道什么、信不信、听谁说的）。',
        '',
        '什么时候用：',
        '· 要写某个已建档人物的台词或反应，但不确定他知不知道最近发生的事 → 查他',
        '· 要写「他还记得吗」「他知不知道」这类情节 → 查他',
        '· 他离场很久、你不太记得他的近况 → 查他',
        '· 发现自己正在猜「这个人应该知道吧」→ 别猜，查一下',
        '',
        '不用查：他就在场且上一轮刚聊过他的事；或者你只是想确认他叫什么。',
        '每一轮最多查 2 次，第 3 次会被拒绝——先挑最需要的那两个人。',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          姓名: {
            type: 'string',
            description: '要查的人：用正文里怎么叫他（姓名或别名）。重名时程序不猜，会直接说找不到。',
          },
          档位: {
            type: 'string',
            enum: ['全量', '详细', '简单'],
            description: '给多少：全量＝所有认知（连冷却里的一起给）；详细＝冷却外的，带态度/来源/时间；简单＝冷却外的，只要内容。留空就用设置里的默认档位。',
          },
        },
        required: ['姓名'],
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value ?? '') }] },
      async execute(args, execution) {
        try {
          const gameId = String(execution?.sessionId ?? activeGameId ?? '')
          if (!gameId) return '现在没有打开的局，查不了档案。'
          const state = await loadGameState(ctx.tavern, gameId)
          const settings = resolveSettings(await readScopedSettings(ctx, state))
          if (settings.recall?.modelQueryTool === false) return '这一局关掉了「让正文模型查档案」。'

          const turn = state.meta?.updatedTurn
          if (!Number.isInteger(turn)) return '这一局还没结算过，档案还没建起来。'

          // 每轮最多查 2 次：先记账再查，超了直接回一句人话（静默失败会让模型以为查到了）
          if (!queryCounter.take(gameId, turn)) {
            return `这一轮已经查过 ${queryCounter.limit} 次档案了，查得太频繁。先用已经拿到的信息写，下一轮再查。`
          }
          const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

          const level = normalizeLevel(args?.档位, normalizeLevel(settings.recall?.queryLevel, 'detailed'))
          const result = queryPerson({
            snapshot,
            name: args?.姓名,
            level,
            cooldowns: state.cooldowns ?? {},
            cooldownTurns: settings.recall?.cooldownOn ? settings.recall?.cooldownTurns : 0,
            turn,
            cognition: settings.cognition,
          })
          if (!result.ok) return result.reason

          const turns = settings.recall?.cooldownOn ? settings.recall?.cooldownTurns : 0
          if (turns > 0 && result.pointers.length) {
            const next = { ...(state.cooldowns ?? {}) }
            for (const pointer of result.pointers) {
              next[pointerKey(pointer[0], pointer[1])] = { lastTurn: turn, until: turn + turns }
            }
            state.cooldowns = next
            await saveGameState(ctx, gameId, state)
          }
          return result.text
        } catch (error) {
          return '查档案出错：' + String(error?.message || error)
        }
      },
    })
    if (typeof ctx.tavern.toolModes === 'function') {
      ctx.tavern.toolModes({ name: 'archive_query', modes: ['play'] })
    }
    if (typeof dispose === 'function' && typeof ctx.effect === 'function') ctx.effect(() => dispose)
  }

  // ── 召回注入（正文生成前，落后一轮）──
  // 规则见 ADR 0082 / 0085 / 0086 / 0087 / 0089；纯逻辑在 lib/recallEngine.js。
  ctx.tavern.turnSection({
    // ⚠️ name 必须过 SECTION_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/ —— 中文会直接抛错，插件起不来
    name: 'character-archives',
    text: async ({ gameId, turn, input }) => {
      try {
        activeGameId = String(gameId ?? '')
        const state = await loadGameState(ctx.tavern, gameId)
        const parsed = await readSnapshotAt(ctx, gameId, turn)
        if (parsed.bootstrapped) return ''
        const snapshot = parsed.snapshot
        const settings = resolveSettings(await readScopedSettings(ctx, state))
        const identity = await readIdentity(ctx, String(state.meta?.cardKey ?? gameId))

        const checkedCodes = Array.isArray(settings.checkedCodes)
          ? new Set(settings.checkedCodes)
          : new Set(Object.keys(state.entries ?? {}))

        const result = buildRecallSection({
          snapshot,
          turn,
          definitions: state.entries ?? {},
          checkedCodes,
          hidden: new Set(Object.keys(state.flags?.hidden ?? {}).filter((id) => state.flags.hidden[id])),
          starIds: new Set(Object.keys(state.flags?.star ?? {}).filter((id) => state.flags.star[id])),
          cooldowns: state.cooldowns ?? {},
          cooldownTurns: settings.recall?.cooldownOn ? settings.recall?.cooldownTurns : 0,
          budget: settings.recall?.budgetChars,
          playerBack: state.flags?.playerBack ?? null,
          viewpoint: personLabel(identity.person),
          text: String(input ?? ''),
          template: templates.recall,
          cognition: settings.cognition,
          deletedNames: new Set(
            (store.readDeleted(gameId) ?? []).map((item) => String(item?.name ?? '').trim()).filter(Boolean),
          ),
        })

        // 自动召回真给出去的指针：① 这一轮要盖章，② 手动召回要避开（同一轮别重复塞）
        const autoPointers = Array.isArray(result.pointers) ? result.pointers : []
        const givenKeys = new Set(autoPointers.map((pointer) => pointerKey(pointer[0], pointer[1])))

        // 面板上点过「召回」的人（ADR 0089 补充）：这一段拼在自动召回后面。
        // 盖章放在这里而不是点击时——没真注入就别占冷却。
        const pending = Array.isArray(state.flags?.pendingRecall) ? state.flags.pendingRecall : []
        const manual = pending.length
          ? buildPendingRecallText({
              snapshot,
              pending,
              cooldowns: state.cooldowns ?? {},
              cooldownTurns: settings.recall?.cooldownOn ? settings.recall?.cooldownTurns : 0,
              turn,
              skip: givenKeys,
              cognition: settings.cognition,
            })
          : { text: '', stamps: [], done: [] }

        // 一次保存搞定所有盖章（自动召回 + 主角回场 + 手动召回），别写几遍盘。
        // 顺带清掉已到期的记录：冷却表只进不出会一直涨（`pruneExpired` 之前从没被调用过）。
        const previousCooldowns = state.cooldowns ?? {}
        const cooldownWrite = pruneExpired(previousCooldowns, turn)
        let dirty = Object.keys(cooldownWrite).length !== Object.keys(previousCooldowns).length
        const turnsForStamp = settings.recall?.cooldownOn ? settings.recall?.cooldownTurns : 0
        const stamp = (list) => {
          if (!(turnsForStamp > 0)) return
          for (const pointer of list) {
            cooldownWrite[pointerKey(pointer[0], pointer[1])] = { lastTurn: turn, until: turn + turnsForStamp }
          }
        }

        // 自动召回（含主角回场段）：给出去的就盖召回章——「刚念叨过的人歇几轮」（2026-11-05 补）
        if (autoPointers.length) {
          stamp(autoPointers)
          dirty = true
        }

        // 主角回场标记用完就清，不管装没装进去（不然每轮都会重试一遍全量）
        if (state.flags?.playerBack) {
          delete state.flags.playerBack
          dirty = true
        }

        // 手动召回：注入了才盖章；处理过的人一律出队（含没内容的，别让队列烂在那儿）
        if (manual.done.length) {
          stamp(manual.stamps)
          const rest = pending.filter((item) => !manual.done.includes(String(item?.personId ?? '').trim()))
          if (rest.length) state.flags.pendingRecall = rest
          else delete state.flags.pendingRecall
          dirty = true
        }

        if (dirty) {
          state.cooldowns = cooldownWrite
          // 存盘失败只影响"下次会不会重复给"，绝不能把这一轮的档案一起丢掉（review 抓到的）
          try {
            await saveGameState(ctx, gameId, state)
          } catch (error) {
            ctx.tavern.log?.warn?.('人物档案馆：召回盖章没存上', error)
          }
        }

        const pieces = [result.text, manual.text].filter((piece) => String(piece ?? '').trim())
        return pieces.join('\n\n')
      } catch (error) {
        // turnSection 出错只该让这一段缺席，绝不能影响正文生成
        ctx.tavern.log?.warn?.('人物档案馆：召回注入失败', error)
        return ''
      }
    },
  })

  // 每轮结算完成后：判定 → 建档改状态 → 写入 → 落盘（§10.1、ADR 0029）
  ctx.tavern.onTurnSettled(async (event) => {
    const { gameId, turn, text, textVersion } = event
    const state = await loadGameState(ctx.tavern, gameId)
    pushDebug(state, 'info', `第 ${turn} 轮结算开始`, { 正文字数: String(text ?? '').length, textVersion })
    state.meta.updatedTurn = turn
    state.meta.updatedAt = new Date().toISOString()

    // 有待导入的人物册：导入时拿不到 textVersion，攒到这一轮落盘（ADR 0050）
    if (state.pendingImport) {
      const plan = state.pendingImport
      await saveSnapshot(ctx, {
        gameId,
        turn,
        snapshot: { v: SNAPSHOT_VERSION, t: turn, gt: plan.gt ?? '', p: plan.persons ?? [] },
        textVersion,
      })
      delete state.pendingImport
    }

    const settings = resolveSettings(await readScopedSettings(ctx, state))

    // 诊断：把这一轮拿到的 MVU 形状记进整局数据，出问题能直接从磁盘看（不写日志、不打扰玩家）
    const diag = {
      at: new Date().toISOString(),
      turn,
      hasVariables: Boolean(event.variables),
      variableKeys: event.variables && typeof event.variables === 'object'
        ? Object.keys(event.variables).slice(0, 20)
        : null,
      hasStatData: Boolean(event.variables && typeof event.variables === 'object' && event.variables.stat_data),
      statKeys: event.variables?.stat_data && typeof event.variables.stat_data === 'object'
        ? Object.keys(event.variables.stat_data).slice(0, 20)
        : null,
    }

    // ── MVU：先解析，再算这一轮要抄哪些字段（ADR 0053/0054）──
    // 勾选表按**卡**存：同一张卡的所有存档共用一份，换局不用重配。
    const cardKey = String(event.card?.id ?? event.card?.name ?? gameId)
    const previousKey = state.meta?.cardKey
    if (cardKey !== previousKey) {
      // 新会话第一轮：身份可能还挂在 gameId 上，挪到真正的卡 id
      await migrateIdentityKey(ctx, [previousKey, gameId], cardKey)
    }
    state.meta.cardKey = cardKey
    // MVU 只兜底时间与地点（2026-11-05：人物字段映射退役，见 ADR 0091）
    const mvu = parseMvu(event.variables, {
      timePath: String(state.mvuTimeLoc?.time ?? ''),
      locPath: String(state.mvuTimeLoc?.loc ?? ''),
    })
    if (mvu.ok) {
      // 现场名单给「模糊离场」当条件①用（§2）
      state.flags.present = mvu.present
    }
    diag.mvuOk = mvu.ok
    pushDebug(state, mvu.ok ? 'info' : 'warn', mvu.ok ? 'MVU 解析成功' : 'MVU 没拿到变量', {
      gt: mvu.ok ? mvu.gt : null,
      loc: mvu.ok ? mvu.loc : null,
      在场人数: mvu.ok ? mvu.present.length : null,
      人物数: mvu.ok ? mvu.people.length : null,
      variableKeys: diag.variableKeys,
    })
    diag.gt = mvu.ok ? mvu.gt : null
    diag.loc = mvu.ok ? mvu.loc : null
    diag.presentCount = mvu.ok ? mvu.present.length : null
    diag.peopleCount = mvu.ok ? mvu.people.length : null
    state.debug = diag

    // 「关闭」档不跑模型，只保留程序记账（ADR 0028）
    if (settings.writeback?.mode !== 'off') {
      try {
        await runWriteback(ctx, state, { gameId, turn, text: String(text ?? ''), textVersion, settings, mvu })
        pushDebug(state, 'info', '写回完成', state.debugWriteback)
      } catch (error) {
        // 写回失败只跳过本轮，绝不影响游戏
        ctx.tavern.log?.warn?.('人物档案馆：写回失败，本轮跳过', error)
        pushDebug(state, 'error', '写回失败（本轮跳过）', { error: String(error?.message ?? error), stack: String(error?.stack ?? '').split('\n').slice(0, 4) })
      }
    }

    await saveGameState(ctx, gameId, state)

    // 推一个「档案变了」的信号（M4-16）：面板收到就自动重读，不用轮询。
    // data 里带轮次，保证每次结算内容都不同——平台只在内容变化时才通知订阅方。
    try {
      await ctx.tavern.publishState({
        gameId,
        name: 'archive',
        data: { turn, at: new Date().toISOString(), gt: diag?.gt ?? null, loc: diag?.loc ?? null },
      })
    } catch {
      // 推送失败不影响游戏：面板还有「刷新」按钮和打开时的重读兜底
    }
  })

  // ── 导出（ADR 0050）──
  // kind='preset' 只导预设；kind='archive' 导档案，**自动把预设和字典一起带上**。
  // 只有一种包：档案包（自带条目预设与字典）。单独导预设已砍（ADR 0052）。
  ctx.tavern.handle('character-archives/export', async ({ gameId, name } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    const definitions = state.entries ?? {}

    const turn = state.meta?.updatedTurn
    if (!Number.isInteger(turn)) throw new Error('这一局还没有人物册，导不出档案')
    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)
    return buildArchiveExport({
      name,
      definitions,
      snapshot,
      dict: state.dict,
      nextId: state.nextId,
    })
  })

  // ── 导入（ADR 0050）──
  // 这里只做校验＋暂存：快照要带 textVersion 才能写，而导入时拿不到它。
  // 所以把计划放进 state.pendingImport，等下一轮 onTurnSettled 用那轮的 textVersion 落盘。
  ctx.tavern.handle('character-archives/import', async ({ gameId, bundle, force = false } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)

    const turn = state.meta?.updatedTurn
    const parsed = Number.isInteger(turn) ? await readSnapshotAt(ctx, gameId, turn) : null
    const hasExisting = Boolean(parsed && !parsed.bootstrapped && parsed.snapshot.p.length > 0)

    // 主角名也要查：导进来的 NPC 不能顶主角的名字（否则每轮都被当成"主角被提到"）
    const identity = await readIdentity(ctx, String(state.meta?.cardKey ?? gameId))
    const result = importBundle(bundle, {
      hasExisting,
      force,
      mainNames: identity.playerName ? [identity.playerName] : [],
    })
    if (!result.ok) return { ok: false, reason: result.reason }

    // 预设包：立刻生效（条目定义随时可写）；档案包：连带暂存人物册
    state.entries = result.plan.entries
    if (result.plan.nextId) state.nextId = result.plan.nextId
    if (result.plan.persons) {
      state.dict = result.plan.dict
      state.pendingImport = result.plan
    }
    await saveGameState(ctx, gameId, state)
    return { ok: true, kind: result.plan.persons ? 'archive' : 'preset', persons: result.plan.persons?.length ?? 0 }
  })

  // ── 三段提示词（全局存，ADR 0063）──
  ctx.tavern.handle('character-archives/prompts', async ({ gameId } = {}) => {
    const templates = await readPrompts(ctx)
    // 动态上下文（只读展示）：本局视角、称呼、栏目定义、认知口径、按需的约定规则——每轮拼进工单，玩家改不了（ADR 0095/0105）
    let contextText = ''
    if (gameId) {
      try {
        const state = await loadGameState(ctx.tavern, gameId)
        const identity = await readIdentity(ctx, String(state?.meta?.cardKey ?? gameId))
        identity.playerName = await resolvePlayerName(ctx, gameId, String(state?.meta?.cardKey ?? gameId))
        const settings = resolveSettings(await readScopedSettings(ctx, state))
        contextText = buildContextText({
          viewpoint: personLabel(identity.person),
          playerName: identity.playerName,
          entriesText: entryLinesOf(state.entries ?? {}),
          definitions: state.entries ?? {},
          cognition: settings.cognition,
        })
      } catch {
        // 面板读不到就空着，不影响提示词编辑
      }
    }
    return {
      templates,
      defaults: { ...DEFAULT_TEMPLATES, system: defaultSystemPrompt() },
      placeholders: PLACEHOLDERS,
      contextText,
    }
  })

  ctx.tavern.handle('character-archives/set-prompts', async ({ patch } = {}) => {
    // 提示词是自然语言，不能套字符白名单；只卡长度，防止一坨超大文本把插件数据撑爆
    for (const key of ['system', 'write', 'recall']) {
      const value = patch?.[key]
      if (typeof value === 'string' && [...value].length > MAX_PROMPT_CHARS) {
        return { ok: false, reason: `${key} 段太长了（${[...value].length} 字，上限 ${MAX_PROMPT_CHARS}）` }
      }
    }
    const templates = await savePrompts(ctx, patch)
    // 系统提示词就是后台成员的固定前缀：存完立刻重挂，面板改的才真的进到成员那边去。
    // 生效范围：**下一轮结算**（前缀按次现取，既有会话也吃得到；代价是缓存失效一次）。
    // 重挂失败不回滚保存（文本留着有用），但要如实告诉面板「成员那边还是旧的」。
    const touchedSystem = Boolean(patch && Object.hasOwn(patch, 'system'))
    const memberMounted = touchedSystem ? mountMember(ctx, templates.system) : true
    return {
      ok: true,
      memberMounted,
      templates,
      defaults: { ...DEFAULT_TEMPLATES, system: defaultSystemPrompt() },
      placeholders: PLACEHOLDERS,
    }
  })

  // ── 已删除名单（按会话，ADR 0066）──
  // 删人不是真抹掉：人挪进名单，面板可以恢复、也可以永久删除。
  ctx.tavern.handle('character-archives/deleted-list', async ({ gameId } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const people = store.readDeleted(gameId)
    return { people, count: people.length }
  })

  ctx.tavern.handle('character-archives/delete-person', async ({ gameId, ids } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    const turn = state.meta?.updatedTurn
    if (!Number.isInteger(turn) || turn < 1) throw new Error('这一局还没有快照，暂时删不了')

    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)
    const wanted = idSet(ids)
    wanted.delete(PLAYER_ID)   // 主角常驻档不能删（ADR 0085）
    const { removed, kept } = splitPersons(snapshot, wanted)   // 纯函数，测试守着（B2）
    if (!removed.length) {
      // 静默无事发生最难查（B2）：把"我要删谁"和"快照里都有谁"一起带回去
      return {
        ok: true,
        removed: 0,
        diag: {
          turn,
          wanted: [...wanted],
          inSnapshot: (snapshot.p ?? []).map((person) => String(person?.[0])),
          snapshotPeople: (snapshot.p ?? []).length,
        },
      }
    }

    snapshot.p = kept
    const list = store.readDeleted(gameId)
    const at = new Date().toISOString()
    const goneClaims = []
    const gonePointers = []
    for (const person of removed) {
      const owned = claimsOfPerson(snapshot.c, person?.[0])
      const related = pointersOfPerson(snapshot.pt, person?.[0], owned.map((claim) => claim?.[0]))
      goneClaims.push(...owned)
      gonePointers.push(...related)
      // 留全：恢复时要能原样补回去（[0]编号 [1]状态 [2]姓名 [3]别名串）
      // claims / pointers：他名下的命题、他作主体的指针、指向他命题的别人指针（ADR 0088）
      list.push({
        id: person?.[0],
        status: person?.[1],
        name: person?.[2],
        aliases: person?.[3] ?? '',
        claims: owned,
        pointers: related,
        turn,
        at,
      })
    }
    // 连带从快照里摘掉：只删人物会让命题和指针悬空（ADR 0088）
    const goneClaimSet = new Set(goneClaims)
    const gonePointerSet = new Set(gonePointers)
    snapshot.c = (snapshot.c ?? []).filter((claim) => !goneClaimSet.has(claim))
    snapshot.pt = (snapshot.pt ?? []).filter((pointer) => !gonePointerSet.has(pointer))
    store.writeDeleted(gameId, list)

    // 走正常写盘：内容进文件、酒馆里更新指针（回退语义照旧）
    const record = await ctx.tavern.readTurnData({ gameId, turn })
    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: record?.textVersion })
    return { ok: true, removed: removed.length, count: list.length, diag: { turn, wanted: [...wanted] } }
  })

  ctx.tavern.handle('character-archives/restore-person', async ({ gameId, ids } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    const turn = state.meta?.updatedTurn
    if (!Number.isInteger(turn) || turn < 1) throw new Error('这一局还没有快照')

    const wanted = idSet(ids)
    const list = store.readDeleted(gameId)
    const back = list.filter((item) => wanted.has(String(item.id)))
    if (!back.length) return { ok: true, restored: 0 }

    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)
    const has = new Set((snapshot.p ?? []).map((person) => String(person?.[0])))
    // 名字池：现有档案里的姓名 + 别名。恢复的人**不能跟它对撞**——
    // 以前没有这道检查，从「已删除」能恢复出两个同名的人，之后再导出还会被导入体检拒掉（ADR 0084）。
    const taken = new Set()
    for (const person of snapshot.p ?? []) {
      for (const one of namesOfPerson(person)) taken.add(one)
    }

    const restored = []
    const skipped = []
    for (const item of back) {
      if (has.has(String(item.id))) {
        skipped.push({ id: item.id, reason: '编号已经在档案里' })
        continue
      }
      const aliases = splitAliases(item.aliases ?? '')
      const names = [String(item.name ?? '').trim(), ...aliases].filter(Boolean)
      const clash = names.find((one) => taken.has(one))
      if (clash) {
        skipped.push({ id: item.id, name: item.name, reason: `名字「${clash}」已经归别人了` })
        continue
      }
      for (const one of names) taken.add(one)
      snapshot.p = [...(snapshot.p ?? []), [item.id, item.status, item.name, item.aliases ?? '']]
      // 连带补回命题与指针（ADR 0088）。去重：两条删除记录可能都带着同一条。
      for (const claim of Array.isArray(item.claims) ? item.claims : []) {
        if (!(snapshot.c ?? []).some((one) => one?.[0] === claim?.[0])) {
          snapshot.c = [...(snapshot.c ?? []), claim]
        }
      }
      for (const pointer of Array.isArray(item.pointers) ? item.pointers : []) {
        const dup = (snapshot.pt ?? []).some(
          (one) => one?.[0] === pointer?.[0] && one?.[1] === pointer?.[1],
        )
        if (!dup) snapshot.pt = [...(snapshot.pt ?? []), pointer]
      }
      restored.push(item)
    }
    const restoredIds = new Set(restored.map((item) => String(item.id)))
    store.writeDeleted(gameId, list.filter((item) => !restoredIds.has(String(item.id))))

    const record = await ctx.tavern.readTurnData({ gameId, turn })
    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: record?.textVersion })
    return { ok: true, restored: restored.length, skipped }
  })

  // 永久删除：只从名单里去掉（名单是我们自己的 json，不是一个文件，所以没有"挪回收站"这回事）
  ctx.tavern.handle('character-archives/purge-deleted', async ({ gameId, ids } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const wanted = idSet(ids)
    const list = store.readDeleted(gameId)
    const kept = list.filter((item) => !wanted.has(String(item.id)))
    store.writeDeleted(gameId, kept)
    return { ok: true, purged: list.length - kept.length, count: kept.length }
  })

  // ── 预设表（条目定义 + MVU 映射，ADR 0070）──
  // 面板上「预设」标签页用：看当前挂了哪些条目、每个条目的描述、
  // 以及这张卡的 MVU 字段分别该抄到哪个条目。
  ctx.tavern.handle('character-archives/presets-view', async ({ gameId } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    const cardKey = String(state.meta?.cardKey ?? '')
    const cardPreset = cardKey ? await readCardPreset(ctx.tavern, cardKey) : null
    const globalPreset = await readGlobalPreset(ctx.tavern)
    const settings = resolveSettings(await readScopedSettings(ctx, state))

    // MVU：人物字段映射已退役（ADR 0091），这里只给「时间来源／地点来源」两个兜底下拉
    let paths = []
    let survey = null
    let mvuOk = false
    try {
      const turn = state.meta?.updatedTurn
      if (Number.isInteger(turn)) {
        const latest = await ctx.tavern.getTurn({ gameId, turn })
        const statData = readStatData(latest?.variables)
        mvuOk = Boolean(statData)
        paths = listLeafPaths(statData)
        survey = surveyStatData(statData)
      }
    } catch (error) {
      paths = []
      survey = { keys: [], fields: 0, error: String(error?.message || error) }
    }

    return {
      definitions: state.entries ?? {},
      order: Object.keys(state.entries ?? {}),
      checkedCodes: Array.isArray(settings.checkedCodes)
        ? [...settings.checkedCodes]
        : Object.keys(state.entries ?? {}),
      mvu: {
        time: String(state.mvuTimeLoc?.time ?? ''),
        loc: String(state.mvuTimeLoc?.loc ?? ''),
        paths,
        survey,
        ok: mvuOk,
        turn: Number.isInteger(state.meta?.updatedTurn) ? state.meta.updatedTurn : null,
      },
      // 这张卡有没有自己的覆盖、全局有没有存过——面板据此显示「当前用哪份」
      scope: { card: Boolean(cardPreset), global: Boolean(globalPreset) },
    }
  })

  // 保存预设表：条目定义 + 勾选 + 唯一值 + MVU 勾选表
  ctx.tavern.handle('character-archives/presets-save', async ({ gameId, patch = {}, scope = 'global' } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    const cardKey = String(state.meta?.cardKey ?? '')
    const settings = resolveSettings(await readScopedSettings(ctx, state))

    // ① 条目定义：改名 / 改描述 / 改唯一值
    if (patch.entries && typeof patch.entries === 'object') {
      const next = { ...(state.entries ?? {}) }
      for (const [code, item] of Object.entries(patch.entries)) {
        if (!next[code]) continue
        const changed = { ...next[code] }
        if (typeof item?.name === 'string' && item.name.trim()) {
          // 栏目名会拼进提示词表格：换行、引号、竖线都会把表格/JSON 搞坏
          const nameCheck = checkText(item.name, '栏目', { max: 24 })
          if (!nameCheck.ok) return { ok: false, reason: `栏目 ${code}：${nameCheck.reason}` }
          changed.name = item.name.trim()
        }
        if (typeof item?.prompt === 'string') {
          const chars = [...item.prompt].length
          if (chars > MAX_ENTRY_PROMPT_CHARS) {
            return {
              ok: false,
              reason: `栏目 ${code} 的抓取提示词太长了（${chars} 字，上限 ${MAX_ENTRY_PROMPT_CHARS} 字）——它每轮都会跟着【栏目定义】发给模型，太长会挤占召回预算`,
            }
          }
          changed.prompt = item.prompt
        }
        // 两个新标记（ADR 0089 §4 / ADR 0087）：必带召回、约定类
        if (typeof item?.mustRecall === 'boolean') changed.mustRecall = item.mustRecall
        if (typeof item?.convention === 'boolean') changed.convention = item.convention
        next[code] = changed
      }
      state.entries = next
    }

    // ② 勾选召回哪些栏目
    if (Array.isArray(patch.checkedCodes)) {
      state.settings = { ...(state.settings ?? {}), checkedCodes: patch.checkedCodes.map(String) }
    }

    // ③ 决定存哪：默认全局；scope='card' 写这张卡；scope='clear-card' 删掉卡级覆盖
    const preset = {
      entries: state.entries ?? {},
      checkedCodes: state.settings?.checkedCodes ?? null,
      mvuChecklist: state.mvuChecklist ?? {},
    }
    if (scope === 'card') {
      if (!cardKey) return { ok: false, reason: '这一局没有卡 id，不能按卡保存' }
      await writeCardPreset(ctx, cardKey, preset)
    } else if (scope === 'clear-card') {
      if (cardKey) await clearCardPreset(ctx, cardKey)
    } else {
      await writeGlobalPreset(ctx, preset)
    }
    await saveGameState(ctx, gameId, state)

    // ③ MVU：人物字段映射已退役（ADR 0091），只留「时间来源／地点来源」两个兜底
    if (patch.mvuTimeLoc && typeof patch.mvuTimeLoc === 'object') {
      const next = { ...(state.mvuTimeLoc ?? {}) }
      for (const key of ['time', 'loc']) {
        if (typeof patch.mvuTimeLoc[key] === 'string') next[key] = patch.mvuTimeLoc[key].trim()
      }
      state.mvuTimeLoc = next
      await saveGameState(ctx, gameId, state)
    }
    // 旧的人物字段勾选表：保留读写，但这套已经不参与任何逻辑，只为回退/旧数据不炸
    if (patch.mvuChecklist && typeof patch.mvuChecklist === 'object') {
      const current = { ...(state.mvuChecklist ?? {}) }
      for (const [key, item] of Object.entries(patch.mvuChecklist)) {
        if (item === null) delete current[key]
        else current[key] = item
      }
      state.mvuChecklist = current
      await saveGameState(ctx, gameId, state)
    }

    return { ok: true, definitions: state.entries ?? {} }
  })

  // ── 设置项按三种作用域存（ADR 0072）──
  //   global 全局级   → 插件数据 settings（全局一份）
  //   card    人物卡级 → 插件数据 settingsByCard[cardKey]（同一张卡的多个存档共用）
  //   game    会话级   → 整局数据 state.settings（一个存档一份）
  // readScopedSettings 已提到模块级（saveSnapshot 也要读设置）

  async function writeScopedSettings(ctx, state, settings) {
    const cardKey = String(state?.meta?.cardKey ?? '')
    const parts = splitSettings(settings)
    const data = (await ctx.tavern.readPluginData()) ?? {}
    data.settings = parts.global
    if (cardKey) {
      data.settingsByCard = { ...(data.settingsByCard ?? {}) }
      if (Object.keys(parts.card).length) data.settingsByCard[cardKey] = parts.card
      else delete data.settingsByCard[cardKey]
    }
    await ctx.tavern.savePluginData({ data })
    state.settings = parts.game
    return parts
  }

  /**
 * 给「多选」型设置项补上可选项清单（条目码 → 栏目名）。
 * 设置页的「本局勾选哪些栏目」要用它。
   */
  /** 给「多选」型设置项附上可选项清单（条目码 → 栏目名）。value 已经由 describeSettings 算好，这里不动它。 */
  function withCodeList(groups, state) {
    const codes = codeListOf(state)
    return (Array.isArray(groups) ? groups : []).map((section) => ({
      ...section,
      groups: (section.groups ?? []).map((group) => ({
        ...group,
        items: (group.items ?? []).map((item) => (item.type === 'codes' ? { ...item, codes } : item)),
      })),
    }))
  }

  /** 这一局有哪些条目码（栏目）。 */
  function codeListOf(state) {
    const definitions = state?.entries ?? {}
    return Object.keys(definitions).map((code) => ({ code, name: definitions[code]?.name ?? code }))
  }

  // ── 数据位置（让人能直接找到数据在哪儿，ADR 0071）──
  ctx.tavern.handle('character-archives/data-locations', async ({ gameId } = {}) => {
    const state = gameId ? await loadGameState(ctx.tavern, gameId) : null
    const sessionId = String(gameId ?? '')
    const dataRoot = STORE_ROOT
    const tavernRoot = path.dirname(path.dirname(dataRoot))   // <data>/plugin-data/<名字> → <data>

    const list = [
      {
        key: 'store',
        label: '插件自持数据（快照／整局数据／已删除／回收站）',
        path: dataRoot,
        exists: fs.existsSync(dataRoot),
        note: '人物档案本体都在这儿；预设表在全局 plugin-data 里',
      },
      {
        key: 'snapshots',
        label: '快照（每轮一份人物册）',
        path: sessionId ? path.join(dataRoot, 'snapshots', sessionId) : path.join(dataRoot, 'snapshots'),
        exists: sessionId ? fs.existsSync(path.join(dataRoot, 'snapshots', sessionId)) : false,
        note: '回退时读对应轮次那份',
      },
      {
        key: 'games',
        label: '整局数据（冷却／模糊建档表／调试日志）',
        path: sessionId ? path.join(dataRoot, 'games', `${sessionId}.json`) : path.join(dataRoot, 'games'),
        exists: sessionId ? fs.existsSync(path.join(dataRoot, 'games', `${sessionId}.json`)) : false,
        note: '这局的运行状态；预设表已搬到全局（plugin-data 的 character-archives.json）',
      },
      {
        key: 'deleted',
        label: '已删除名单',
        path: sessionId ? path.join(dataRoot, 'deleted', `${sessionId}.json`) : path.join(dataRoot, 'deleted'),
        exists: sessionId ? fs.existsSync(path.join(dataRoot, 'deleted', `${sessionId}.json`)) : false,
        note: '删掉的人在这儿（模型不会重建他们）',
      },
      {
        key: 'trash',
        label: '回收站',
        path: path.join(dataRoot, 'trash'),
        exists: fs.existsSync(path.join(dataRoot, 'trash')),
        note: '删局、剪枝掉的旧数据都在这儿（不硬删）',
      },
      {
        key: 'pluginData',
        label: '全局插件数据（玩家称呼／索引词／提示词）',
        path: path.join(tavernRoot, 'plugin-data', `${PLUGIN_NAME}.json`),
        exists: fs.existsSync(path.join(tavernRoot, 'plugin-data', `${PLUGIN_NAME}.json`)),
        note: '跨局共用；上限 256 KB',
      },
    ]
    // trash 里堆了多少废文件：给「立即清理」按钮当回执用
    const trashDir = path.join(dataRoot, 'trash')
    let trashCount = 0
    try { if (fs.existsSync(trashDir)) trashCount = fs.readdirSync(trashDir).length } catch { /* 读不到就 0 */ }
    return { locations: list, dataRoot, trashCount }
  })

  // 立即清空 trash（P22③）：trash 里都是确认不要的死数据，这里真删。
  // 玩家点「立即清理」用；平时按 storage.trashMaxAgeDays 在结算时自动清。
  ctx.tavern.handle('character-archives/empty-trash', async () => {
    const result = store.emptyTrash({})
    ctx.tavern.log?.info?.(`人物档案馆：手动清空 trash，删掉 ${result.removed} 个`)
    return { ok: true, removed: result.removed, freedBytes: result.freedBytes }
  })

  // 用资源管理器打开一个位置（Windows explorer / macOS open / Linux xdg-open）
  ctx.tavern.handle('character-archives/open-folder', async ({ target } = {}) => {
    const key = String(target ?? '')
    if (!key) throw new Error('没指定要打开哪个位置')

    // 只认白名单里的 key——**不接受任意路径**，免得面板被拿来乱开目录
    // pluginData 那条是**文件**不是目录：打开它所在的文件夹
    const roots = {
      store: STORE_ROOT,
      snapshots: path.join(STORE_ROOT, 'snapshots'),
      games: path.join(STORE_ROOT, 'games'),
      deleted: path.join(STORE_ROOT, 'deleted'),
      trash: path.join(STORE_ROOT, 'trash'),
      pluginData: path.join(STORE_ROOT, '..', 'plugin-data'),
    }
    const dir = roots[key]
    if (!dir) throw new Error(`不认识的位置：${key}`)
    // pluginData 是一个 JSON **文件**：existsSync 对文件也成立，但 explorer 要给目录，
    // 所以这里统一「是文件就开它的父目录」。
    const openTarget = fs.existsSync(dir) && fs.statSync(dir).isFile() ? path.dirname(dir) : dir
    if (!fs.existsSync(openTarget)) {
      throw new Error(`那个位置还不存在（可能这局还没用过）：${openTarget}`)
    }

    const opener = process.platform === 'win32'
      ? { file: 'explorer.exe', args: [openTarget] }
      : process.platform === 'darwin'
        ? { file: 'open', args: [openTarget] }
        : { file: 'xdg-open', args: [openTarget] }
    try {
      const child = spawn(opener.file, opener.args, { detached: true, stdio: 'ignore' })
      child.unref()
    } catch (error) {
      throw new Error(`打不开文件夹：${String(error?.message || error)}`)
    }
    return { ok: true, path: openTarget }
  })

  // ── 调试窗口（常开，2026-11-05 去掉开关）──
  ctx.tavern.handle('character-archives/debug', async ({ gameId, clear } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    if (clear === true) {
      state.debugLog = []
      await saveGameState(ctx, gameId, state)
    }
    return {
      logs: Array.isArray(state.debugLog) ? state.debugLog : [],
      stages: {
        mvu: state.debug ?? null,
        writeback: state.debugWriteback ?? null,
        identity: state.debugIdentity ?? null,
      },
      meta: state.meta ?? null,
      limits: { max: DEBUG_LOG_MAX },
    }
  })

  // ── 身份（玩家称呼＋人称）：按卡存，面板顶部直接可改 ──
  ctx.tavern.handle('character-archives/identity', async ({ gameId } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    const cardKey = String(state.meta?.cardKey ?? gameId)
    const identity = await readIdentity(ctx, cardKey)
    // 称呼以酒馆为准（玩家可能在酒馆里改过），人称是我们自己的
    const liveName = await resolvePlayerName(ctx, gameId, cardKey)
    state.debugIdentity = { at: new Date().toISOString(), op: 'read', liveName, stored: identity.playerName }
    await saveGameState(ctx, gameId, state)
    return {
      identity: { ...identity, playerName: liveName },
      options: PERSON_OPTIONS,
      canWriteTavern: typeof ctx.tavern.setPlayerName === 'function',
    }
  })

  ctx.tavern.handle('character-archives/set-identity', async ({ gameId, patch } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    // 称呼是**名字**：括号会跟编号尾巴打架、逗号是别名分隔符（ADR 0084）。空串＝清空，允许。
    if (patch && Object.hasOwn(patch, 'playerName') && String(patch.playerName ?? '').trim()) {
      const wanted = String(patch.playerName).trim()
      const nameCheck = checkText(wanted, '玩家称呼', { max: MAX_PLAYER_NAME, kind: 'name' })
      if (!nameCheck.ok) return { ok: false, reason: nameCheck.reason }
      // 代词不是名字（中英文都不行）：拿它当称呼，档案里就会出现"叫『你』的那个人"
      if (isPronounName(wanted)) return { ok: false, reason: `「${wanted}」是人称代词，不能当玩家称呼` }
    }
    const state = await loadGameState(ctx.tavern, gameId)
    const cardKey = String(state.meta?.cardKey ?? gameId)
    const next = applyIdentityPatch(await readIdentity(ctx, cardKey), patch)
    // 第三人称必须填名字：正文里靠名字指代主角，没名字就认不出他
    const problem = identityProblem(next)
    if (problem) return { ok: false, reason: problem }

    // 称呼写回酒馆（issue #464 的 setPlayerName）：两边共用一个值，免得档案里叫「林澈」、正文里叫「你」
    if (patch && Object.hasOwn(patch, 'playerName') && typeof ctx.tavern.setPlayerName === 'function') {
      try {
        await ctx.tavern.setPlayerName({ gameId, playerName: next.playerName })
      } catch (error) {
        const busy = String(error?.code ?? '').includes('BUSY') || /忙|busy/i.test(String(error?.message ?? ''))
        state.debugIdentity = { at: new Date().toISOString(), op: 'set', asked: next.playerName, error: String(error?.message ?? error) }
        await saveGameState(ctx, gameId, state)
        return { ok: false, reason: busy ? '正文生成或结算中，等这一轮结束再改称呼' : String(error?.message ?? error) }
      }
      // 写完立刻回读：酒馆那边到底存成什么，记下来好排查
      let readBack = null
      try { readBack = await ctx.tavern.getPlayerName({ gameId }) } catch { /* 读不到就算了 */ }
      state.debugIdentity = { at: new Date().toISOString(), op: 'set', asked: next.playerName, readBack }
      await saveGameState(ctx, gameId, state)
    }

    await saveIdentity(ctx, cardKey, next)

    // 主角姓名跟玩家称呼是同一个值：改称呼就把档案里的 p0 一起改，旧称呼自动进别名。
    // 还没结算过（没有快照）就跳过——下一轮 turnSection 的 ensurePlayer 会建出来。
    const syncTurn = patch && Object.hasOwn(patch, 'playerName') ? await editTurnOf(ctx, gameId, state) : null
    if (syncTurn) {
      const turn = syncTurn
      const { snapshot } = await readSnapshotAt(ctx, gameId, turn)
      const player = (snapshot.p ?? []).find((item) => Array.isArray(item) && item[0] === PLAYER_ID)
      if (player && String(player[2] ?? '').trim() !== next.playerName) {
        const renamed = setPersonNames(snapshot.p, {
          id: PLAYER_ID,
          name: next.playerName,
          keepOldName: true,
        })
        if (renamed.ok) {
          snapshot.p = renamed.persons
          await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: await currentTextVersion(ctx, gameId, turn) })
        }
      }
    }

    return {
      ok: true,
      identity: { ...next, playerName: await resolvePlayerName(ctx, gameId, cardKey) },
      options: PERSON_OPTIONS,
      canWriteTavern: typeof ctx.tavern.setPlayerName === 'function',
    }
  })

  // ── 设置（§8.6）──
  // 桌面面板上的「设置」视图：字段说明、范围、选项都在 lib/settingsView.js。
  ctx.tavern.handle('character-archives/settings', async ({ gameId } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    const settings = resolveSettings(await readScopedSettings(ctx, state))
    // 折叠状态是全局级 UI 偏好，跟设置一起返回，省一次往返
    let ui = {}
    try {
      ui = (await ctx.tavern.readPluginData())?.ui ?? {}
    } catch {
      ui = {}
    }
    return { groups: withCodeList(describeSettings(settings, DEFAULT_SETTINGS, { codes: codeListOf(state) }), state), ui }
  })

  // 改一批设置：`{ '组.键': 新值 }`。非法值与不认识的键会被忽略（见 settingsView）。
  ctx.tavern.handle('character-archives/set-settings', async ({ gameId, patch } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    const before = resolveSettings(await readScopedSettings(ctx, state))
    const next = applySettingPatch(before, patch ?? {})
    // 按作用域分头存（ADR 0072）
    await writeScopedSettings(ctx, state, next)
    await saveGameState(ctx, gameId, state)
    return { ok: true, groups: withCodeList(describeSettings(next, DEFAULT_SETTINGS, { codes: codeListOf(state) }), state) }
  })

  // 面板的 UI 偏好（折叠状态等）：全局级，存插件数据
  ctx.tavern.handle('character-archives/set-ui', async ({ ui } = {}) => {
    if (!ui || typeof ui !== "object") throw new Error("没有要保存的界面状态")
    const data = (await ctx.tavern.readPluginData()) ?? {}
    data.ui = { ...(data.ui ?? {}), ...ui }
    await ctx.tavern.savePluginData({ data })
    return { ok: true, ui: data.ui }
  })

  // ── 删局：把该局的文件挪进 trash（不硬删，玩家可以自己清）──
  ctx.tavern.onGameRemoved?.(({ gameId } = {}) => {
    try {
      if (gameId) {
      store.dropGame(gameId)
      store.dropDeleted(gameId)   // 已删除名单随会话一起挪进 trash
    }
    } catch {
      // 清理失败不影响别的局
    }
  })

  // ── 面板数据（§8.1～§8.3）──
  // 浏览器侧只负责画；分组、冷档、排序、值的展开都在 lib/panelView.js 里算好。
  ctx.tavern.handle('character-archives/archive', async ({ gameId } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    const definitions = state.entries ?? {}
    const settings = resolveSettings(await readScopedSettings(ctx, state))
    const definedCodes = Object.keys(definitions)
    const checkedCodes = Array.isArray(settings.checkedCodes)
      ? new Set(settings.checkedCodes)
      : new Set(definedCodes)

    const turn = state.meta?.updatedTurn
    if (!Number.isInteger(turn)) {
      // 还没结算过：主角也要摆出来——他是玩家自己，不是"等模型建档的 NPC"（ADR 0085）。
      const identity = await readIdentity(ctx, String(state?.meta?.cardKey ?? gameId))
      identity.playerName = await resolvePlayerName(ctx, gameId, String(state?.meta?.cardKey ?? gameId))
      const playerState = ensurePlayer([], {
        name: identity.playerName,
        alwaysPresent: identity.person !== 'third',
      })
      const view = buildPanelView({
        snapshot: { t: 0, p: playerState.persons, c: [], pt: [] },
        definitions,
        checkedCodes,
      })
      return { ...view, gt: '', loc: '', empty: false, definitions, checkedCodes: [...checkedCodes] }
    }

    const parsed = await readSnapshotAt(ctx, gameId, turn)

    // **实时时间和地点**：直接读最新一轮的 MVU 变量，不等我们自己的快照。
    // 平台把变量存在消息上，`getTurn` 就能取到（plugin-api.js: snapshotOf）。
    let liveGt = typeof parsed.snapshot?.gt === 'string' ? parsed.snapshot.gt : ''
    let liveLoc = typeof parsed.snapshot?.loc === 'string' ? parsed.snapshot.loc : ''
    try {
      const latest = await ctx.tavern.getTurn({ gameId, turn })
      const live = parseMvu(latest?.variables)
      if (live.ok) {
        if (live.gt) liveGt = live.gt
        if (live.loc) liveLoc = live.loc
      }
    } catch {
      // 读不到就用快照里的，不影响面板
    }

    // 快照里没有主角（老数据、或者上轮建坏了）→ 补一个再显示。
    // 这里不落盘：面板是只读的，下一轮结算时 turnSection 会真的把他建进去。
    const identity = await readIdentity(ctx, String(state?.meta?.cardKey ?? gameId))
    identity.playerName = await resolvePlayerName(ctx, gameId, String(state?.meta?.cardKey ?? gameId))
    const playerState = ensurePlayer(parsed.snapshot.p, {
      name: identity.playerName,
      alwaysPresent: identity.person !== 'third',
    })
    if (playerState.changed) parsed.snapshot.p = playerState.persons

    const view = buildPanelView({
      snapshot: parsed.snapshot,
      definitions,
      checkedCodes,
      lock: state.flags?.lock ?? {},
      hidden: state.flags?.hidden ?? {},
      seen: state.flags?.seen ?? {},
      fuzzyLeft: state.flags?.fuzzyLeft ?? {},
      coldManual: state.flags?.coldManual ?? {},
      now: turn,
      draft: state.flags?.draft ?? {},
      dormantTurns: settings.recall?.dormantTurns ?? DORMANT_TURNS,
      starIds: new Set(Object.keys(state.flags?.star ?? {}).filter((id) => state.flags.star[id])),
    })
    // 只有「连空册都没有」才算空；有快照就显示分组（哪怕 0 人，也要能点「新建人物」）
    return {
      ...view,
      gt: liveGt,
      loc: liveLoc,
      empty: parsed.bootstrapped && view.stats.total === 0,
      definitions,
      checkedCodes: [...checkedCodes],
    }
  })

  // ── 历史快照：列出可用轮次（gt/loc 给下拉菜单显示）──
  ctx.tavern.handle('character-archives/snapshot-list', async ({ gameId } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const turns = store.listSnapshots(gameId).map((item) => {
      const snap = store.readSnapshot(gameId, item.turn)
      const data = snap?.data ?? {}
      return {
        turn: item.turn,
        gt: typeof data.gt === 'string' ? data.gt : '',
        loc: typeof data.loc === 'string' ? data.loc : '',
      }
    })
    return { turns }
  })

  // ── 历史快照：只读预览某一轮（不落盘、不影响当前进度）──
  ctx.tavern.handle('character-archives/snapshot-at', async ({ gameId, turn } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    if (!Number.isInteger(turn)) throw new Error('轮次不对')
    const state = await loadGameState(ctx.tavern, gameId)
    const snap = store.readSnapshot(gameId, turn)
    if (!snap?.data) return { empty: true, turn, gt: '', loc: '' }

    const definitions = state.entries ?? {}
    const settings = resolveSettings(await readScopedSettings(ctx, state))
    const definedCodes = Object.keys(definitions)
    const checkedCodes = Array.isArray(settings.checkedCodes)
      ? new Set(settings.checkedCodes)
      : new Set(definedCodes)

    const view = buildPanelView({
      snapshot: snap.data,
      definitions,
      checkedCodes,
      lock: state.flags?.lock ?? {},
      hidden: state.flags?.hidden ?? {},
      seen: state.flags?.seen ?? {},
      fuzzyLeft: state.flags?.fuzzyLeft ?? {},
      coldManual: state.flags?.coldManual ?? {},
      now: turn,
      draft: {},
      dormantTurns: settings.recall?.dormantTurns ?? DORMANT_TURNS,
      starIds: new Set(Object.keys(state.flags?.star ?? {}).filter((id) => state.flags.star[id])),
    })
    return {
      ...view,
      turn,
      gt: typeof snap.data.gt === 'string' ? snap.data.gt : '',
      loc: typeof snap.data.loc === 'string' ? snap.data.loc : '',
      empty: false,
      definitions,
      checkedCodes: [...checkedCodes],
    }
  })

  // ── 手动新建人物（§2「空壳人物」）──
  // 复用判定那套校验：姓名非空、不与主角同名、不撞名（ADR 0049）。
  ctx.tavern.handle('character-archives/create', async ({ gameId, name, status = '离场' } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state = await loadGameState(ctx.tavern, gameId)
    const turn = state.meta?.updatedTurn
    if (!Number.isInteger(turn)) throw new Error('这一局还没结算过，先跑一轮再建人物')

    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

    // 主角名从身份设置读。`settings.mainNames` 这个键压根不存在——拿它当守卫等于没守卫
    //（review 2026-11-04）；模型建档链路用的就是 identity.playerName。
    const identity = await readIdentity(ctx, String(state.meta?.cardKey ?? gameId))
    const mainNames = identity.playerName ? [identity.playerName] : []
    const checked = validatePersonActions(
      [{ 动作: '建档', 姓名: name, 状态: status }],
      { persons: snapshot.p, draft: state.flags?.draft ?? {}, mainNames, person: identity.person },
    )
    if (!checked.valid.length) {
      return { ok: false, reason: checked.rejected[0]?.reason ?? '建不了这个人' }
    }

    let counter = Number.isInteger(state.nextId) ? state.nextId : createIdCounter()
    const applied = applyPersonActions(snapshot.p, checked.valid, {
      turn,
      takeId: () => {
        const next = takePersonId(counter)
        counter = next.next
        return next.id
      },
    })
    if (!applied.created.length) return { ok: false, reason: '没分配到人物编号' }

    state.nextId = counter
    snapshot.p = applied.persons
    // 建档成功后，同名的人从「模糊建档」候选表里摘掉——他已经是正式人物了，不该再挂在候选里
    if (state.flags?.draft && Object.hasOwn(state.flags.draft, name)) {
      const nextDraft = { ...state.flags.draft }
      delete nextDraft[name]
      state.flags = { ...(state.flags ?? {}), draft: nextDraft }
    }
    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: await currentTextVersion(ctx, gameId, turn) })
    await saveGameState(ctx, gameId, state)
    return { ok: true, id: applied.created[0] }
  })

  // ── 姓名 + 别名一起改（展开区那一行）──
  // 为什么允许一起提交：分开改会卡死——别名不许等于「现在的姓名」，姓名又不许撞
  // 「现在的别名」，于是「旧姓名挪进别名 + 换新姓名」得绕占位符（ADR 0084）。
  ctx.tavern.handle('character-archives/set-names', async ({ gameId, personId, name, aliases } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    if (!personId) throw new Error('没指定人物')
    const state = await loadGameState(ctx.tavern, gameId)
    const settings = resolveSettings(await readScopedSettings(ctx, state))
    const turn = await editTurnOf(ctx, gameId, state)
    if (!turn) throw new Error('这一局还没有正文，先写一段再改')

    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

    const identity = await readIdentity(ctx, String(state.meta?.cardKey ?? gameId))
    identity.playerName = await resolvePlayerName(ctx, gameId, String(state.meta?.cardKey ?? gameId))
    // 面板上的主角是 /archive 补出来的（还没落盘）——操作前先把他真正建进快照，
    // 否则这里会报「找不到这个人」。
    const playerState = ensurePlayer(snapshot.p, {
      name: identity.playerName,
      alwaysPresent: identity.person !== 'third',
    })
    if (playerState.changed) snapshot.p = playerState.persons

    const isPlayerRow = personId === PLAYER_ID
    const updated = setPersonNames(snapshot.p, {
      id: personId,
      name,
      aliases,
      // 改主角时不用「不许撞主角名」这条（他本人就是主角）；旧称呼自动进别名
      mainNames: isPlayerRow || !identity.playerName ? [] : [identity.playerName],
      // 所有人都保留旧名：改完名字，旧称呼以后还可能被叫到（跟主角同一套逻辑）
      // 玩家可以在设置里关掉（names.keepOldName）；模型改名不看这个开关
      keepOldName: settings.names?.keepOldName !== false,
    })
    if (!updated.ok) return { ok: false, reason: updated.reason }

    snapshot.p = updated.persons
    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: await currentTextVersion(ctx, gameId, turn) })

    // 主角的姓名就是「本局设置」里的玩家称呼：写回身份，否则下一轮 ensurePlayer 会把它冲回去
    if (isPlayerRow) {
      const nextName = String(name ?? '').trim()
      if (nextName && nextName !== identity.playerName) {
        await saveIdentity(ctx, String(state.meta?.cardKey ?? gameId), { ...identity, playerName: nextName })
      }
    }
    return { ok: true, name: String(name ?? '').trim() }
  })

  // ── 手动改姓名（姓名升到人物级别，ADR 0044 / 0049）──
  // 名字不许留空、不许撞名：姓名是召回与写入的唯一门牌号（2026-11-04 定）。
  ctx.tavern.handle('character-archives/rename-person', async ({ gameId, personId, name } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    if (!personId) throw new Error('没指定人物')
    const state = await loadGameState(ctx.tavern, gameId)
    const settings = resolveSettings(await readScopedSettings(ctx, state))
    const turn = await editTurnOf(ctx, gameId, state)
    if (!turn) throw new Error('这一局还没有正文，先写一段再改名')

    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

    // 主角名从身份设置读（同 /create）：settings 里没有 mainNames 这个键
    const identity = await readIdentity(ctx, String(state.meta?.cardKey ?? gameId))
    identity.playerName = await resolvePlayerName(ctx, gameId, String(state.meta?.cardKey ?? gameId))
    // 同 /set-names：面板上补出来的主角要先真正建进快照，不然这里报「找不到这个人」
    const playerState = ensurePlayer(snapshot.p, {
      name: identity.playerName,
      alwaysPresent: identity.person !== 'third',
    })
    if (playerState.changed) snapshot.p = playerState.persons

    const isPlayerRow = personId === PLAYER_ID
    const renamed = renamePerson(snapshot.p, {
      id: personId,
      name,
      mainNames: isPlayerRow || !identity.playerName ? [] : [identity.playerName],
      // 所有人都保留旧名；玩家可以在设置里关掉（names.keepOldName）
      keepOldName: settings.names?.keepOldName !== false,
    })
    if (!renamed.ok) return { ok: false, reason: renamed.reason }

    snapshot.p = renamed.persons
    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: await currentTextVersion(ctx, gameId, turn) })

    // 主角的姓名就是「本局设置」里的玩家称呼：写回身份，两边永远同一个值
    if (isPlayerRow) {
      const nextName = String(name ?? '').trim()
      if (nextName && nextName !== identity.playerName) {
        await saveIdentity(ctx, String(state.meta?.cardKey ?? gameId), { ...identity, playerName: nextName })
      }
    }
    return { ok: true, name: String(name ?? '').trim() }
  })

  // ── 查认知（面板「查认知」）：纯展示——完整给、不看冷却、**不盖章**、不进上下文 ──
  // 盖章会污染下一轮自动召回，所以查询这条路上一个章都不盖（2026-11-04 定）。
  ctx.tavern.handle('character-archives/lookup-person', async ({ gameId, personId, name } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    // 面板已经实时过滤过；这里兜底，防绕过面板直接打接口（口径同改名／建档）
    if (!String(personId ?? '').trim()) {
      const nameCheck = checkText(String(name ?? '').trim(), '姓名', { max: NAME_MAX, kind: 'name' })
      if (!nameCheck.ok) return { ok: false, reason: nameCheck.reason }
    }
    const state = await loadGameState(ctx.tavern, gameId)
    const turn = state.meta?.updatedTurn
    if (!Number.isInteger(turn)) return { ok: false, reason: '这一局还没结算过' }

    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)
    const result = queryPerson({
      snapshot,
      personId,
      name,
      level: 'full',
    })
    if (!result.ok) return result
    return { ok: true, name: result.name, text: result.text }
  })

  // ── 查人物（面板「查人物」）：只回编号，面板拿去滚动并展开，不产生任何副作用 ──
  ctx.tavern.handle('character-archives/find-person', async ({ gameId, name } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const nameCheck = checkText(String(name ?? '').trim(), '姓名', { max: NAME_MAX, kind: 'name' })
    if (!nameCheck.ok) return { ok: false, reason: nameCheck.reason }
    const wanted = String(name ?? '').trim()

    const state = await loadGameState(ctx.tavern, gameId)
    const turn = state.meta?.updatedTurn
    if (!Number.isInteger(turn)) return { ok: false, reason: '这一局还没结算过' }

    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)
    const people = Array.isArray(snapshot?.p) ? snapshot.p : []
    const identity = await readIdentity(ctx, String(state.meta?.cardKey ?? gameId))
    const id = resolvePersonRef(people, wanted, { person: identity.person })
    if (!id) return { ok: false, reason: `档案里没有「${wanted}」` }
    const person = people.find((item) => String(item?.[0]) === String(id))
    return { ok: true, personId: String(id), name: String(person?.[2] ?? '').trim() }
  })

  // ── 召回（面板「召回」）：排进队列，下一轮正文生成前拼进提示词，真注入了才盖章 ──
  // 档位不在面板选（下拉框已删），一律用设置里的 recall.queryLevel。
  ctx.tavern.handle('character-archives/recall-person', async ({ gameId, personId, name } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    if (!String(personId ?? '').trim()) {
      const nameCheck = checkText(String(name ?? '').trim(), '姓名', { max: NAME_MAX, kind: 'name' })
      if (!nameCheck.ok) return { ok: false, reason: nameCheck.reason }
    }
    const state = await loadGameState(ctx.tavern, gameId)
    const turn = state.meta?.updatedTurn
    if (!Number.isInteger(turn)) return { ok: false, reason: '这一局还没结算过' }

    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)
    const people = Array.isArray(snapshot?.p) ? snapshot.p : []
    const identity = await readIdentity(ctx, String(state.meta?.cardKey ?? gameId))
    const id = String(personId ?? '').trim() || resolvePersonRef(people, name, { person: identity.person })
    if (!id || !people.some((item) => String(item?.[0]) === String(id))) {
      return { ok: false, reason: `档案里没有「${String(name ?? '').trim()}」` }
    }

    const settings = resolveSettings(await readScopedSettings(ctx, state))
    const level = normalizeLevel(settings.recall?.queryLevel, 'detailed')

    // 同一个人只排一条（重复点不叠加），队列顺序＝点击顺序
    const pending = (Array.isArray(state.flags?.pendingRecall) ? state.flags.pendingRecall : [])
      .filter((item) => String(item?.personId ?? '').trim() !== String(id))
    pending.push({ personId: String(id), level })
    state.flags.pendingRecall = pending
    await saveGameState(ctx, gameId, state)

    const person = people.find((item) => String(item?.[0]) === String(id))
    return { ok: true, queued: true, personId: String(id), name: String(person?.[2] ?? '').trim(), level }
  })

  // ── 手动改指针（态度 / 来源）──
  // 玩家修模型写错的认知：改的是**来源组**（一条指针最多几组，各自有态度和来源）。
  // 改完把「最后变动轮」推到当前轮——按冷却规则，下一轮自动召回不会重复给。
  ctx.tavern.handle('character-archives/update-pointer', async ({ gameId, personId, claimId, index, state, source } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state0 = await loadGameState(ctx.tavern, gameId)
    const turn = state0.meta?.updatedTurn
    if (!Number.isInteger(turn)) throw new Error('这一局还没结算过')
    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

    const pointer = (snapshot.pt ?? []).find(
      (item) => Array.isArray(item) && String(item[0]) === String(personId) && item[1] === Number(claimId),
    )
    if (!pointer) return { ok: false, reason: '找不到这条指针' }
    const groups = Array.isArray(pointer[2]) ? pointer[2] : []
    const at = Number(index)
    if (!Number.isInteger(at) || at < 0 || at >= groups.length) return { ok: false, reason: '来源组序号不对' }
    const group = groups[at]

    const nextState = Number.isInteger(state) ? state : (Number.isInteger(group?.[0]) ? group[0] : 2)
    if (![0, 1, 2].includes(nextState)) return { ok: false, reason: '态度只能是 真／假／未定' }

    let nextSource = group?.[1] ?? ''
    if (source !== undefined) {
      const text = String(source ?? '').trim()
      if (text === '自己' || text === 'self' || text === '') nextSource = ''
      else if (text === '未知' || text === 'unknown') nextSource = '?'
      else {
        const id = resolvePersonByName(snapshot.p, text)
        if (!id) return { ok: false, reason: `来源「${text}」在档案里找不到` }
        nextSource = id
      }
    }

    const nextGroup = [nextState, nextSource]
    if (typeof group?.[2] === 'string' && group[2].trim()) nextGroup.push(group[2])
    else if (Number.isInteger(group?.[3])) nextGroup.push('')
    if (Number.isInteger(group?.[3])) nextGroup.push(group[3])
    groups[at] = nextGroup
    pointer[2] = groups
    pointer[3] = turn

    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: await currentTextVersion(ctx, gameId, turn) })
    return { ok: true }
  })

  // ── 手动改命题内容（值）──
  // 命题本身**不能改栏目/关于**，只允许改「值」——它被哪些指针指着不受影响。
  ctx.tavern.handle('character-archives/update-claim', async ({ gameId, claimId, text } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state0 = await loadGameState(ctx.tavern, gameId)
    const turn = state0.meta?.updatedTurn
    if (!Number.isInteger(turn)) throw new Error('这一局还没结算过')
    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

    const claim = (snapshot.c ?? []).find((item) => Array.isArray(item) && item[0] === Number(claimId))
    if (!claim) return { ok: false, reason: '找不到这条命题' }
    const checked = checkText(String(text ?? '').trim(), '值', { max: 30 })
    if (!checked.ok) return { ok: false, reason: checked.reason }

    claim[3] = String(text).trim()
    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: await currentTextVersion(ctx, gameId, turn) })
    return { ok: true }
  })

  // ── 条目值搜索（M4-11）：关键词在所有命题内容里做子串匹配，跨人物跨栏目 ──
  // A 方案（字面命中）：玩家输入什么就找什么，不加分词——搜索要的是"我打的字真的在"。
  ctx.tavern.handle('character-archives/search-claims', async ({ gameId, keyword } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const want = String(keyword ?? '').trim()
    if (!want) return { ok: false, reason: '先输入要找的词' }
    if ([...want].length > 50) return { ok: false, reason: '关键词太长了（上限 50 字）' }

    const state = await loadGameState(ctx.tavern, gameId)
    const turn = state.meta?.updatedTurn
    if (!Number.isInteger(turn)) throw new Error('这一局还没结算过')
    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

    const definitions = state.entries ?? {}
    const personById = new Map((snapshot.p ?? []).map((person) => [String(person?.[0]), person]))
    const needle = want.toLowerCase()
    const results = []
    for (const claim of snapshot.c ?? []) {
      if (!Array.isArray(claim)) continue
      const text = String(claim[3] ?? '')
      if (!text.toLowerCase().includes(needle)) continue
      const person = personById.get(String(claim[1]))
      const code = String(claim[2] ?? '')
      results.push({
        claimId: claim[0],
        personId: String(claim[1] ?? ''),
        personName: String(person?.[2] ?? '').trim() || '（未命名）',
        columnName: String(definitions?.[code]?.name ?? code),
        text,
        turn: Number.isInteger(claim[4]) ? claim[4] : null,
      })
      if (results.length >= 50) break
    }
    return { ok: true, results, total: results.length }
  })

  // ── 编辑一条命题的索引词（玩家侧写入口）──
  // 校验复用 filterIndexWords：必须是内容原文片段、≤10 字、去重、类别只认四种。
  // 玩家输入给逗号／顿号分隔的纯文本（简单），类别默认「未分类」——索引词没类别也能命中召回。
  ctx.tavern.handle('character-archives/update-claim-words', async ({ gameId, claimId, words } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const state0 = await loadGameState(ctx.tavern, gameId)
    const turn = state0.meta?.updatedTurn
    if (!Number.isInteger(turn)) throw new Error('这一局还没结算过')
    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

    const claim = (snapshot.c ?? []).find((item) => Array.isArray(item) && item[0] === Number(claimId))
    if (!claim) return { ok: false, reason: '找不到这条命题' }
    const text = String(claim[3] ?? '')

    // 输入：逗号／顿号分隔的词；逐个过白名单（跟名字同一套），再过"必须是内容片段"
    const raw = String(words ?? '').split(/[,，、]/).map((one) => one.trim()).filter(Boolean)
    for (const word of raw) {
      const checked = checkText(word, '索引词', { max: 10 })
      if (!checked.ok) return { ok: false, reason: `索引词「${word}」：${checked.reason}` }
    }
    const cleaned = filterIndexWords(text, raw.map((word) => ({ 词: word })))
    const dropped = raw.filter((word) => !cleaned.some((one) => one.词 === word))
    if (dropped.length) {
      return { ok: false, reason: `这些词不是这条内容的原文片段（或超过 10 字）：${dropped.join('、')}` }
    }

    snapshot.c = (snapshot.c ?? []).map((item) =>
      Array.isArray(item) && item[0] === Number(claimId) ? withClaimWords(item, cleaned) : item,
    )
    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: await currentTextVersion(ctx, gameId, turn) })
    return { ok: true, words: cleaned.map((one) => one.词) }
  })

  // ── 手动加一条「关于他的命题」──
  // 面板「他是什么样」里的「＋」。模型漏写时玩家能补。
  // 顺手给他自己建一条「自己确认过」的指针：没有指针的命题召回拿不到，等于白写。
  ctx.tavern.handle('character-archives/add-claim', async ({ gameId, personId, code, text } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    if (!personId) throw new Error('没指定人物')
    const state0 = await loadGameState(ctx.tavern, gameId)
    const turn = await editTurnOf(ctx, gameId, state0)
    if (!turn) throw new Error('这一局还没有正文，先写一段再加')
    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

    // 同 /set-names：面板上补出来的主角要先真正建进快照
    const identity = await readIdentity(ctx, String(state0.meta?.cardKey ?? gameId))
    const playerState = ensurePlayer(snapshot.p, {
      name: identity.playerName,
      alwaysPresent: identity.person !== 'third',
    })
    if (playerState.changed) snapshot.p = playerState.persons

    const person = (snapshot.p ?? []).find((item) => Array.isArray(item) && item[0] === personId)
    if (!person) return { ok: false, reason: '找不到这个人' }

    const definitions = state0.entries ?? {}
    if (!definitions[code]) return { ok: false, reason: '这个栏目不存在' }
    const label = String(definitions[code]?.name ?? code)

    const checked = checkText(String(text ?? '').trim(), '内容', { max: 30 })
    if (!checked.ok) return { ok: false, reason: checked.reason }
    const value = String(text).trim()

    // 同人同栏目同内容已经有了就别重复建（跟模型写入一个口径）
    if (findClaim(snapshot.c ?? [], { personId, code, text: value })) {
      return { ok: false, reason: `「${label}」里已经有这条了` }
    }

    const claim = addClaim(snapshot.c, { personId, code, text: value, turn, words: [] })
    if (!claim) return { ok: false, reason: '命题建不出来' }

    const pointer = addPointer(snapshot.pt, { personId, claimId: claim[0], turn })
    if (pointer && !hasSelf(pointer)) setEntry(pointer, { state: PTRUTH.TRUE })

    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: await currentTextVersion(ctx, gameId, turn) })
    return { ok: true, claimId: claim[0] }
  })

  // ── 删掉一条命题（面板「他是什么样」每条后面的 🗑）──
  // 删命题＝这句话在这个局里不算数了，所以「谁知道它」一起没：留着指针就是悬空指针，
  // 面板按 id 去查命题会查到空、召回也会拿着不存在的 id 跑。
  ctx.tavern.handle('character-archives/delete-claim', async ({ gameId, claimId } = {}) => {
    if (!gameId) return { ok: false, reason: '没有打开的对局' }
    // 统一成数字再校验：同一行的「改命题」（update-claim）就收数字字符串，
    // 两边口径不一样的话，外部调用会撞出莫名其妙的「命题编号不对」
    const id = Number(claimId)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: '命题编号不对' }
    const state0 = await loadGameState(ctx.tavern, gameId)
    const turn = await editTurnOf(ctx, gameId, state0)
    if (!turn) return { ok: false, reason: '这一局还没有正文，删不了' }
    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

    // 先把指向它的指针收好：dropClaim 只动命题表，摘完再按 claimId 去指针表里翻也行，
    // 但先收一份更省事——也能把「摘掉几条」原样报回面板
    const pointing = pointersTo(snapshot.pt, id)
    if (!dropClaim(snapshot.c, id)) return { ok: false, reason: '找不到这条命题' }
    let removedPointers = 0
    for (const pointer of pointing) {
      if (dropPointer(snapshot.pt, pointer[0], id)) removedPointers += 1
    }

    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: await currentTextVersion(ctx, gameId, turn) })
    return { ok: true, removedPointers }
  })

  // ── 删掉「某人对某条命题的认知」（面板「他的认知」每条后面的 🗑）──
  // **只摘指针，绝不删命题**：命题本身还要在「他是什么样」里当他的档案出现，
  // 顺手删掉的话，这个人就找不到自己那条记录了（两栏是同一批命题的两个视角）。
  ctx.tavern.handle('character-archives/delete-cognition', async ({ gameId, personId, claimId } = {}) => {
    if (!gameId) return { ok: false, reason: '没有打开的对局' }
    if (typeof personId !== 'string' || !personId) return { ok: false, reason: '没指定人物' }
    const id = Number(claimId)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, reason: '命题编号不对' }
    const state0 = await loadGameState(ctx.tavern, gameId)
    const turn = await editTurnOf(ctx, gameId, state0)
    if (!turn) return { ok: false, reason: '这一局还没有正文，删不了' }
    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

    // 最后一条认知不能在这儿删：零指针的命题是"孤儿"，下一轮结算会被
    // `pruneOrphanClaims` 悄悄摘掉（豁免只给本轮新建的命题），而面板承诺的是
    // 「命题本身不动」。要连命题一起删，请走命题行的 🗑（delete-claim）。
    const remaining = pointersTo(snapshot.pt, id)
    if (remaining.length <= 1) {
      return {
        ok: false,
        reason: '这是这条命题的最后一条认知：删掉它这条命题就没人知道了，下一轮会被当孤儿命题清掉。要删请用命题行的 🗑（会连命题一起删）。',
      }
    }

    // 指针里存的是快照里那份编号；面板传过来的写法/类型未必一样（数字、字符串都可能）。
    // 先按字符串找回快照里那个人，再把它**原本**的编号交给 dropPointer（它比的是严格相等）
    const owner = (snapshot.p ?? []).find(
      (item) => Array.isArray(item) && String(item[0]) === String(personId),
    )
    const gone = dropPointer(snapshot.pt, owner ? owner[0] : personId, id)
    if (!gone) return { ok: false, reason: '没有这条认知' }

    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: await currentTextVersion(ctx, gameId, turn) })
    return { ok: true }
  })

  // ── 手动冷档（面板把人拖进「冷档」）──
  // 冷档是**显示层**：不动状态、不动档案内容。
  // ⚠️ 拖出来时必须**同时刷新「最后确认轮次」**——否则程序按「N 轮没动静」还会把他判成冷档，
  // 拖了等于没拖（这是上一版漏掉的）。
  ctx.tavern.handle('character-archives/mark-cold', async ({ gameId, personId, cold = true } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    if (!personId) throw new Error('没指定人物')
    const state = await loadGameState(ctx.tavern, gameId)
    const turn = Number.isInteger(state.meta?.updatedTurn) ? state.meta.updatedTurn : 0
    const next = { ...(state.flags?.coldManual ?? {}) }
    if (cold) {
      next[personId] = true
    } else {
      delete next[personId]
      // 玩家刚把他拖出来 = 重新确认他还在戏里
      state.flags.seen = { ...(state.flags?.seen ?? {}), [String(personId)]: turn }
    }
    state.flags = { ...(state.flags ?? {}), coldManual: next }
    await saveGameState(ctx, gameId, state)
    return { ok: true }
  })

  // ── 手动改状态（在场／离场）──
  ctx.tavern.handle('character-archives/status', async ({ gameId, personId, status } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    if (!personId) throw new Error('没指定人物')
    const state = await loadGameState(ctx.tavern, gameId)
    const turn = await editTurnOf(ctx, gameId, state)
    if (!turn) throw new Error('这一局还没有正文，先写一段再改')

    const { snapshot } = await readSnapshotAt(ctx, gameId, turn)

    // 面板上补出来的主角要先真正建进快照（同 /set-names），否则下面按编号找人会找不到
    const identity = await readIdentity(ctx, String(state.meta?.cardKey ?? gameId))
    const playerState = ensurePlayer(snapshot.p, {
      name: identity.playerName,
      alwaysPresent: identity.person !== 'third',
    })
    if (playerState.changed) snapshot.p = playerState.persons

    // 一/二人称下主角永远在场：面板也不许把他切离场（ADR 0085）
    if (isPlayer(personId) && status === '离场') {
      if (identity.person !== 'third') {
        return { ok: false, reason: '主角在一/二人称下永远在场，不能切成离场' }
      }
    }

    const checked = validatePersonActions(
      [{ 动作: '改状态', 人物: personId, 状态: status }],
      { persons: snapshot.p },
    )
    if (!checked.valid.length) return { ok: false, reason: checked.rejected[0]?.reason ?? '改不了' }

    const applied = applyPersonActions(snapshot.p, checked.valid, { turn })
    for (const action of checked.valid) {
      if (action.type !== 'status') continue
      state.flags.left = action.status === STATUS.OFFLINE
        ? setLeft(state.flags.left, action.id, turn, snapshot.gt)
        : dropLeft(state.flags.left, action.id)
      // 玩家手动切过状态，就不再是「程序按轮次判的模糊离场」——标签撤掉
      if (state.flags.fuzzyLeft && state.flags.fuzzyLeft[action.id] !== undefined) {
        const rest = { ...state.flags.fuzzyLeft }
        delete rest[action.id]
        state.flags.fuzzyLeft = rest
      }
      // 手动改过状态 = 重新确认他还在戏里（否则程序按轮次还会把他打回模糊离场）
      state.flags.seen = { ...(state.flags?.seen ?? {}), [String(action.id)]: turn }
    }
    snapshot.p = applied.persons
    await saveSnapshot(ctx, { gameId, turn, snapshot, textVersion: await currentTextVersion(ctx, gameId, turn) })
    await saveGameState(ctx, gameId, state)
    return { ok: true }
  })

  // ── 模糊建档候选：玩家自己加／删（ADR 0074）──
  ctx.tavern.handle('character-archives/draft-add', async ({ gameId, name } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const label = String(name ?? "").trim()
    const checked = checkText(label, "名字", { max: 24, kind: 'name' })
    if (!checked.ok) return { ok: false, reason: checked.reason }
    // 代词不是名字：第二人称卡里「你」就是主角，加进候选只会一直挂着
    if (isPronounName(label)) return { ok: false, reason: `「${label}」是人称代词，不是名字，不能加候选` }
    const state = await loadGameState(ctx.tavern, gameId)
    const turn = Number.isInteger(state.meta?.updatedTurn) ? state.meta.updatedTurn : 0
    const draft = { ...(state.flags?.draft ?? {}) }
    if (Object.hasOwn(draft, label)) return { ok: false, reason: "已经在候选表里了" }

    // 与档内人同名的不许进候选：建档那一步一定会拒，挂在候选里只会一直烂着、还占素材位置。
    // 模型报的模糊建档本来就有这道检查（actions.js 的 findExisting），这里补的是「手动加」这条路。
    if (turn > 0) {
      const { snapshot } = await readSnapshotAt(ctx, gameId, turn)
      const taken = new Set()
      for (const person of snapshot.p ?? []) {
        for (const one of namesOfPerson(person)) taken.add(one)
      }
      if (taken.has(label)) return { ok: false, reason: `档案里已经有「${label}」了（同名不能建档）` }
    }

    draft[label] = turn
    state.flags = { ...(state.flags ?? {}), draft }
    await saveGameState(ctx, gameId, state)
    return { ok: true, draft }
  })

  ctx.tavern.handle('character-archives/draft-remove', async ({ gameId, name } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const label = String(name ?? "").trim()
    if (!label) throw new Error("没指定要去掉谁")
    const state = await loadGameState(ctx.tavern, gameId)
    const draft = { ...(state.flags?.draft ?? {}) }
    delete draft[label]
    state.flags = { ...(state.flags ?? {}), draft }
    await saveGameState(ctx, gameId, state)
    return { ok: true, draft }
  })

  // ── 手动新建栏目（栏目定义，存整局数据，ADR 0008）──
  ctx.tavern.handle('character-archives/add-entry', async ({ gameId, name } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    const label = String(name ?? '').trim()
    if (!label) return { ok: false, reason: '栏目名不能为空' }
    // 栏目名会拼进提示词表格：换行、引号、竖线都会把表格/JSON 搞坏
    const labelCheck = checkText(label, '栏目', { max: 24 })
    if (!labelCheck.ok) return { ok: false, reason: labelCheck.reason }

    const state = await loadGameState(ctx.tavern, gameId)
    const definitions = state.entries ?? {}
    if (Object.values(definitions).some((item) => item?.name === label)) {
      return { ok: false, reason: `已经有叫「${label}」的栏目了` }
    }

    const code = nextFreeCode(definitions)
    if (!code) return { ok: false, reason: '栏目码用完了（最多 52 个栏目）' }

    state.entries = {
      ...definitions,
      [code]: {
        name: label,
        prompt: '',
        mustRecall: false,
        convention: false,
      },
    }
    await saveGameState(ctx, gameId, state)
    return { ok: true, code }
  })

  // ── 锁 / 眼睛（§8.7）──
  // 两个标记互不联动：锁只管写入，眼睛只管召回。
  ctx.tavern.handle('character-archives/toggle', async ({ gameId, personId, field } = {}) => {
    if (!gameId) throw new Error('没有打开的对局')
    if (!personId) throw new Error('没指定人物')
    if (!['lock', 'hidden', 'star'].includes(field)) throw new Error(`不认识的开关：${field}`)
    const state = await loadGameState(ctx.tavern, gameId)
    const bucket = state.flags?.[field] ?? {}
    const next = bucket[personId] === true ? false : true
    if (next) bucket[personId] = true
    else delete bucket[personId]
    state.flags[field] = bucket
    await saveGameState(ctx, gameId, state)
    return { ok: true, field, personId, value: next }
  })

  // 浏览器侧（侧栏面板、酒馆状态页分节）来取摘要。
  ctx.tavern.handle('character-archives/summary', async ({ gameId } = {}) => {
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
