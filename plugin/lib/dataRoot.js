// 数据根目录定位：把自持数据放到酒馆的「插件数据区」，跟代码分开
//
// 为什么不放插件目录：插件更新/重装时那个目录可能被清掉，数据跟着没。
// 放 `<tavern data>/plugin-data/<插件名>/` 跟叙事锚定一致，也不受插件更新影响。
//
// 定位原则（学叙事锚定的三不）：**不写盘符、不写用户主目录、不猜无依据的层级**。
// 唯一允许的推断是：tavern 把我们装在 `<data>/plugins/<名字>/`，往上两级就是数据根。
// 这是有依据的推断（位置是 tavern 给的），推不出来就退回插件目录。
//
// 纯逻辑模块：只有 node:path，不 import 酒馆接口、不接触 ctx。

import { basename, dirname, join, normalize } from 'node:path'

/** 本插件名（目录名要跟它一致才认得出"我是被 tavern 装的"）。 */
export const PLUGIN_NAME = 'character-archives'

/** 显式覆盖用的环境变量（排错、搬家时用）。 */
const ENV_OVERRIDE = 'DSH_TAVERN_ARCHIVES_DATA'
/** 酒馆数据根的环境变量（叙事锚定也用它当兜底之一）。 */
const ENV_DATA_ROOT = 'DSH_TAVERN_DATA_DIR'


/**
 * 决定数据根目录。
 * @param {{pluginDir:string, name?:string, env?:Record<string,string>}} input
 *   pluginDir：本插件自己的目录（接线处从 import.meta.url 推出来）
 * @returns {string} 绝对路径
 */
export function pickDataRoot({ pluginDir, name = PLUGIN_NAME, env = {} } = {}) {
  const dir = String(pluginDir ?? '')
  if (!dir) throw new Error('pickDataRoot 需要 pluginDir')

  // ① 显式覆盖
  const override = env[ENV_OVERRIDE]
  if (typeof override === 'string' && override.trim()) return normalize(override.trim())

  // ② 酒馆数据根 + plugin-data/<名字>
  const dataRoot = env[ENV_DATA_ROOT]
  if (typeof dataRoot === 'string' && dataRoot.trim()) {
    return normalize(join(dataRoot.trim(), 'plugin-data', name))
  }

  // ③ 从自身安装位置推断：<data>/plugins/<名字>/ → <data>/plugin-data/<名字>/
  const self = normalize(dir)
  if (basename(self) === name && basename(dirname(self)) === 'plugins') {
    return normalize(join(dirname(dirname(self)), 'plugin-data', name))
  }

  // ④ 兜底：插件自己的 data 目录（开发版、目录被改名的情形）
  return normalize(join(self, 'data'))
}
