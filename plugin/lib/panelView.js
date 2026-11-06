// 面板数据：把快照翻成分组、可直接渲染的结构（设计稿 §8.1～§8.3、§7.11）
//
// 浏览器侧只负责画，不负责算——分组、冷档、排序、认知条数都在这里做完，
// 这样面板逻辑能本地单测，改界面不用怕算错。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { STATUS } from './snapshot.js'
import { splitAliases } from './names.js'
import { PLAYER_ID } from './player.js'
import { wordsOfClaim, autoWordsOf } from './indexWords.js'

/** 沉降默认轮数（§7.11）。 */
export const DORMANT_TURNS = 20

/**
 * @param {object} input
 * @param {{t?:number, gt?:string, p?:any[][]}} input.snapshot 当前快照
 * @param {object} input.definitions 栏目定义（码 → { name, ... }）
 * @param {Set<string>} [input.checkedCodes] 玩家勾选的栏目码；不传或空集＝全部栏目都显示
 * @param {Record<string,boolean>} [input.lock] 人物级锁
 * @param {Record<string,boolean>} [input.hidden] 眼睛闭上
 * @param {Record<string,number>} [input.seen] 最后确认轮次（沉降用）
 * @param {number} [input.now] 当前轮次
 * @param {number} [input.dormantTurns] 沉降轮数
 * @param {Set<string>} [input.starIds] ★ 重要人物（不沉降）
 * @returns {{turn:number, gt:string, groups:{present:any[],offline:any[]}, stats:object}}
 */
export function buildPanelView({
  snapshot = undefined,
  definitions = {},
  checkedCodes = undefined,
  lock = {},
  hidden = {},
  seen = {},
  fuzzyLeft = {},
  coldManual = {},
  now = 0,
  dormantTurns = DORMANT_TURNS,
  starIds = new Set(),
  draft = {},
} = {}) {
  const persons = Array.isArray(snapshot?.p) ? snapshot.p : []
  const turn = Number.isInteger(snapshot?.t) ? snapshot.t : 0
  const gt = typeof snapshot?.gt === 'string' ? snapshot.gt : ''
  const loc = typeof snapshot?.loc === 'string' ? snapshot.loc : ''
  const threshold = Number.isFinite(dormantTurns) ? dormantTurns : DORMANT_TURNS

  // 认知（指针）：每个人"知道的事" + 每条的态度/来源。面板上要能就地改。
  const claims = Array.isArray(snapshot?.c) ? snapshot.c.filter((claim) => Array.isArray(claim)) : []
  const claimById = new Map()
  for (const claim of claims) {
    claimById.set(claim[0], claim)
  }
  const personById = new Map()
  for (const person of persons) {
    if (Array.isArray(person)) personById.set(String(person[0]), person)
  }
  const pointers = Array.isArray(snapshot?.pt) ? snapshot.pt.filter((one) => Array.isArray(one)) : []
  const pointersByPerson = new Map()
  for (const pointer of pointers) {
    const key = String(pointer[0] ?? '')
    const list = pointersByPerson.get(key) ?? []
    list.push(pointer)
    pointersByPerson.set(key, list)
  }
  const ATTITUDE_LABEL = { 0: '真', 1: '假', 2: '未定' }
  const nameOfId = (value) => String(personById.get(String(value))?.[2] ?? '').trim()

  // 「关于他的命题的指针」：记着关于这个人某件事的指针（别人的、也可以是他自己的）。
  // 变化可见要用它——改他的档案时动的是这类指针，他自己的认知指针根本没动。
  // 同一条命题可能被几个人记着，所以取最大值（最后一次动静）。
  const aboutPointerTurn = new Map()
  for (const pointer of pointers) {
    const claim = claimById.get(pointer[1])
    const aboutId = String(claim?.[1] ?? '')
    if (!aboutId) continue
    const lastTurn = Number.isInteger(pointer[3]) ? pointer[3] : 0
    aboutPointerTurn.set(aboutId, Math.max(aboutPointerTurn.get(aboutId) ?? 0, lastTurn))
  }

  // 面板上列哪些栏目：按栏目定义的顺序，只取勾选的；没勾选过（老局）就全给。
  const codes = checkedCodes instanceof Set ? checkedCodes : new Set(checkedCodes ?? [])
  const columnCodes = Object.keys(definitions ?? {}).filter((code) => codes.size === 0 || codes.has(code))

  const rows = persons.map((person) => {
    const [id, status, rawName] = person
    const name = String(rawName ?? '').trim()
    const lastSeen = Number.isInteger(seen?.[id]) ? seen[id] : null
    const gap = lastSeen === null ? 0 : Math.max(0, now - lastSeen)
    // 冷档：程序按「N 轮没动静」判，或玩家手动拖进来的（只影响显示，不改状态、不改数据）
    // 主角永不冷档——他是玩家自己，不是"没人提起的配角"；★ 同样豁免。
    const cold = (gap >= threshold || coldManual?.[id] === true)
      && !starIds.has(String(id))
      && String(id) !== PLAYER_ID

    // 他的认知：每条指针 = 一条命题 + 若干来源组（态度/来源/时间/约定状态）
    const ownPointers = pointersByPerson.get(String(id)) ?? []
    const cognitions = ownPointers.map((pointer) => {
      const claim = claimById.get(pointer[1])
      const aboutId = String(claim?.[1] ?? '')
      const code = String(claim?.[2] ?? '')
      return {
        claimId: pointer[1],
        code,
        // 栏目名：命题第 3 位存的是码，面板要显示人能看懂的名字
        columnName: String(definitions?.[code]?.name ?? code),
        text: String(claim?.[3] ?? ''),
        words: wordsOfClaim(claim),
        // 程序自动分出来的词（仅展示，不落盘）：玩家看不到它就会以为"这人没索引词，
        // 凭什么被召回"。现算的好处是泛词表一改、所有老档案立刻按新规则算（ADR 0107）。
        autoWords: autoWordsOf(claim?.[3], wordsOfClaim(claim)),
        aboutName: nameOfId(aboutId),
        lastTurn: Number.isInteger(pointer[3]) ? pointer[3] : 0,
        groups: (Array.isArray(pointer[2]) ? pointer[2] : []).map((group, index) => ({
          index,
          state: Number.isInteger(group?.[0]) ? group[0] : 2,
          stateLabel: ATTITUDE_LABEL[Number(group?.[0])] ?? '未定',
          source: String(group?.[1] ?? ''),
          sourceName: group?.[1] === '' ? '自己' : group?.[1] === '?' ? '未知' : nameOfId(group?.[1]) || '未知',
          gt: typeof group?.[2] === 'string' ? group[2] : '',
          convention: Number.isInteger(group?.[3]) ? group[3] : null,
        })),
      }
    })

    // 最后变动轮：两边取最大值——他自己的认知指针 + 关于他的命题指针（都没有就是 0）。
    // 只算一边会漏：改他的档案时他自己的指针没动，动的是「关于他」的那条。
    const lastChangeTurn = Math.max(
      aboutPointerTurn.get(String(id)) ?? 0,
      ...ownPointers.map((pointer) => (Number.isInteger(pointer[3]) ? pointer[3] : 0)),
    )

    return {
      id,
      name,
      // 主角标签：面板上必须一眼看出"这是玩家本人"。
      // 尤其第二人称卡里主角名常常就是「你」，不加标签会被当成误建档的 NPC。
      isPlayer: String(id) === PLAYER_ID,
      // 重要人物（★）：召回升到 60% 预算份额，且不会被沉到冷档
      starred: starIds.has(String(id)),
      aliases: splitAliases(person?.[3]).join(','),
      status,
      cognitions,
      // 「他是什么样」：**关于他的命题**，按栏目分组。空栏目也列出来——玩家才知道该补哪一栏。
      // 只收 claim[1] === 他 的命题；「他知道别人的事」在 cognitions 里，两个视角别混。
      aboutColumns: columnCodes.map((code) => ({
        code,
        name: String(definitions?.[code]?.name ?? code),
        claims: claims
          .filter((claim) => String(claim[1] ?? '') === String(id) && String(claim[2] ?? '') === code)
          .map((claim) => ({ claimId: claim[0], text: String(claim[3] ?? ''), words: wordsOfClaim(claim), autoWords: autoWordsOf(claim[3], wordsOfClaim(claim)) })),
      })),
      // 「按认知浏览」：他的指针按**命题的栏目**分组——「老陈认为周砚的职业是画师」会落在「职业」下面。
      // 只列有内容的栏目（认知视角不补空），跟 aboutColumns 的数据源不同，别混。
      cognitionColumns: columnCodes
        .map((code) => ({
          code,
          name: String(definitions?.[code]?.name ?? code),
          items: cognitions.filter((cog) => cog.code === code),
        }))
        .filter((col) => col.items.length > 0),
      unnamed: !name,
      // 单字名要标出来：他可能召不回来——正文里「景」常是「景公子」的一部分，
      // 分词切不走，词边界判不准。玩家看到提示就知道该给他加个别名。
      singleCharName: [...name].length === 1,
      locked: lock?.[id] === true,
      hidden: hidden?.[id] === true,
      // 程序按轮次判的「模糊离场」：面板要给个标签，玩家点一下状态按钮就能拉回在场
      fuzzyLeft: fuzzyLeft?.[id] !== undefined,
      cold,
      lastSeen,
      // 变化可见：面板靠这两个字段把「本轮被动过的人」顶到上面、亮一个圆点。
      lastChangeTurn,
      // 要判 `> 0`：空局里 turn 和 lastChangeTurn 都是 0，光比 `===` 会给所有人亮圆点
      // （"还没有任何一轮"不等于"这一轮变了"）。
      changedThisTurn: lastChangeTurn > 0 && lastChangeTurn === turn,
      // 面板的删除确认要写"N 条会一起进已删除"。
      // **认知条数**（指针数）才是新模型下真正的"他记得多少"。
      cognitionCount: ownPointers.length,
    }
  })

  // 置顶优先级：**主角 → ★ 重要人物 → 最后变动轮 → 最近露面 → 名字**。
  // 主角不是"被召回的对象"，是玩家自己；★ 是玩家点名要重点照顾的人。
  // 变动轮排在露面之前：刚被改过档案的人 lastSeen 往往没动（被提到 ≠ 被改动），
  // 只按露面排会把他压到下面，而扫读时最该先看到的正是他。
  const sortRows = (list) => list.slice().sort((a, b) => {
    if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1
    if (a.starred !== b.starred) return a.starred ? -1 : 1
    // 「最近有动静」＝露面轮次和改动轮次里**较大的**那个。
    // 单拿改动轮比不行：那是绝对轮次，第 3 轮记过一笔的人会永远压过第 40 轮刚出场的人。
    const seenOf = (row) => (row.lastSeen === null ? 0 : row.lastSeen)
    const recentOf = (row) => Math.max(row.lastChangeTurn || 0, seenOf(row))
    if (recentOf(b) !== recentOf(a)) return recentOf(b) - recentOf(a)
    // 最近轮次打平：刚改过档案的排前面（"改"比"被提到"更值得先看）
    if (b.lastChangeTurn !== a.lastChangeTurn) return b.lastChangeTurn - a.lastChangeTurn
    if (seenOf(b) !== seenOf(a)) return seenOf(b) - seenOf(a)
    return String(a.name).localeCompare(String(b.name))
  })

  // 分组顺序（面板从上往下）：模糊建档（在 client 里）→ 在场 → 模糊离场 → 离场 → 冷档。
  // 「冷档」单独成组、沉到最底：它是"长期没动静"，跟在场/离场不是同一个维度，
  // 混在里面会让人以为他还在场（或已经走了）。
  const coldRows = sortRows(rows.filter((row) => row.cold))
  const present = sortRows(rows.filter((row) => row.status === STATUS.PRESENT && !row.cold))
  const fuzzyOffline = sortRows(
    rows.filter((row) => row.status !== STATUS.PRESENT && row.fuzzyLeft && !row.cold),
  )
  const offline = sortRows(
    rows.filter((row) => row.status !== STATUS.PRESENT && !row.fuzzyLeft && !row.cold),
  )

  // 模糊建档候选：玩家要能看见（以前只能翻调试日志）
  // `at` 是**最后一次露面的轮次**（ADR 0075，不是入表轮次），
  // 所以 gap＝已经几轮没露面；超过设置里的上限，程序会把这条清掉。
  const draftRows = Object.entries(draft ?? {})
    .map(([name, at]) => ({
      name,
      at: Number.isInteger(at) ? at : null,
      gap: Number.isInteger(at) && Number.isInteger(now) ? Math.max(0, now - at) : null,
    }))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))

  return {
    turn,
    gt,
    loc,
    draft: draftRows,
    groups: { present, fuzzyOffline, offline, cold: coldRows },
    stats: {
      total: rows.length,
      present: present.length,
      fuzzyOffline: fuzzyOffline.length,
      offline: offline.length,
      cold: coldRows.length,
    },
  }
}
