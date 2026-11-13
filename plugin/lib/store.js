// 自持文件存储：快照与整局数据写文件，酒馆里只留指针
//
// 为什么要自己存：酒馆的会话存储有硬上限（每局 2000 条 / 8MB，每条 64KB）。
// 每轮一份完整快照，几百轮就顶到天花板。文件没有这个限制。
//
// **但版本正确性仍交给酒馆**：每轮只在酒馆里存几十字节的指针（文件名 + 短哈希）。
// 回退/重生成时酒馆会丢掉旧版本的记录 → 我们读不到指针 → 自然读不到"未来"的档案。
//
// 清理学叙事锚定：按轮次窗口保留、index.json 记名单、写完顺手剪枝；
// 被剪掉的**不硬删**，挪进 trash/（玩家可以自己清）。
//
// 这个模块只碰 node:fs，不 import 酒馆接口、不接触 ctx——可以本地单测。

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** 目录里的三类东西。 */
const GAMES = 'games'
const SNAPSHOTS = 'snapshots'
const TRASH = 'trash'

/** 默认保留多少轮的快照（0 = 不清理）。 */
export const DEFAULT_KEEP_TURNS = 200

/** 版本键 → 8 位短哈希（文件名里用，避免特殊字符惹祸）。 */
export function hashKey(key) {
  const text = String(key ?? '')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8)
}

/** 会话 id 可能带斜杠／中文，一律清洗成安全目录名。 */
function safeName(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return 'unknown'
  return text.replace(/[^\w.-]/g, '_').replace(/\.{2,}/g, '_').slice(0, 120) || 'unknown'
}

/** 写文件：先写 .tmp 再 rename，避免半截内容被读到。 */
function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value), 'utf8')
  renameSync(tmp, file)
}

/** 读 JSON：文件不存在或坏掉都返回 null，绝不抛。 */
function readJsonSafe(file) {
  try {
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 把一段路径挪进 trash（不硬删）。返回挪到哪儿了，失败返回 null。 */
function moveToTrash(root, source) {
  try {
    if (!existsSync(source)) return null
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(root, TRASH, `${safeName(basename(source))}-${stamp}`)
    mkdirSync(join(root, TRASH), { recursive: true })
    renameSync(source, target)
    return target
  } catch {
    return null
  }
}

/**
 * 建一个存储。
 * @param {{root:string}} options `root` 是绝对路径（由接线处决定，模块自己不猜）
 */
export function createFileStore({ root } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('createFileStore 需要 root')

  const gamePath = (sessionId) => join(root, GAMES, `${safeName(sessionId)}.json`)
  const snapshotDir = (sessionId) => join(root, SNAPSHOTS, safeName(sessionId))
  const indexPath = (sessionId) => join(snapshotDir(sessionId), 'index.json')
  const snapshotPath = (sessionId, file) => join(snapshotDir(sessionId), file)

  // ── 整局数据 ──

  function readGame(sessionId) {
    return readJsonSafe(gamePath(sessionId))
  }

  function writeGame(sessionId, data) {
    writeJsonAtomic(gamePath(sessionId), data)
    return true
  }

  /** 这一局有没有自己的数据文件（分叉继承用来判「已经搬过了」，也用来做幂等）。 */
  function hasGame(sessionId) {
    return existsSync(gamePath(sessionId))
  }

  // ── 快照 ──

  /**
   * 读磁盘上真实存在的快照文件，**不信任 index.json**（它坏了也要能读）。
   * @returns {Array<{turn:number, file:string, hash:string}>}
   */
  function listSnapshots(sessionId) {
    const dir = snapshotDir(sessionId)
    if (!existsSync(dir)) return []
    const out = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json') || name === 'index.json') continue
      const matched = name.match(/^(\d+)-([0-9a-f]+)\.json$/)
      if (!matched) continue
      out.push({ turn: Number(matched[1]), hash: matched[2], file: name })
    }
    return out.sort((a, b) => a.turn - b.turn)
  }

  function readIndex(sessionId) {
    const index = readJsonSafe(indexPath(sessionId))
    return Array.isArray(index?.turns) ? index.turns : null
  }

  function writeIndex(sessionId, turns) {
    writeJsonAtomic(indexPath(sessionId), { version: 1, turns })
  }

  /**
   * 写一份快照，返回给酒馆存的小指针。
   * 同一轮换了版本（重生成）时，**旧文件挪进 trash**，不留两份。
   * @returns {{f:string, h:string}}
   */
  function writeSnapshot(sessionId, { turn, key = '', data } = {}) {
    const index = Number.isInteger(turn) ? turn : 0
    const hash = hashKey(key)
    const file = `${index}-${hash}.json`

    // 同轮换版本的旧文件先清走，避免窗口内堆两份
    for (const item of listSnapshots(sessionId)) {
      if (item.turn !== index) continue
      if (item.file === file) continue
      moveToTrash(root, snapshotPath(sessionId, item.file))
    }

    writeJsonAtomic(snapshotPath(sessionId, file), data ?? null)

    const kept = (readIndex(sessionId) ?? listSnapshots(sessionId).map((item) => ({ turn: item.turn, file: item.file, hash: item.hash })))
      .filter((item) => item.turn !== index)
    kept.push({ turn: index, file, hash })
    kept.sort((a, b) => a.turn - b.turn)
    writeIndex(sessionId, kept)

    return { f: file, h: hash }
  }

  /** 读某一轮的快照；没有就返回 null（不回溯，回溯由调用方决定）。 */
  function readSnapshot(sessionId, turn) {
    const index = Number.isInteger(turn) ? turn : 0
    const entry = listSnapshots(sessionId).find((item) => item.turn === index)
    if (!entry) return null
    const data = readJsonSafe(snapshotPath(sessionId, entry.file))
    return data ? { data, file: entry.file, hash: entry.hash } : null
  }

  /**
   * 按轮次窗口剪枝。被剪的挪进 trash，不硬删。
   * @param {{keepTurns?:number, currentTurn?:number}} options
   * @returns {{removed:number[]}}
   */
  function pruneSnapshots(sessionId, { keepTurns = DEFAULT_KEEP_TURNS, currentTurn = 0 } = {}) {
    const window = Number.isFinite(keepTurns) ? Math.max(0, Math.floor(keepTurns)) : DEFAULT_KEEP_TURNS
    if (window === 0) return { removed: [] }        // 0 = 不清理

    const cutoff = (Number.isInteger(currentTurn) ? currentTurn : 0) - window
    if (cutoff < 1) return { removed: [] }

    const removed = []
    for (const item of listSnapshots(sessionId)) {
      if (item.turn > cutoff) continue
      if (moveToTrash(root, snapshotPath(sessionId, item.file))) removed.push(item.turn)
    }
    if (removed.length) {
      const kept = (readIndex(sessionId) ?? []).filter((item) => !removed.includes(item.turn))
      writeIndex(sessionId, kept)
    }
    return { removed }
  }

  /**
   * 分叉：把父局「分叉点及之前」的快照搬给子局，并写子局的 index.json（ADR 0110）。
   *
   * 三条讲究：
   * 1. **以父局索引为准**——父局同一轮可能有残留的两份文件（换版本时 `moveToTrash` 失败会静默
   *    返回 null），索引只认其中一份；照文件搬会把同一轮搬成两条，面板列出重复轮次。
   * 2. **子局已有的索引按轮合并**，不是整片覆盖——否则子局自己的文件变成索引外的孤儿。
   * 3. **只搬 ≤ 分叉轮**：分叉点是「过去」，之后的快照属于还没发生的未来。
   *
   * @returns {number} 搬了几份
   */
  function copySnapshotsUpTo(fromSessionId, toSessionId, upToTurn) {
    const from = String(fromSessionId ?? '')
    const to = String(toSessionId ?? '')
    const cut = Number.isInteger(upToTurn) && upToTurn >= 1 ? upToTurn : 0
    if (!from || !to || from === to || !cut) return 0

    const wanted = new Map()
    const parentIndex = readIndex(from)
    if (parentIndex?.length) {
      for (const item of parentIndex) {
        const turn = Number(item?.turn)
        if (!Number.isInteger(turn) || turn > cut || !item?.file) continue
        wanted.set(turn, { turn, file: String(item.file), hash: String(item.hash ?? '') })
      }
    }
    if (!wanted.size) {
      // 索引缺失或坏掉：退回按文件名找。同一轮取最后一份——没有更好的线索，至少不搬成两条。
      for (const item of listSnapshots(from)) {
        if (item.turn > cut) continue
        wanted.set(item.turn, item)
      }
    }

    const existing = new Map()
    for (const item of readIndex(to) ?? []) {
      const turn = Number(item?.turn)
      if (!Number.isInteger(turn) || !item?.file) continue
      existing.set(turn, { turn, file: String(item.file), hash: String(item.hash ?? '') })
    }

    let copied = 0
    for (const item of [...wanted.values()].sort((a, b) => a.turn - b.turn)) {
      const data = readJsonSafe(snapshotPath(from, item.file))
      if (data == null) continue        // 文件丢了／坏了：跳过，别把 null 写成一份"空快照"
      const old = existing.get(item.turn)
      // 同一轮换了文件：把子局那份旧文件挪 trash（不硬删），别留成同名轮的两份
      if (old && old.file !== item.file) moveToTrash(root, snapshotPath(to, old.file))
      writeJsonAtomic(snapshotPath(to, item.file), data)
      existing.set(item.turn, { turn: item.turn, file: item.file, hash: item.hash })
      copied += 1
    }

    const merged = [...existing.values()].sort((a, b) => a.turn - b.turn)
    if (merged.length) writeIndex(to, merged)
    return copied
  }

  /** 删局：整目录挪进 trash。 */
  function dropGame(sessionId) {
    const moved = moveToTrash(root, snapshotDir(sessionId))
    const gameMoved = moveToTrash(root, gamePath(sessionId))
    return { moved: Boolean(moved || gameMoved) }
  }

  /**
   * 回退清理：把「turn 之后」的快照全部挪进 trash（不硬删）。
   *
   * 玩家回退后开始下一轮时调用：那些轮次已经不存在了，快照留着只会被误读。
   * 命题与指针就住在快照里，旧快照删掉它们自然就没了。
   *
   * @returns {{removed:number[]}}
   */
  function pruneAfter(sessionId, turn) {
    const cut = Number.isInteger(turn) && turn >= 1 ? turn : 0
    if (!cut) return { removed: [] }

    const removed = []
    for (const item of listSnapshots(sessionId)) {
      if (item.turn <= cut) continue
      if (moveToTrash(root, snapshotPath(sessionId, item.file))) removed.push(item.turn)
    }
    if (removed.length) {
      const kept = (readIndex(sessionId) ?? []).filter((item) => !removed.includes(item.turn))
      writeIndex(sessionId, kept)
    }
    return { removed }
  }

  // ── 全局专名词库（ADR 0077）──
  // **跨局**数据（地名、店名、组织名），跟"这一局"无关，所以放数据根下单独一个文件，
  // 不进插件数据（那边 256 KB 已经被设置/提示词挤着了）。

  const globalWordsPath = () => join(root, 'global-words.json')

  function readGlobalWords() {
    return readJsonSafe(globalWordsPath())
  }

  function writeGlobalWords(data) {
    writeJsonAtomic(globalWordsPath(), data ?? null)
    return true
  }

  // ── 已删除名单（按会话）──
  // 玩家手动删掉的人物记在这里：程序据此**拒绝模型重建**，面板据此给「恢复 / 永久删除」。
  // 存独立的 deleted/ 目录，删局时一起挪进 trash。

  const deletedPath = (sessionId) => join(root, 'deleted', `${String(sessionId)}.json`)

  /** 读已删除名单；没有就返回 []。 */
  function readDeleted(sessionId) {
    const data = readJsonSafe(deletedPath(sessionId))
    return Array.isArray(data?.people) ? data.people : []
  }

  /** 写已删除名单（原子写）。传空数组就是清掉这份名单。 */
  function writeDeleted(sessionId, people) {
    writeJsonAtomic(deletedPath(sessionId), { version: 1, people: Array.isArray(people) ? people : [] })
  }

  /** 删局的收尾：把名单挪进 trash，不硬删。 */
  function dropDeleted(sessionId) {
    return { moved: Boolean(moveToTrash(root, deletedPath(sessionId))) }
  }

  /**
   * 分叉：已删名单跟着走（ADR 0110）。
   *
   * 不带过去的话，父局里删过的人到了新分支会被模型重新建档——玩家删了个寂寞。
   *
   * @returns {number} 搬了几个人（0＝父局没删过人，不落空文件）
   */
  function copyDeleted(fromSessionId, toSessionId) {
    const from = String(fromSessionId ?? '')
    const to = String(toSessionId ?? '')
    if (!from || !to || from === to) return 0
    const people = readDeleted(from)
    if (!people.length) return 0
    writeDeleted(to, people)
    return people.length
  }

  /**
   * 清空 trash（P22③：trash 只涨不清，从来没回收）。
   *
   * trash 里的东西都是「确认不要了」的死数据（剪枝、回退、删局、删人挪进去的），
   * 所以这里是**真删**——不走系统回收站，trash 本身就是我们的回收站。
   *
   * @param {{maxAgeDays?:number}} options
   *   maxAgeDays：只删「文件名时间戳早于 N 天前」的；不传＝全清（「立即清理」按钮用）。
   * @returns {{removed:number, freedBytes:number}}
   */
  function emptyTrash({ maxAgeDays = undefined } = {}) {
    const dir = join(root, TRASH)
    if (!existsSync(dir)) return { removed: 0, freedBytes: 0 }
    const cutoff = Number.isFinite(maxAgeDays) && maxAgeDays > 0
      ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
      : 0
    let removed = 0
    let freedBytes = 0
    for (const entry of readdirSync(dir)) {
      const file = join(dir, entry)
      let stat
      try { stat = statSync(file) } catch { continue }
      // 文件名自带时间戳（moveToTrash 拼的 `-YYYY-MM-DDT…`），解析失败就用文件的修改时间兜底
      const at = stampedAt(entry) ?? stat.mtimeMs
      if (cutoff && at > cutoff) continue
      try {
        freedBytes += stat.isDirectory() ? dirSize(file) : stat.size
        rmSync(file, { recursive: true, force: true })
        removed += 1
      } catch { /* 单个失败不挡后面的 */ }
    }
    return { removed, freedBytes }
  }

  /** 从 trash 文件名里解析挪入时间（`名字-2026-11-05T12-30-00-000Z`）。解析不出返回 null。 */
  function stampedAt(name) {
    const matched = String(name).match(/-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)$/)
    if (!matched) return null
    const at = Date.parse(matched[1].replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1:$2:$3.$4Z'))
    return Number.isFinite(at) ? at : null
  }

  /** 递归算目录大小（给「释放了多少」的回执用）。 */
  function dirSize(path) {
    let total = 0
    for (const entry of readdirSync(path)) {
      const stat = statSync(join(path, entry))
      total += stat.isDirectory() ? dirSize(join(path, entry)) : stat.size
    }
    return total
  }

  return {
    root,
    readGame,
    writeGame,
    hasGame,
    readSnapshot,
    writeSnapshot,
    listSnapshots,
    copySnapshotsUpTo,
    pruneSnapshots,
    pruneAfter,
    emptyTrash,
    dropGame,
    readGlobalWords,
    writeGlobalWords,
    readDeleted,
    writeDeleted,
    copyDeleted,
    dropDeleted,
  }
}
