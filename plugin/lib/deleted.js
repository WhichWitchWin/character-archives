// 已删除名单（ADR 0066）
//
// 玩家**手动**删掉的人记在这里，派两个用场：
//   ① 程序据此**拒绝模型重建**——只从快照拿掉的话，下一轮正文里他还在，判定又会报建档；
//   ② 面板据此列出「已删除」，可以恢复、单独永久删除、批量勾选删除。
//
// 存哪：`<插件数据>/deleted/<会话>.json`，**按会话绑定**，删局时随会话一起挪进 trash。
// 为什么不用整局数据（`state`）：`state` 是"活着的人物册"的一部分，回退会动它；
// 而"我删过谁"是玩家意图，不该被剧情回退改掉。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/**
 * 名单里所有"能认出是同一个人"的名字（姓名 + 别名 + 称呼）。
 * @param {Array<object>} list
 * @returns {Set<string>}
 */
export function deletedNamesOf(list) {
  const names = new Set()
  const add = (value) => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) names.add(text)
  }
  for (const record of Array.isArray(list) ? list : []) {
    if (!record || typeof record !== 'object') continue
    add(record.name)
    add(record.call)
    for (const alias of Array.isArray(record.aliases) ? record.aliases : []) add(alias)
  }
  return names
}

/**
 * 挡掉"给已删除的人重新建档"的动作。
 *
 * **只管建档与模糊建档**：改状态无意义但也不该误伤（那条动作可能指向别人，
 * 而且真正的把关在建档这一步）。
 *
 * @param {Array<object>|null} actions 判定阶段解析出来的动作
 * @param {Array<object>|null} deleted 已删除名单
 * @returns {{kept: Array<object>, blocked: Array<object>}}
 */
export function filterDeletedPersonActions(actions, deleted) {
  const list = Array.isArray(actions) ? actions : []
  const names = deletedNamesOf(deleted)
  if (!names.size) return { kept: list, blocked: [] }

  const kept = []
  const blocked = []
  for (const action of list) {
    const type = action?.动作
    const isBuild = type === '建档' || type === '模糊建档'
    const name = typeof action?.姓名 === 'string' ? action.姓名.trim() : ''
    if (isBuild && name && names.has(name)) {
      blocked.push(action)
      continue
    }
    kept.push(action)
  }
  return { kept, blocked }
}
/**
 * 把人物按编号分成「要移除的」和「留下的」。
 *
 * 抽成纯函数有两个理由：
 *   ① 好测——"编号对不上时一个人都不能少"这种底线要有测试守着；
 *   ② 调用处只解构一次 `{ snapshot }`，不会再把 readSnapshotAt 的**包装对象**
 *      当成快照本身（B2 的根因：那样 `snapshot.p` 是 undefined，
 *      删人就变成"匹配不到任何人"→ 静默无事发生）。
 *
 * @param {{p?:Array<any>}|null} snapshot 快照本体（不是包装对象）
 * @param {string|string[]|null} ids 要移除的人物编号
 * @returns {{removed: Array<any>, kept: Array<any>}}
 */
export function splitPersons(snapshot, ids) {
  const people = Array.isArray(snapshot?.p) ? snapshot.p : []
  // **要认 Set**：调用处传的就是 `new Set(...)`。
  // `Array.isArray(Set)` 是 false，直接 `[ids]` 会把整个 Set 当成一个元素 → 谁都匹配不上（B2）。
  const list = ids instanceof Set ? [...ids] : Array.isArray(ids) ? ids : [ids]
  const wanted = new Set(list.filter(Boolean).map(String))
  const removed = []
  const kept = []
  for (const person of people) {
    if (wanted.has(String(person?.[0]))) removed.push(person)
    else kept.push(person)
  }
  return { removed, kept }
}
/**
 * 把"要处理哪些编号"统一变成 Set。
 *
 * **数组和 Set 都要认**：调用处可能传数组（面板），也可能传 Set（内部）。
 * 之前 `Array.isArray(ids) ? ids : [ids]` 会把整个 Set 变成一个字符串元素，
 * 于是"谁都没匹配上"，删人静默无效（B2）。
 *
 * @param {string|string[]|Set<string>|null} ids
 * @returns {Set<string>}
 */
export function idSet(ids) {
  const list = ids instanceof Set ? [...ids] : Array.isArray(ids) ? ids : [ids]
  return new Set(list.filter(Boolean).map(String))
}

/**
 * 这个人名下的命题（命题第 2 格「所属人物」是他）。
 * @param {Array<any[]>|null} claims
 * @param {string} personId
 * @returns {Array<any[]>}
 */
export function claimsOfPerson(claims, personId) {
  const id = String(personId ?? '')
  if (!id) return []
  return (Array.isArray(claims) ? claims : []).filter(
    (claim) => Array.isArray(claim) && String(claim?.[1]) === id,
  )
}

/**
 * 删人时要一起摘下来的指针（ADR 0088）：
 *   ① 他作为**认知主体**的（第 1 格是他）
 *   ② 指向**他名下命题**的（命题没了，谁的指针都得跟着走，否则就是悬空的）
 * @param {Array<any[]>|null} pointers
 * @param {string} personId
 * @param {number[]|Set<number>} [claimIds] 他名下命题的编号
 * @returns {Array<any[]>}
 */
export function pointersOfPerson(pointers, personId, claimIds = []) {
  const id = String(personId ?? '')
  if (!id) return []
  const owned = claimIds instanceof Set ? claimIds : new Set(Array.isArray(claimIds) ? claimIds : [])
  return (Array.isArray(pointers) ? pointers : []).filter(
    (pointer) => Array.isArray(pointer) && (String(pointer?.[0]) === id || owned.has(pointer?.[1])),
  )
}