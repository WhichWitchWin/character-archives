// 人物级动作：建档 / 改状态 / 改名 / 模糊建档，以及姓名／别名／身份校验（§2、ADR 0024、ADR 0035）。
//
// 模型返回的是纯 JSON 数组，程序必须**先校验再落盘**：任何一条不合法就整条丢掉并记日志，
// 绝不"部分写入"——半条脏数据比没有更糟。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { STATUS } from './snapshot.js'
import { checkText, NAME_MAX } from './inputLimit.js'
import { PLAYER_ID, isPronounName } from './player.js'
import { namesOfPerson, splitAliases } from './names.js'

// ---------- 人物级动作：建档 / 改状态 / 改名 / 模糊建档 ----------

const PERSON_ACTIONS = new Set(['建档', '改状态', '改名', '模糊建档'])

const STATUS_MAP = Object.freeze({
  在场: STATUS.PRESENT,
  离场: STATUS.OFFLINE,
})

/** 这个称呼是不是已经在档里（姓名或别名任一撞上）。 */
function findExisting(persons, name) {
  const target = String(name ?? '').trim()
  if (!target) return null
  for (const person of persons) {
    const [, , personName, aliases] = person
    if (String(personName ?? '').trim() === target) return person
    if (splitAliases(aliases).includes(target)) return person
  }
  return null
}


/**
 * 检查一条建档动作的别名是不是能用。
 *
 * 三条规矩：
 *   1. 别名和自己姓名重复 → 直接去掉，不算错；
 *   2. 别名撞任何已有姓名／别名／主角名 → **整条拒**（撞了会让写入链路静默丢数据）；
 *   3. **单字姓名必须配一个 ≥2 字的别名**——「周」喊一声一堆人回头，
 *      「周老板」才只有一个人回头（ADR 0031 回头测试的同一条道理）。
 *
 * @returns {{reason: string}|{aliases: string[]}}
 */
function checkAliases({ name, rawAliases, list, mains }) {
  const aliases = []
  for (const alias of rawAliases) {
    if (alias === name) continue
    if (aliases.includes(alias)) continue
    if (mains.has(alias)) return { reason: `别名「${alias}」是主角的名字，不能用` }
    const taken = findExisting(list, alias)
    if (taken) return { reason: `别名「${alias}」已经归「${taken[2]}」了` }
    aliases.push(alias)
  }

  // 单字姓名不再强制配别名：有了分词，词边界能判准（ADR 0060）。
  // 但**回头测试仍然要过**（ADR 0031）——那是模型在建档前的判断，程序不代替它。
  return { aliases }
}

/** 这个称呼能对上几个人（姓名或别名都算）。 */
function countByName(persons, name) {
  const target = String(name ?? '').trim()
  if (!target) return 0
  return (persons ?? []).filter((person) => {
    if (String(person?.[2] ?? '').trim() === target) return true
    const aliases = splitAliases(person?.[3])
    return aliases.includes(target)
  }).length
}

/**
 * 定位「模型／玩家说的这个人是谁」，比 `resolvePersonByName` 多认一层**人称代词**。
 *
 * 第二人称写作时正文满篇「你」，模型报「谁＝你」指的**就是主角本人**；第一人称同理（「我」）。
 * 不映射的后果不是"多建一个人"，而是**主视角的认知永远记不进来**——找不到人，整条被拒。
 *
 * **第三人称不映射**：那时「他」可能指任何一个男性角色，猜不起。
 *
 * @param {any[][]} persons
 * @param {string} name 模型报的名字
 * @param {{person?:string, playerId?:string}} [options] person 是 identity 里的写作人称
 * @returns {string|null}
 */
export function resolvePersonRef(persons, name, { person = '', playerId = 'p0' } = {}) {
  const text = String(name ?? '').trim()
  const pronoun = person === 'second' ? '你' : person === 'first' ? '我' : ''
  if (pronoun && text === pronoun) {
    const player = (persons ?? []).find((item) => Array.isArray(item) && item[0] === playerId)
    // 主角档必须真的存在：没有 p0 就别硬造一个命中
    if (player) return playerId
  }
  return resolvePersonByName(persons, text)
}

/**
 * 按**人名**定位人物编号。模型只报人名、不报编号（ADR 0048）。
 *
 * - 名字唯一命中 → 返回编号；
 * - **重名**（对上 2 个以上）→ 返回 null，绝不猜；
 * - 找不到 → 返回 null；
 * - 名字后面带 `(p7)` 这种尾巴（重名时素材会这么写）→ 按编号直接定位。
 * @returns {string|null}
 */
export function resolvePersonByName(persons, name) {
  const raw = String(name ?? '').trim()
  if (!raw) return null
  const list = persons ?? []

  // ① 先按**完整名字**找（姓名或别名都算）。
  // 名字本身可能带括号——「老王（大爷）」不能一上来就被当成年份尾巴拆开，
  // 否则这个人从此按名字写不进去，而且没有任何提示（ADR 0084）。
  if (countByName(list, raw) === 1) {
    const exact = list.find((person) => namesOfPerson(person).includes(raw)) ?? null
    if (exact) return String(exact[2] ?? '').trim() ? exact[0] : null
  }

  // ② 直接给了编号（内部调用 / 老数据）也认；模型看不到编号，正常不会走到这里
  if (/^p\d+$/u.test(raw) && list.some((person) => person?.[0] === raw)) return raw

  // ③ 素材里重名者的写法：名字后面带 `(p7)` 尾巴
  const tail = raw.match(/^(.*?)\s*[(（]\s*([^)）]+)\s*[)）]\s*$/u)
  if (tail) {
    const id = tail[2].trim()
    const person = list.find((item) => item?.[0] === id) ?? null
    // 尾巴指向空姓名的人同样不给写入：他连门牌号都没有
    return person && String(person[2] ?? '').trim() ? id : null
  }

  return null
}

/**
 * 改一个人的名字（姓名，可选同时改别名）——面板操作。
 *
 * 规矩和建档**完全一样**：姓名与别名共用一个池子、按对局唯一，主角名不能占；
 * 姓名不许留空——没有姓名的人既召回不到、也写不进去（ADR 0084）。
 *
 * **为什么姓名和别名要能一起提交**：分开改会卡死——别名不许等于「现在的姓名」，
 * 姓名又不许撞「现在的别名」，于是「把旧姓名挪进别名 + 换一个新姓名」就得靠
 * 占位符绕两圈。一起提交时按**提交后的样子**校验：只要结果里没有重复就放行。
 *
 * 返回**新数组**，不动传进来的那一份（和 applyPersonActions 同一个习惯）。
 *
 * @param {any[][]} persons
 * @param {{id?:string, name?:string,
 *          aliases?:string|string[]|undefined,
 *          mainNames?:string[],
 *          keepOldName?:boolean}} input
 *   aliases：不传＝保持原样；传空串＝清空。
 *   keepOldName：改名时把**旧姓名**追加进别名（主角改名用——旧称呼以后还可能被叫到）。
 * @returns {{ok:true, persons:any[][], reason:null} | {ok:false, persons:null, reason:string}}
 */
export function setPersonNames(persons, { id, name, aliases = undefined, mainNames = [], keepOldName = false } = {}) {
  const list = Array.isArray(persons) ? persons : []
  const index = list.findIndex((person) => Array.isArray(person) && person[0] === id)
  if (index < 0) return { ok: false, persons: null, reason: '找不到这个人' }

  const target = String(name ?? '').trim()
  const checked = checkText(target, '姓名', { max: NAME_MAX, kind: 'name' })
  if (!checked.ok) return { ok: false, persons: null, reason: checked.reason }

  const oldName = String(list[index]?.[2] ?? '').trim()
  const nextAliases = aliases === undefined ? splitAliases(list[index]?.[3]) : splitAliases(aliases)
  // 改名后旧名字还能被叫到：自动进别名（已经在里面、或者跟新名字一样就不重复加）
  if (keepOldName && oldName && oldName !== target && !nextAliases.includes(oldName)) {
    nextAliases.push(oldName)
  }
  for (const alias of nextAliases) {
    const aliasCheck = checkText(alias, '别名', { max: NAME_MAX, kind: 'name' })
    if (!aliasCheck.ok) return { ok: false, persons: null, reason: aliasCheck.reason }
  }

  const mains = new Set(
    (Array.isArray(mainNames) ? mainNames : []).map((item) => String(item ?? '').trim()).filter(Boolean),
  )
  if (mains.has(target)) return { ok: false, persons: null, reason: `「${target}」是主角的名字，不能用` }
  if (nextAliases.includes(target)) {
    return { ok: false, persons: null, reason: `姓名和别名不能是同一个：「${target}」` }
  }
  const aliasMain = nextAliases.find((one) => mains.has(one))
  if (aliasMain) return { ok: false, persons: null, reason: `别名「${aliasMain}」是主角的名字，不能用` }

  // 别人占着的名字。他自己的名字不算被占——否则原样保存也会被判撞名。
  const taken = new Map()
  list.forEach((person, at) => {
    if (at === index) return
    const owner = String(person?.[2] ?? '').trim() || '另一个人'
    for (const one of namesOfPerson(person)) {
      if (!taken.has(one)) taken.set(one, owner)
    }
  })

  const owner = taken.get(target)
  if (owner) return { ok: false, persons: null, reason: `「${target}」已经归「${owner}」了` }
  for (const alias of nextAliases) {
    const aliasOwner = taken.get(alias)
    if (aliasOwner) return { ok: false, persons: null, reason: `别名「${alias}」已经归「${aliasOwner}」了` }
  }

  const next = list.map((person, at) => {
    if (at !== index) return person
    const copy = [...person]
    copy[2] = target
    copy[3] = nextAliases.join(',')
    return copy
  })
  return { ok: true, persons: next, reason: null }
}

/** 只改姓名（别名原样不动）——人物行上 `✏` 那个入口用的就是它。 */
export function renamePerson(persons, { id, name, mainNames = [] } = {}) {
  return setPersonNames(persons, { id, name, mainNames })
}

/** 按编号或姓名找人（内部用；重名时按第一个，只给不关心歧义的场合）。 */
function findPerson(persons, key) {
  const target = String(key ?? '').trim()
  if (!target) return null
  const byId = persons.find((person) => person?.[0] === target)
  if (byId) return byId
  return findExisting(persons, target)
}

/**
 * 校验人物级动作。不合法的整条丢弃。
 * @param {any[]} actions
 * @param {{persons?:any[][], draft?:object, mainNames?:string[]}} options
 *   mainNames：主角的名字，跟它同名一律拒绝建档（ADR 0024）
 * @returns {{valid: any[], rejected: Array<{action:any, reason:string}>}}
 */
export function validatePersonActions(actions, {
  persons = [],
  draft = {},
  mainNames = [],
  // 本轮正文。**给了就查"名字是不是正文里原样出现的"**（层 1，ADR 0067）；
  // 不给就不查（老调用方、单元测试都不受影响）。
  body = '',
  // 本轮是否**强制回头测试**（ADR 0062）：
  //   true  → 模型必须先给「回头测试」动作，建档的人必须在「通过」名单里
  //   false → 只认已有的动作（面板手动建档、老调用方）
  requireLook = false,
  // 本局写作人称（'first'|'second'|'third'）：第二人称下「你」、第一人称下「我」认成主角本人
  person = '',
} = {}) {
  const valid = []
  const rejected = []
  const list = Array.isArray(persons) ? persons : []
  const mains = new Set((Array.isArray(mainNames) ? mainNames : []).map((name) => String(name ?? '').trim()))
  const pendingDraft = new Set()
  const reject = (action, reason) => rejected.push({ action, reason })


  // ── 回头测试（ADR 0062）──
  // 模型必须先表态"哪些称呼喊得回"；建档的人得在「通过」名单里，
  // 而且名单里的称呼得是**正文里原样出现的**（防止它凭空造个能喊的名字）。
  const list0 = Array.isArray(actions) ? actions : []
  const lookAction = list0.find((item) => item?.动作 === '回头测试') ?? null
  const lookPassed = new Set(
    (Array.isArray(lookAction?.通过) ? lookAction.通过 : [])
      .map((item) => (typeof item === 'string' ? item : String(item?.称呼 ?? '')).trim())
      .filter(Boolean),
  )
  const lookFailed = new Set(
    (Array.isArray(lookAction?.不通过) ? lookAction.不通过 : [])
      .map((item) => (typeof item === 'string' ? item : String(item?.称呼 ?? '')).trim())
      .filter(Boolean),
  )
  // 「通过」里那些正文里根本没出现的称呼，不算通过（模型凭空造的）
  const bodyText = typeof body === 'string' ? body : ''
  for (const name of [...lookPassed]) {
    if (bodyText.trim() && !bodyText.includes(name)) lookPassed.delete(name)
  }

  for (const action of list0) {
    const type = action?.动作
    if (type === '回头测试') {
      valid.push({ type: 'look', passed: [...lookPassed], failed: [...lookFailed] })
      continue
    }
    if (!PERSON_ACTIONS.has(type)) {
      reject(action, `动作名不认识（人物级）：${type ?? '(空)'}`)
      continue
    }

    if (type === '建档') {
      const name = String(action?.姓名 ?? '').trim()
      const nameCheck = checkText(name, '姓名', { max: NAME_MAX, kind: 'name' })
      if (!nameCheck.ok) {
        reject(action, nameCheck.reason)
        continue
      }
      if (!name) {
        reject(action, '姓名不能为空')
        continue
      }
      // 代词不是名字：「你」「我」在第二人称正文里就是主角，建出来只会是个假人
      if (isPronounName(name)) {
        reject(action, `「${name}」是人称代词，不是名字，不建档`)
        continue
      }
      if (mains.has(name)) {
        reject(action, `与主角同名，拒绝建档：${name}`)
        continue
      }
      // 撞名一律拒绝：**同名不同人这一版不支持**（ROADMAP P9）
      if (findExisting(list, name)) {
        reject(action, `已经在档里了（同名暂不支持）：${name}`)
        continue
      }
      const status = STATUS_MAP[action?.状态] ?? STATUS.PRESENT
      const rawAliases = splitAliases(action?.别名)
      const checked = checkAliases({ name, rawAliases, list, mains })
      // 别名也要查符号（逗号是分隔符，拆分时已经去掉了）
      const badAlias = rawAliases.map((alias) => checkText(alias, '别名', { max: NAME_MAX, kind: 'name' })).find((item) => !item.ok) ?? null
      if (badAlias) {
        reject(action, badAlias.reason)
        continue
      }
      if (checked.reason) {
        reject(action, checked.reason)
        continue
      }
      // **名字必须来自正文**：模型常给通用称谓套外壳造名字（「老头」→「蓝布夹克老头」），
      // 拼出来的名字正文里根本没有。这样的人召不回来——档案成了死档（层 1，ADR 0067）。
      const origin = checkNamesInBody({ name, aliases: checked.aliases, body })
      if (origin.reason) {
        reject(action, origin.reason)
        continue
      }
      // 回头测试没过的，不许建档（ADR 0062）
      if (requireLook) {
        if (!lookAction) {
          reject(action, `没给「回头测试」结论，不许建档：${name}`)
          continue
        }
        if (lookFailed.has(name)) {
          reject(action, `回头测试没过，不许建档：${name}`)
          continue
        }
        // 姓名或**别名**命中「通过」名单都算（模型可能用别名建档）
        const names = [name, ...checked.aliases].map((item) => String(item ?? '').trim()).filter(Boolean)
        if (!names.some((item) => lookPassed.has(item))) {
          reject(action, `没通过回头测试（不在「通过」名单里），不许建档：${name}；通过名单＝${[...lookPassed].join('、') || '(空)'}`)
          continue
        }
      }
      valid.push({ type: 'create', name, aliases: checked.aliases, status })
      continue
    }

    if (type === '改状态') {
      const key = String(action?.人物 ?? '').trim()
      const id = resolvePersonRef(list, key, { person })
      if (!id) {
        const bare = key.replace(/[(（].*$/u, '').trim()
        reject(action, countByName(list, bare) > 1
          ? `重名，分不清是谁：${key}（请连素材里括号中的编号一起抄）`
          : `找不到这个人：${key || '(空)'}`)
        continue
      }
      const status = STATUS_MAP[action?.状态]
      if (status === undefined) {
        reject(action, `状态不认识：${action?.状态 ?? '(空)'}`)
        continue
      }
      valid.push({ type: 'status', id, status })
      continue
    }

    // 改名：正文里明确换了称呼才报。旧姓名自动进别名（复用 setPersonNames 的校验，
    // 别在这儿另写一套符号/撞名/代词判断）。
    if (type === '改名') {
      const key = String(action?.姓名 ?? '').trim()
      const id = resolvePersonRef(list, key, { person })
      if (!id) {
        reject(action, `找不到这个人：${key || '(空)'}`)
        continue
      }
      const newName = String(action?.新姓名 ?? '').trim()
      const renamed = setPersonNames(list, {
        id,
        name: newName,
        keepOldName: true,
        // 改的是主角本人时不能用「不许撞主角名」拦他
        mainNames: id === PLAYER_ID ? [] : [...mains],
      })
      if (!renamed.ok) {
        reject(action, renamed.reason)
        continue
      }
      // 新称呼必须是正文里原样出现过的，防模型凭空拼一个能喊的名字（ADR 0067）
      const origin = checkNamesInBody({ name: newName, aliases: [], body })
      if (origin.reason) {
        reject(action, origin.reason)
        continue
      }
      const row = renamed.persons.find((item) => item?.[0] === id)
      valid.push({ type: 'rename', id, name: newName, aliases: String(row?.[3] ?? '') })
      continue
    }

    // 模糊建档
    // ⚠️ 同一轮里「建档」+「模糊建档」同报同一个人是**安全**的：撞名检查用的是动作应用
    // **之前**的表，两条都会过；最后由 `pruneDraft` 把刚建档的人从表里摘掉。
    // 这不是 bug，别去加互斥——加了就得处理两条动作的先后依赖（DESIGN §模糊建档表）。
    const name = String(action?.姓名 ?? '').trim()
    const draftNameCheck = checkText(name, '姓名', { max: NAME_MAX, kind: 'name' })
    if (!draftNameCheck.ok) {
      reject(action, draftNameCheck.reason)
      continue
    }
    if (!name) {
      reject(action, '姓名不能为空')
      continue
    }
    // 代词不是名字：漏了这条，「你」会一直挂在候选表里（建档时被拒，但候选清不掉）
    if (isPronounName(name)) {
      reject(action, `「${name}」是人称代词，不是名字，不进候选`)
      continue
    }
    if (findExisting(list, name)) {
      reject(action, `已经在档里了（同名暂不支持）：${name}`)
      continue
    }
    if (Object.hasOwn(draft ?? {}, name) || pendingDraft.has(name)) {
      reject(action, `已经在模糊建档表里：${name}`)
      continue
    }
    pendingDraft.add(name)
    valid.push({ type: 'draft', name })
  }

  return { valid, rejected }
}

/**
 * 把校验过的人物级动作应用到人物数组与模糊建档表，返回**新对象**。
 * @param {any[][]} persons
 * @param {any[]} valid validatePersonActions 的产物
 * @param {{turn?:number, takeId?:()=>string}} options
 *   takeId：分配人物编号（不传就不建档，避免造出没有编号的人）
 * @returns {{persons:any[][], draft:object, created:string[]}}
 */
export function applyPersonActions(persons, valid, { turn = 0, takeId = undefined } = {}) {
  const next = Array.isArray(persons) ? persons.map((person) => [...person]) : []
  const draft = {}
  const created = []

  for (const action of Array.isArray(valid) ? valid : []) {
    if (!action) continue
    if (action.type === 'create') {
      if (typeof takeId !== 'function') continue
      const id = takeId()
      if (!id) continue
      next.push([id, action.status, action.name, action.aliases.join(',')])
      created.push(id)
    } else if (action.type === 'status') {
      const target = next.find((person) => person?.[0] === action.id)
      if (target) target[1] = action.status
    } else if (action.type === 'rename') {
      const target = next.find((person) => person?.[0] === action.id)
      if (target) {
        target[2] = action.name
        target[3] = action.aliases
      }
    } else if (action.type === 'draft') {
      draft[action.name] = turn
    }
  }

  return { persons: next, draft, created }
}

/**
 * 回头测试「通过」名单里、但没有任何「建档」动作覆盖的名字。
 *
 * 只用于调试日志：模型常把「通过」当成已建档（只写进通过名单、不写 `建档`），
 * 程序照实不建，结果写命题时才发现「人物不在档案里」。这条日志让它一眼可见。
 *
 * 「覆盖」按姓名或别名算——模型可能用别名建档（ADR 0084）。
 *
 * @param {any[]|null} actions 判定阶段解析出来的动作
 * @returns {string[]}
 */
export function passedWithoutBuild(actions) {
  const list = Array.isArray(actions) ? actions : []
  const look = list.find((item) => item?.动作 === '回头测试')
  const passed = (Array.isArray(look?.通过) ? look.通过 : [])
    .map((item) => (typeof item === 'string' ? item : String(item?.称呼 ?? '')).trim())
    .filter(Boolean)
  if (!passed.length) return []

  const built = new Set()
  for (const action of list) {
    if (action?.动作 !== '建档') continue
    const name = String(action?.姓名 ?? '').trim()
    if (name) built.add(name)
    for (const alias of splitAliases(action?.别名)) built.add(alias)
  }
  return passed.filter((name) => !built.has(name))
}
/**
 * 名字必须**在本轮正文里原样出现**（层 1，ADR 0067）。
 *
 * 为什么要有这条：模型判断"回头测试"时，容易给通用称谓套个外壳当名字——
 * 正文里写「老头」，它报「姓名=老头、别名=蓝布夹克老头」。那个别名是**拼出来的**，
 * 正文里从来没有。这样的人以后召不回来（正文里没人这么叫他），档案成了死档。
 *
 * 判定用**子串**判断：正文带 markdown 标记（`**老头**`）也不影响。
 * 多个别名里只要有一个不在正文里，**整条建档都拒**——宁可漏，不要错。
 *
 * @param {{name:string, aliases:string[], body?:string}} input
 * @returns {{reason:string|null}}
 */
export function checkNamesInBody({ name = '', aliases = [], body = '' } = {}) {
  const text = typeof body === 'string' ? body : ''
  if (!text.trim()) return { reason: null }        // 没给正文 → 不查

  const who = String(name ?? '').trim()
  if (who && !text.includes(who)) {
    return { reason: `姓名不在正文里出现过（可能是自己起的名）：${who}` }
  }
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const text2 = String(alias ?? '').trim()
    if (!text2) continue
    if (!text.includes(text2)) {
      return { reason: `别名不在正文里出现过（可能是自己起的名）：${text2}` }
    }
  }
  return { reason: null }
}
/**
 * 栏目名的"宽松形式"：去掉所有分隔符（斜杠、空格、顿号、连字符、括号等）。
 * 「身份/职业」和「身份职业」归一后都是「身份职业」。
 */
function looseKey(name) {
  return String(name ?? '')
    .replace(/[\s/\\、,，·\-—_()（）\[\]【】·・:：]/g, '')
    .trim()
}

// 名字的字符限制统一在 `lib/inputLimit.js` 的 `checkText(..., { kind: 'name' })`：
// 白名单更严（不含括号、逗号、顿号），避免"两套规则各说各话"。
// 名字（姓名／别名／栏目名）的输入限制见 ADR 0084。
