# 开发手册

面向接手开发的人（包括未来的自己）。项目是什么、怎么装、怎么用，看 [README](README.md)。

## 环境

| 项 | 值 |
|---|---|
| 酒馆本体 | `C:\Users\121\.dsh\apps\dsh-tavern\`（v3.1.0，本地安装） |
| 酒馆数据目录 | `C:\Users\121\.dsh\profile-data\tavern\data\` |
| 插件目录 | `<数据目录>\plugins\` |
| 酒馆日志 | `C:\Users\121\.dsh\logs\tavern.log`（UTF-8，PowerShell 读要加 `-Encoding utf8`） |
| 启动日志 | `C:\Users\121\.dsh\logs\tavern-window.log`（**含访问令牌，不要外传、不要贴给别人**） |
| Node | v24，`node --test` 可直接用 |

## 调试循环

```bash
npm run install:dev     # 把 plugin/ 复制到 <数据目录>\plugins\dsh-tavern-npc-archives
```

| 改了什么 | 怎么生效 |
|---|---|
| `plugin/client.js` | 复制后**刷新酒馆页面**，几秒内换成新代码 |
| `plugin/index.mjs` | 复制后**必须重启 DSH**（平台限制，绕不过） |
| 新增 / 删除插件文件夹 | 酒馆的 `fs.watch` 会自己发现，几秒内重新登记 |

加载成功与否看这两个文件（酒馆自动生成，不要手改、不要提交）：

- `.tavern-status.json` → `{"ok":true,"at":…}` 表示加载并 `apply` 成功；`{"ok":false,…}` 会带上失败阶段与原因
- `.tavern-entry.mjs` → 酒馆生成的入口包装，负责 import 你的 `index.mjs` 并调 `apply`

失败时提示词是 `[Tavern 插件] plugins/<文件夹名> 加载失败：…`，会写进酒馆日志。

### 为什么不能用 junction / 符号链接

试过了，不行。酒馆的插件扫描逻辑是：

```js
// tavern-plugin/lib/domain/user-plugins.js:89
readdir(pluginsDir, { withFileTypes: true })
  .filter(item => item.isDirectory() && !item.name.startsWith('.'))
```

而 Node 对 Windows junction 的判定是 `isDirectory() === false`、`isSymbolicLink() === true`，于是被直接过滤 —— 插件永远不加载。现象是：只挂链接时 `.tavern-entry.mjs` 不生成、`cordis.patch.yml` 不登记、日志里一句提示都没有（因为它压根没被看见）。

**结论：`plugins/` 下必须是真文件夹。** 开发时用 `npm run install:dev` 复制。

注意 `install-dev.mjs` **只复制、不删除**：`plugin/` 里删掉的文件不会从目标目录消失，需要自己清理。

## 测试

```bash
npm test                              # 全部单测，几秒内跑完
node --test tests/settings.test.mjs   # 只跑一个文件
```

- 纯逻辑（快照编解码、字典、信度排序、召回打分、容量水位）**必须有单测，且不需要开酒馆**。
- 涉及插件接口的部分只能装进酒馆手测。
- **不要**为了「顺手看一眼」去装依赖或跑酒馆全量测试（上游全量一次约 3 分钟）。

## 代码结构约定

- `plugin/lib/` 是纯逻辑：不 import 酒馆接口、不接触 `ctx`、只做数据进数据出。
- 只有 `plugin/index.mjs` 与 `plugin/client.js` 碰 `ctx`。
- 宿主接口必须写成 `ctx.tavern.方法名()`；解构会报错（酒馆靠调用方式认插件）。
- ESM、无构建、零运行时依赖。

## 路线

| 段 | 交付 | 状态 |
|---|---|---|
| M1 骨架 | 插件能加载、面板能显示、整局数据能读写 | ✅ 已完成（2026-10-31 实测） |
| M2 能存 | 快照 `v/t/p`、字典 `d/t`、信度位、容量水位 | ✅ 已完成（61 条测试；容量按 2026-10-31 新版重写） |
| M3 能召回 | 匹配 + 打分 + 字数预算 + 冷却，正文前注入 | 待做 |
| M4 能改 | 结算派活给常驻成员 → 校验 → 落盘；面板编辑 | 待做 |

M2 起 `plugin/lib/` 按需增加：`snapshot.js`、`dictionary.js`、`confidence.js`、`recall.js`、`capacity.js`、`prompts.js`。**不提前建空文件。**

### 已验证的平台事实（实测，不是推测）

| 事实 | 证据 |
|---|---|
| 插件文件夹放进 `plugins/` 后，酒馆几秒内自动登记并加载，不用重启 | `.tavern-status.json` = `{"ok":true}`；`cordis.patch.yml` 出现 `tavern-user-plugin-dsh-tavern-npc-archives` |
| `onTurnSettled` 在正常结算下每轮触发 | 面板显示「最近结算轮次：第 3 轮」 |
| `saveGameData` / `readGameData` 与 `handle` / `callHost` 通路可用 | 浏览器侧读到了宿主侧写入并存的轮次 |
| `client.js` 改完复制后，刷新页面即显示新内容 | 侧栏面板与「记录」区出现在页面上 |
| `plugins/` 下**不能**用 junction / 符号链接 | 见上节，`isDirectory() === false` 被扫描过滤 |

尚未验证（留到需要时再测）：`onTurnSettled` 在玩家关掉全部后台结算时是否真的不触发（设计稿 §10.1 的说法）。

## 设计变更怎么记（ADR）

`docs/人物冷存档插件-设计稿.md` **由用户维护**（见 ADR 0003）。AI 不主动改它；实现与它不一致时，写成 **ADR** 存进 `docs/adr/`。

```text
docs/adr/0003-简短标题.md
```

- 文件名四位编号递增，**不复用编号**；
- 正文四段：`背景 / 决定 / 后果`，另加 `状态`、`日期`；
- **只增不改**：推翻旧结论时新增一条并标 `supersedes: 第 N 条`，旧条目正文保留；
- 现行结论以 ADR 为准。代码里出现「设计稿写 X，这里写 Y」时，注释指向对应 ADR 编号。

现存的：`0001` 设计文档的维护方式、`0002` 人物册放在插件面板、`0003` 设计稿由用户维护（推翻 0001 的「冻结」项）、`0004` 信度来源用人物编号、`0005` 时间只记录不解析。

**待清理（有触发条件，别忘了）**：

- `anchors`（整局数据里按人物存的在场名单）是**临时结构**。一旦开始实现「在场人物也进快照」，就要删掉它 —— 那时在场的每个人物本来就在快照里带着自己的 turn 与 gt，这份名单重复了。详见 ADR 0005 末尾。

## 提交

- 每完成一个可验收的点就单独提交一次，提交只包含该改动。
- 提交信息用中文，写清「做了什么 / 为什么」。
- 不提交：`node_modules/`、`.tavern-entry.mjs`、`.tavern-status.json`、调试产物。

## 安全

- 禁止 `rm` / `del` / `Remove-Item` 等删除操作；要删一律移进回收站。
- 动软链接、硬链接前先审查目标（本项目已被 junction 坑过一次，见上）。
- 重要文件改动前先备份到 `backups/`。
