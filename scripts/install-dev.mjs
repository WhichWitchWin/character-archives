// 把 plugin/ 复制到酒馆的 plugins/ 目录，供本地调试。
//
//   npm run install:dev
//
// 默认目标：~/.dsh/profile-data/tavern/data/plugins/dsh-tavern-npc-archives
// 可用环境变量 TAVERN_PLUGINS_DIR 指到别处（手机、另一个 DSH_HOME 等）。
//
// 注意：
//   - 只复制、不删除。plugin/ 里删掉的文件不会从目标目录消失，需要自己清理。
//   - 改 index.mjs（宿主侧）要重启 DSH 才生效；改 client.js 几秒内自动换。
//   - .tavern-entry.mjs 由酒馆自己生成，不复制。

import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const PLUGIN_NAME = 'dsh-tavern-npc-archives'

const source = resolve(import.meta.dirname, '..', 'plugin')
const target =
  process.env.TAVERN_PLUGINS_DIR ||
  join(homedir(), '.dsh', 'profile-data', 'tavern', 'data', 'plugins', PLUGIN_NAME)

if (!existsSync(join(source, 'package.json'))) {
  console.error(`找不到插件本体：${source}`)
  process.exit(1)
}

mkdirSync(target, { recursive: true })
cpSync(source, target, {
  recursive: true,
  filter: (src) => !src.endsWith('.tavern-entry.mjs'),
})

console.log(`已复制插件到：${target}`)
console.log('宿主侧（index.mjs）改完要重启 DSH；浏览器侧（client.js）几秒内自动生效。')
