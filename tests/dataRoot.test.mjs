// 数据根目录定位：把自持数据放到酒馆的「插件数据区」，跟代码分开
//
// 为什么不放插件目录里：插件更新/重装时那个目录可能被清掉，数据跟着没。
// 放 `<tavern data>/plugin-data/<插件名>/` 就跟叙事锚定一致，也不受插件更新影响。
//
// 定位原则（学叙事锚定的三不）：**不写盘符、不写用户主目录、不猜无依据的层级**。
// 这里唯一允许的"推断"是：tavern 把我们装在 `<data>/plugins/<名字>/`，
// 所以往上两级就是数据根——这是有依据的推断，不是猜；推不出来就退回插件目录。
//
// ⚠️ 断言一律用 node:path 现拼，**不要把分隔符写死**（曾经写死过 `C:\\...`，
// 在 Windows 上全绿、到 CI 的 Linux 上 5 条全挂——路径行为本来就该跨平台）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'

import { pickDataRoot } from '../plugin/lib/dataRoot.js'

const NAME = 'character-archives'

// 用一个跨平台一致的基准目录：Windows 上是 C:\tavern-data，Linux 上是 /tavern-data
const TAVERN = resolve('/tavern-data')
const INSTALLED = join(TAVERN, 'plugins', NAME)

test('标准安装位置：<data>/plugins/<名字>/ → 推断到 <data>/plugin-data/<名字>/', () => {
  const root = pickDataRoot({ pluginDir: INSTALLED, name: NAME })
  assert.equal(root, join(TAVERN, 'plugin-data', NAME))
})

test('推断出来的数据目录不在 plugins/ 里面（这是这条推断的全部意义）', () => {
  const root = pickDataRoot({ pluginDir: INSTALLED, name: NAME })
  assert.ok(!root.startsWith(join(TAVERN, 'plugins')), '数据不能落回插件目录，否则更新会被清掉')
})

test('显式环境变量优先', () => {
  const myData = resolve('/mydata')
  const root = pickDataRoot({ pluginDir: INSTALLED, name: NAME, env: { DSH_TAVERN_DATA_DIR: myData } })
  assert.equal(root, join(myData, 'plugin-data', NAME))
})

test('插件专属环境变量优先级最高', () => {
  const mine = resolve('/mine')
  const root = pickDataRoot({
    pluginDir: INSTALLED,
    name: NAME,
    env: { DSH_TAVERN_ARCHIVES_DATA: mine, DSH_TAVERN_DATA_DIR: resolve('/mydata') },
  })
  assert.equal(root, mine)
})

test('不在 plugins 目录下（开发版）→ 退回插件自己的 data 目录', () => {
  const dev = join(TAVERN, 'work', 'project', 'plugin')
  const root = pickDataRoot({ pluginDir: dev, name: NAME })
  assert.equal(root, join(dev, 'data'))
})

test('目录名对不上（不是被 tavern 装的）也退回插件目录', () => {
  const other = join(TAVERN, 'plugins', 'some-other-plugin')
  const root = pickDataRoot({ pluginDir: other, name: NAME })
  assert.equal(root, join(other, 'data'))
})
