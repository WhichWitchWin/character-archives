// 数据根目录定位：把自持数据放到酒馆的「插件数据区」，跟代码分开
//
// 为什么不放插件目录里：插件更新/重装时那个目录可能被清掉，数据跟着没。
// 放 `<tavern data>/plugin-data/<插件名>/` 就跟叙事锚定一致，也不受插件更新影响。
//
// 定位原则（学叙事锚定的三不）：**不写盘符、不写用户主目录、不猜无依据的层级**。
// 这里唯一允许的"推断"是：tavern 把我们装在 `<data>/plugins/<名字>/`，
// 所以往上两级就是数据根——这是有依据的推断，不是猜；推不出来就退回插件目录。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pickDataRoot } from '../plugin/lib/dataRoot.js'

const NAME = 'character-archives'
const no = () => false
const yes = () => true

test('标准安装位置：<data>/plugins/<名字>/ → 推断到 <data>/plugin-data/<名字>/', () => {
  const pluginDir = 'C:/tavern/data/plugins/character-archives'
  const root = pickDataRoot({ pluginDir, name: NAME, exists: no })
  assert.equal(root, 'C:\\tavern\\data\\plugin-data\\character-archives')
})

test('显式环境变量优先', () => {
  const pluginDir = 'C:/tavern/data/plugins/character-archives'
  const root = pickDataRoot({ pluginDir, name: NAME, env: { DSH_TAVERN_DATA_DIR: 'D:/mydata' }, exists: no })
  assert.equal(root, 'D:\\mydata\\plugin-data\\character-archives')
})

test('插件专属环境变量优先级最高', () => {
  const root = pickDataRoot({
    pluginDir: 'C:/tavern/data/plugins/character-archives',
    name: NAME,
    env: { DSH_TAVERN_ARCHIVES_DATA: 'E:/mine', DSH_TAVERN_DATA_DIR: 'D:/mydata' },
    exists: no,
  })
  assert.equal(root, 'E:\\mine')
})

test('不在 plugins 目录下（开发版）→ 退回插件自己的 data 目录', () => {
  const pluginDir = 'C:/work/project/plugin'
  const root = pickDataRoot({ pluginDir, name: NAME, exists: no })
  assert.equal(root, 'C:\\work\\project\\plugin\\data')
})

test('目录名对不上（不是被 tavern 装的）也退回插件目录', () => {
  const pluginDir = 'C:/tavern/data/plugins/some-other-plugin'
  const root = pickDataRoot({ pluginDir, name: NAME, exists: no })
  assert.equal(root, 'C:\\tavern\\data\\plugins\\some-other-plugin\\data')
})


