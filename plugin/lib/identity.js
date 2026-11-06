// 身份设置：玩家默认称呼 + 正文写作人称
//
// 这两样是**这张卡怎么讲故事**的设定，和存档无关，所以按卡存进插件数据（ADR 0054 的模式）。
//
// 为什么默认抓不到：平台的「玩家默认称呼」存在 `chat.macroState.userName`，
// 插件 API 没有暴露（getTurnState / getRequestContext / getCardContext / getCard 都查过）。
// 所以留空、界面给提示，玩家填一次就按卡记住。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { checkText } from './inputLimit.js'
import { isPronounName } from './player.js'

/** 玩家默认称呼最长多少个字（够用就行，别让面板被撑爆）。 */
export const MAX_PLAYER_NAME = 24

/** 三种写作人称。第二人称是这类卡的常态（"你推门进去"），所以默认它。 */
export const PERSON_OPTIONS = Object.freeze([
  { value: 'first', label: '第一人称', pronoun: '我' },
  { value: 'second', label: '第二人称', pronoun: '你' },
  { value: 'third', label: '第三人称', pronoun: '他' },
])

export const DEFAULT_IDENTITY = Object.freeze({
  playerName: '',      // 空 = 还没填（界面上提示从酒馆「开局默认」里抄）
  person: 'second',    // 'first' | 'second' | 'third'
})

const VALID_PERSONS = new Set(PERSON_OPTIONS.map((item) => item.value))

/**
 * 读设置：存过的叠到默认值上，脏数据一律回落。
 * @param {any} saved
 * @returns {{playerName: string, person: string}}
 */
export function resolveIdentity(saved) {
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}
  const raw = typeof source.playerName === 'string' ? source.playerName.trim().slice(0, MAX_PLAYER_NAME) : ''
  // 称呼也是**名字**：括号会跟「名字(p7)」的编号尾巴打架、逗号是别名分隔符（ADR 0084）。
  // **代词更不行**（中英文都不行）：「你」在档案里只会是"叫『你』的那个人"，分不清是谁。
  // 存量数据里已经有脏字符／代词就当作没填——让玩家重写一次，别把脏值带进提示词。
  const nameOk = raw && !isPronounName(raw) && checkText(raw, '玩家称呼', { max: MAX_PLAYER_NAME, kind: 'name' }).ok
  const playerName = nameOk ? raw : ''
  const person = VALID_PERSONS.has(source.person) ? source.person : DEFAULT_IDENTITY.person
  return { playerName, person }
}

/**
 * 身份体检：现在这份设置能不能用。
 *
 * 第三人称是硬要求——正文里靠**名字**指代主角，没名字就谁都不是；
 * 一/二人称不用（「我」「你」天然把人指出来了）。
 *
 * @returns {string|null} 不行就返回原因，能用返回 null
 */
export function identityProblem(saved) {
  const { playerName, person } = resolveIdentity(saved)
  if (person === 'third' && !playerName) {
    return '第三人称必须填玩家称呼——正文里靠名字指代主角，没名字就认不出他'
  }
  return null
}

/** 人称对应的代词：第一人称「我」、第二人称「你」、第三人称「他」。 */
export function pronounOf(person) {
  const found = PERSON_OPTIONS.find((item) => item.value === person)
  return found ? found.pronoun : '你'
}

/** 人称的中文名，界面上用；召回抬头也用它（「本局写作人称：第二人称」）。 */
export function personLabel(person) {
  const found = PERSON_OPTIONS.find((item) => item.value === person)
  return found ? found.label : '第二人称'
}

/**
 * 改值。**纯函数**：返回新对象，不动入参。
 * 不认识的键、非法值一律忽略——这次没生效，比塞进脏数据强。
 */
export function applyIdentityPatch(identity, patch = {}) {
  const base = resolveIdentity(identity)
  const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const next = { ...base }

  if (Object.hasOwn(source, 'playerName')) {
    const raw = source.playerName
    if (typeof raw === 'string') {
      const text = raw.trim().slice(0, MAX_PLAYER_NAME)
      if (!text) next.playerName = ''   // 空串＝清空，允许
      else if (isPronounName(text)) {
        // 代词不当名字（中英文都不行）：这次改动不生效，接线处会把原因返回给玩家
      } else if (checkText(text, '玩家称呼', { max: MAX_PLAYER_NAME, kind: 'name' }).ok) next.playerName = text
      // 非法字符：这次改动不生效（接线处会先返回原因给玩家看）
    }
  }
  if (Object.hasOwn(source, 'person')) {
    if (VALID_PERSONS.has(source.person)) next.person = source.person
  }
  return next
}
