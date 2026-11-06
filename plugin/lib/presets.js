// 栏目预设库（设计稿 §8.8）
//
// 「通用预设」是**数据**，不是散落在各处的硬编码：名字与抓取提示词。
//
// 两条边界要记住：
//   · **姓名与别名不进预设**——它们已经升到人物级别（姓名见 ADR 0044；别名见 §2 与 Q17）；
//   · 预设只管「抓什么」，不管「存成什么」——命题＋指针是唯一的存法。
//
// 形象包（14 条）默认关闭，受设置项「启用人物外貌条目」控制。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

import { SINGLE_CODES } from './entries.js'

/** 14 条形象栏目（默认关闭）。名字与设计稿 §8.8 一致。 */
export const APPEARANCE_NAMES = Object.freeze([
  '五官外貌【正面】',
  '五官外貌背面',
  '上半身 SFW',
  '上半身 SFW 背面',
  '下半身 SFW',
  '下半身 SFW 背面',
  '上半身 NSFW',
  '上半身 NSFW 背面',
  '下半身 NSFW',
  '下半身 NSFW 背面',
  '负面',
  '形态线索',
  '整体·常服',
  '整体·私密',
])

const APPEARANCE = APPEARANCE_NAMES.map((name) => ({
  name,
  // 形象栏目统一「按 danbooru 标签化」书写
  prompt: `${name.replace(/^(五官外貌|上半身|下半身)/, '')}按 danbooru 标签化书写；不写别的部位`,
}))

/** 8 条通用栏目（默认开启）。 */
export const PRESET_ENTRIES = Object.freeze([
  {
    name: '职业',
    prompt: '社会定位、职务、所属组织；不写具体能力与持有物',
  },
  {
    name: '性格',
    prompt: '稳定的性情与行事风格；按 danbooru 标签化书写；不写能力，不写当前处境',
  },
  {
    name: '能力资源',
    prompt: '可动用的本领、权力、财物、人脉；不写性格与身份头衔',
  },
  {
    name: '当前处境',
    prompt: '临时的身体或社会处境，如重伤、中毒、被通缉；不写在场／离场',
  },
  {
    name: '最后已知去向',
    prompt: '最后被确认或他自称所在的地点及依据；不写将来的打算',
  },
  {
    name: '后续计划',
    prompt: '明确说出的、带时间或条件的将来行动；不写答应别人的承诺',
  },
  {
    name: '未了事项',
    prompt: '尚未兑现的承诺、约定、债务、秘密与冲突；不写泛泛计划',
  },
  {
    name: '关系',
    prompt: '与主角或他人的关系性质及变化，如旧友、宿敌；不写具体未了之事',
  },
])

/**
 * 生成一份栏目定义表（`{ 栏目码: { name, prompt, mustRecall, convention } }`）。
 * 栏目码按预设顺序从单字母码里取。
 * @param {{includeAppearance?:boolean}} options
 * @returns {{definitions: object, order: string[]}}
 */
export function buildPresetDefinitions({ includeAppearance = false } = {}) {
  const list = includeAppearance ? [...PRESET_ENTRIES, ...APPEARANCE] : [...PRESET_ENTRIES]
  const definitions = {}
  const order = []
  list.forEach((item, index) => {
    const code = SINGLE_CODES[index]
    if (!code) return
    definitions[code] = {
      name: item.name,
      prompt: item.prompt,
      // 两个召回标记（ADR 0089 / 0087）：默认都不开，玩家在预设面板勾
      mustRecall: false,
      convention: false,
    }
    order.push(code)
  })
  return { definitions, order }
}
