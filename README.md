# 人物档案馆 · character-archives

简体中文 | [English](README.en.md)

[![Package plugin](https://github.com/WhichWitchWin/character-archives/actions/workflows/package-plugin.yml/badge.svg)](https://github.com/WhichWitchWin/character-archives/actions/workflows/package-plugin.yml)
[![Release](https://img.shields.io/github/v/release/WhichWitchWin/character-archives?style=flat-square)](https://github.com/WhichWitchWin/character-archives/releases)

> 给 DSH Tavern 的第三方插件。让 NPC **记得住自己知道什么**，并在写正文时把这些记忆按需递给模型。

---

## 这是什么

玩长线角色扮演时，模型有个天然缺陷：**它只看得到最近一段对话**。

于是会出现这些情况——

- 三章前那个掌柜明明亲眼见过你杀人，这章却像不认识你
- 你在另一个城市跟人说起某位旧识，模型完全接不上
- 同一个角色，昨天还是"冷面杀手"，今天就变得和蔼可亲，因为它忘了自己是谁

把所有档案全塞进上下文是另一个极端：**撑爆字数，而且分不清"谁真的知道"和"谁只是听说"**。

这个插件做的是中间那条路：**给每个人物记一本小册子，只在需要时抽出相关的那几页。**

而且它承认一件现实——**同一件事，A 信、B 不信、C 只是听说，这不是矛盾，是常态。** 所以档案能同时保存"同一件事的多个版本"，各人的认知互不干扰。

---

## 它做什么

| 能力 | 说明 |
|---|---|
| **自动建档** | 值得记住的角色自动入册，不用你手动添加 |
| **每轮自动整理** | 正文写完后，后台读一遍正文，判断谁出场了、谁知道了什么 |
| **写前提醒** | 下次生成正文前，把相关人物的记忆按字数预算递过去 |
| **可查可改** | 侧栏面板里能翻每个人的档案，改名字、改内容、改关系 |
| **换一套栏目** | 默认 8 个栏目，可以改名、改提示词，也可以整套换掉 |
| **改提示词** | 三段跟模型说话的模板都能自己改，也能一键恢复默认 |
| **导出备份** | 整本人物册能导出成文件，也能导回来 |

---

## 怎么装

### 你需要先有

- 已装好 **DSH Tavern**
- 会压缩 / 解压 zip

### 方式一：上传 ZIP（推荐）

**第 1 步：拿到插件包**（二选一）

- **最省事**：从 [Releases](https://github.com/WhichWitchWin/character-archives/releases) 下载现成的 `character-archives.zip`（由 CI 自动打好，直接可用）
- **自己打**：下载本仓库 → 解压 → **只把 `plugin/` 这一个文件夹压缩成 zip**

**第 2 步**：酒馆里打开 **设置 → 酒馆插件 → 上传 ZIP**，选中那个 zip。

**第 3 步**：宿主侧几秒内加载，**刷新浏览器**就能在侧栏看到。

> ⚠️ **别把整个仓库打包**
> 安装器按「最浅的那个 `package.json`」认定插件根。仓库根有一份开发用的 `package.json`（跑测试、装插件用的脚本），如果整包上传，它会抢在 `plugin/package.json` 前面被选中，然后报错：
> `package.json 没有写宿主入口（exports "." 或 main），不是 Tavern 插件`
>
> 所以只压 `plugin/` 这一层——压出来的 zip 里应该是 `plugin/package.json`（或直接就是 `package.json`），而不是仓库根的 `package.json`。

### 方式二：手动复制文件夹

DSH Tavern 的插件**就是一个文件夹**——不需要编译、不需要装依赖、不用改酒馆源码。

把 `plugin/` 整个复制到酒馆数据目录下的 `plugins/` 里，并改名成 `character-archives`：

```text
<酒馆数据目录>/plugins/
└─ character-archives/
   ├─ package.json
   ├─ index.mjs      宿主侧（改它要重启）
   ├─ client.js      浏览器侧（自动热更）
   ├─ assets/        提示词默认版 + 分词词表
   └─ lib/           纯逻辑模块
```

Windows 上酒馆数据目录一般在：

```text
C:\Users\<你的用户名>\.dsh\profile-data\tavern\data\plugins\
```

> 文件夹名必须是 `character-archives`——插件靠这个名字认出自己是被酒馆装的，进而把数据存到 `<酒馆数据目录>/plugin-data/character-archives/`。名字不对会退化成"数据存在插件目录里"，更新时容易丢。

### 如果你在本仓库里开发

```bash
npm run install:dev
```

这条命令把 `plugin/` 复制到上面那个目录。

> ⚠️ **两个必须知道的点**
> 1. **改 `index.mjs`（宿主侧）之后要重启 DSH**，否则不生效；改 `client.js` 会自动热更。
> 2. `install:dev` **只复制、不删除**——`plugin/` 里删掉的文件不会从安装目录消失，需要自己清理。

### 装完检查

打开任意一局游戏 → 侧栏「＋」→ 插件 → **人物档案馆**。能看到面板就是装好了。

> 💡 **更新已有插件要重启**：全新安装宿主会自己加载，但**覆盖升级**后旧模块还在内存里，必须重启 DSH 才会换成新代码。

---

## 怎么用

### 面板有四个标签页

| 标签页 | 干什么 |
|---|---|
| **档案** | 看在场／离场／冷档的人物，搜索，查某人"知道什么" |
| **设置** | 召回预算、认知口径、存储保留等 |
| **提示词** | 改三段跟模型说话的模板，或恢复默认 |
| **预设** | 改栏目名字与抓取提示词，另存为全局默认或按卡覆盖 |

### 档案页能做什么

- 点人物名展开，看他的**栏目内容**（他是什么样）和**认知**（他知道什么、信不信、听谁说的）
- 改名字（旧名自动进别名）、改状态（在场／离场）、打 ★ 标记
- 锁住某人（模型不能改）、对模型隐藏（不递给他）
- **拖动标题行**换分组（在场／离场／冷档）
- 每条命题后面能看到程序自动分出来的词，帮你理解"为什么这次召回了这个人"

### 不用管的事

- 谁该建档、谁该离场、谁知道了什么——**插件自己判**，你只在觉得不对时手动改
- 人物册跟着这一局走，剧情回退它会跟着回退

---

## 它怎么工作

三段话讲完，细节在 [设计文档](docs/DESIGN.md)。

**一、记忆分两层。** 一层是「命题」——有人提过、有人信过的一句话，不保证为真；另一层是「指针」——每个人各持一份，记录"他信不信、从谁那儿听来的"。同一件事可以有多个版本，因为认知本来就分人。

**二、只在需要时递过去。** 每轮生成正文前，插件挑出**在场**人物的相关记忆，按 3000 字预算塞进提示词。挑谁、挑哪几条，靠固定规则打分：关于在场他人、关于当前地点、词语在正文里命中。**离场的人不递**——正文刚写过他，用不着再念一遍。

**三、每轮写完后整理。** 正文写完，后台把正文读一遍，判断谁出场了、谁知道了什么，更新到人物册。这一步用独立模型调用，不占你正文的上下文。

---

## 目录结构

```text
plugin/            插件本体（复制进 plugins/ 即可运行）
├─ index.mjs       宿主侧入口：apply(ctx)，注册所有 handle
├─ client.js       浏览器侧：侧栏面板
├─ prompt.js       三段提示词的兜底副本（由 assets/*.txt 生成，别手改）
├─ assets/         三段提示词的默认版 + jieba 分词词表
└─ lib/            纯逻辑模块（不碰酒馆接口，可本地单测）
docs/              设计文档、ADR（决策记录）、ROADMAP（路线）
tests/             单元测试
scripts/           开发脚本（装到酒馆、同步提示词副本）
```

---

## 数据存在哪

人物册**不放在酒馆的对话数据里**，而是放在插件自己的目录：

```text
<酒馆数据目录>/plugin-data/character-archives/
```

这样做的好处是不受插件更新影响；代价是**重装插件（清目录）会丢数据**。

> 💡 **建议**：玩到一半想换机器或重装前，先在面板里**导出**一份。

---

## 常见问题

**Q：改了代码没生效？**
改 `index.mjs` 要重启 DSH；改 `client.js` 会自动热更。改了提示词则要检查是不是只改了一处——提示词在四个地方各存一份（详见[设计文档](docs/DESIGN.md)）。

**Q：某人被记了不该记的东西？**
面板里直接删掉那条命题。也可以在「提示词」页调「记录门槛」相关段落，让模型少记。

**Q：模型把鸡毛蒜皮都记下来了？**
这是设计上花了很多力气的地方。系统提示词里有「四条硬规矩」，其中两条专门管这个：他做的事本身不记、这个身份本来就会的不记。如果还是太啰嗦，可以在「提示词」页把这两条写得更严格。

**Q：在酒馆里粘 GitHub 地址装不上，报「没有写宿主入口」？**
这是本仓库的结构决定的，不是你的操作问题。安装器按「最浅的 `package.json`」认插件根，而本仓库根目录有一份开发用的 `package.json`，会抢在 `plugin/package.json` 前面被选中。**请改用「上传 ZIP」**，并且只压 `plugin/` 那一层（详见[怎么装](#怎么装)）。

**Q：能同时装两个不同的人物档案馆吗？**
不能。插件按名字识别，同名只能有一个。

**Q：跨插件调用（别的插件读这里的档案）？**
还没做。

---

## 相关文档

| 想知道什么 | 看哪 |
|---|---|
| 当前设计是什么样的 | [docs/DESIGN.md](docs/DESIGN.md)（**唯一规格真源**，由 AI 维护） |
| 为什么这么定 | [docs/adr/](docs/adr/)（104 条决策记录，[索引](docs/adr/README.md)） |
| 以后要做什么 | [docs/ROADMAP.md](docs/ROADMAP.md) |
| 这一版改了什么 | [CHANGELOG.md](CHANGELOG.md)（对外）／[docs/CHANGELOG.md](docs/CHANGELOG.md)（内部时间线） |
| 怎么参与开发 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 项目约定与 AI 硬性要求 | [AGENTS.md](AGENTS.md) |

---

## 状态

**版本 `0.1.0`**，已发布，安装包见 [Releases](https://github.com/WhichWitchWin/character-archives/releases)。

- **能跑**：建档、自动结算、召回注入、面板增删改查、栏目预设、三段提示词编辑、导出导入、设置页
- **测试**：804 个用例全过（`npm test`），CI 在 Linux 上同样跑一遍
- **零运行时依赖**：`plugin/` 里没有 `dependencies`
- **还没做**：跨插件接口、同名不同人、栏目预设单独导入导出、非 MVU 卡的游戏内时间

各版本的验收标准与待办见 [docs/ROADMAP.md](docs/ROADMAP.md)。

---

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

---

## 许可证

**代码与文档分别授权**：

| 范围 | 许可证 | 你要做的事 |
|---|---|---|
| **代码**（`plugin/`、`scripts/`、`tests/`） | [GPL-3.0-or-later](LICENSE) | 保留版权声明；**修改后分发必须以 GPL 开源你的修改**；标注你改了什么 |
| **文档**（`docs/`、README、CONTRIBUTING、AGENTS） | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.zh-hans) | **署名** WhichWitchWin、附许可证链接、注明有没有改动 |

完整说明与**具体署名写法**见 [NOTICE](NOTICE)。

> ⚠️ **一句话提醒**：版权保护的是「文字怎么写」，不保护「想法」。
> 别人读你的设计、理解思路后自己重写一份实现，法律上不构成侵权——任何许可证都管不到。
> CC BY 4.0 能强制的是：**抄写或改编这些文字**时必须署名。

第三方资源：`plugin/assets/dict/` 下的分词词典来自 jieba（MIT），不适用上述双许可，见同目录 `LICENSE-jieba.txt`。
