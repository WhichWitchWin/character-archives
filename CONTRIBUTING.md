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
npm run install:dev     # 把 plugin/ 复制到 <数据目录>\plugins\character-archives
```

| 改了什么 | 怎么生效 |
|---|---|
| `plugin/client.js` | 复制后**刷新酒馆页面**，几秒内换成新代码 |
| `plugin/index.mjs` | 复制后**必须重启酒馆**（平台限制，绕不过）→ 用下面的重启脚本 |
| 新增 / 删除插件文件夹 | 酒馆的 `fs.watch` 会自己发现，几秒内重新登记 |

### 重启酒馆（DSHT）：`scripts/restart-dsht.cmd`

DSH（桌面版）和 DSHT（酒馆）是**两个独立实例**，进程都叫 `DeepSeek Harness.exe`，在任务管理器里手点很容易把自己正在用的桌面版一起关掉。

```bat
scripts\restart-dsht.cmd            :: 双击也行 = 重启
scripts\restart-dsht.cmd status     :: 只看状态
scripts\restart-dsht.cmd stop       :: 只停
scripts\restart-dsht.cmd start      :: 只启
```

它做三件事，按顺序：**停后台 → 关酒馆那个浏览器窗口 → 重新启动（窗口会自己打开）**。

酒馆窗口是 Edge/Chrome 的**应用模式窗口**，标题里带 `DSH Tavern`；脚本靠这个认它。
只想重启后台、保留窗口的话加 `-KeepBrowser`：

```bat
scripts\restart-dsht.cmd restart -KeepBrowser
```

> ⚠️ 重启后**访问凭证（token）会换新**，所以旧窗口本来就打不开了——一起关掉重开才顺手。

窗口行为：**成功就自己关**（停 1 秒多让你看清结果）；**失败会留着**并等你按回车，好读错误。
`status` 是给人看的，所以读完要按回车才关。被脚本调用（stdin 被重定向）时不会停下来等。

它怎么认出「哪个是酒馆」：

| | 命令行特征 |
|---|---|
| **DSHT（酒馆）** | `--profile tavern`／`dsh-tavern\bin\dsh-tavern.mjs`／`tavern-plugin\...\server-template-worker.js` |
| **DSH（桌面版）** | `--profile desktop`／`dsh-desktop-host\lib\index.js`／`@deepseek-ai/dsh-desktop` |

⚠️ 不能用 `dsh-desktop-host` 当桌面标记——**酒馆根进程的命令行里也有** `…\@deepseek-ai\dsh-desktop-host\lib\cli.js`，会把酒馆误判成桌面版（实际踩过）。

启动走的是和桌面快捷方式同一条路：`wscript.exe launch.vbs`。

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

- 纯逻辑（快照编解码、字典、文本匹配、召回打分、命题与指针、写入校验、提示词模板）**必须有单测，且不需要开酒馆**。
- 涉及插件接口的部分只能装进酒馆手测。
- **不要**为了「顺手看一眼」去装依赖或跑酒馆全量测试（上游全量一次约 3 分钟）。

## 代码结构约定

- `plugin/lib/` 是纯逻辑：不 import 酒馆接口、不接触 `ctx`、只做数据进数据出。
- 只有 `plugin/index.mjs` 与 `plugin/client.js` 碰 `ctx`。
- 宿主接口必须写成 `ctx.tavern.方法名()`；解构会报错（酒馆靠调用方式认插件）。
- ESM、无构建、零运行时依赖。

## 路线

进度与模块清单**不在这里重复**，各守一处：

- **要做什么、验收标准、哪项还没做完** → [ROADMAP](docs/ROADMAP.md) 第二节版本表与各里程碑清单；
- **代码里现在有哪些模块、各自干什么** → [DESIGN §十三 代码模块清单](docs/DESIGN.md#十三代码模块清单)（那份是唯一的模块表，新增文件记得补行）。

当前状态一句话：M1 骨架、M2 能存、M3 能召回都已落地并接线；M4 能改的主体（自动写回、面板、导入导出）也已落地；容量执行 2026-11-06 决定不做（[ADR 0097](docs/adr/0097-容量兜底不做.md)），跨插件接口仍未做。

> 想加文件前先看 §十三 有没有同类实现——能复用就别新建（一次只推进一个话题，别顺手重构）。

### 已验证的平台事实（实测，不是推测）

| 事实 | 证据 |
|---|---|
| 插件文件夹放进 `plugins/` 后，酒馆几秒内自动登记并加载，不用重启 | `.tavern-status.json` = `{"ok":true}`；`cordis.patch.yml` 出现 `tavern-user-plugin-character-archives` |
| `onTurnSettled` 在正常结算下每轮触发 | 面板显示「最近结算轮次：第 3 轮」 |
| `saveGameData` / `readGameData` 与 `handle` / `callHost` 通路可用 | 浏览器侧读到了宿主侧写入并存的轮次 |
| `client.js` 改完复制后，刷新页面即显示新内容 | 侧栏面板与「记录」区出现在页面上 |
| `plugins/` 下**不能**用 junction / 符号链接 | 见上节，`isDirectory() === false` 被扫描过滤 |

尚未验证（留到需要时再测）：`onTurnSettled` 在玩家关掉全部后台结算时是否真的不触发（设计稿 §10.1 的说法）。

## 设计变更怎么记（ADR）

`docs/DESIGN.md` **由 AI 维护**（见 [ADR 0013](docs/adr/0013-设计稿改由AI维护.md)），只写当前最新状态。**所有重要决策**（不只"与设计稿不一致"的）都写成 ADR 存进 `docs/adr/`（见 [ADR 0012](docs/adr/0012-adr口径扩成行业标准.md)）。

```text
docs/adr/0014-简短标题.md
```

- 文件名四位编号递增，**不复用编号**；
- **一条 ADR = 一个决策**，不混批；
- 正文六段：`背景 / 决定 / 后果 / 被否决的方案 / 待定`，另加 `状态`、`日期`、`supersedes`；
- **只增不改**：推翻旧结论时新增一条并标 `supersedes: ADR NNNN 中「某条」`，旧条目正文保留；
- 写完后在 [ADR 索引](docs/adr/README.md) 加一行，再改 `DESIGN.md` 对应小节并标 `见 ADR NNNN`；
- 两者冲突时**以 `DESIGN.md` 为准**——它是被同步维护的那一份。

全部决策的索引见 [docs/adr/README.md](docs/adr/README.md)。

**已完成的一条（留档，别再照着写）**：`anchors`（整局数据里按人物存的在场名单）已按 [ADR 0025](docs/adr/0025-离场记录取代在场名单.md) 换成「离场记录」——只在人物离场那一刻记 `{turn, gt}`，在场的人看状态即可；代码里已经搜不到 `anchors`。

## 提交

- 每完成一个可验收的点就单独提交一次，提交只包含该改动。
- 提交信息用中文，写清「做了什么 / 为什么」。
- 不提交：`node_modules/`、`.tavern-entry.mjs`、`.tavern-status.json`、调试产物。
- `.gitignore` 里的 `backups/` 与 `scripts/` **只挡未跟踪的文件**：`scripts/install-dev.mjs`、`scripts/sync-prompt.mjs` 已经在仓库里，会继续被跟踪、继续给 `npm run install:dev` 用；真正被忽略的是跟本机路径绑定的 `scripts/restart-dsht.cmd`／`.ps1`。`backups/` 是本机备份，不入库（要回退看 git 提交）。

## 安全

- 禁止 `rm` / `del` / `Remove-Item` 等删除操作；要删一律移进回收站。
- 动软链接、硬链接前先审查目标（本项目已被 junction 坑过一次，见上）。
- 重要文件改动前先备份到 `backups/`。

## 装完必须重启：不要"边玩边装"

**改完 `plugin/` 并跑 `install-dev.mjs` 之后，必须让用户重启 DSH，再继续玩。**

为什么：酒馆对插件目录是**热重载**——它加载新代码，但**旧实例注册的回调不会注销**。
于是同一个进程里会有**两个插件实例**同时响应每轮事件：

| 症状 | 说明 |
|---|---|
| **每条调试日志打两遍** | 一份来自新代码，一份来自旧代码（旧的那份没有 `turn` / `kind` 字段，所以显示成 `[info]`） |
| **同一轮的日志各自成一个"轮次组"** | 新旧交替出现，按相邻归并的分组就散了 |
| **每轮结算被处理两次** | 多跑一次判定＋写入 → **多花一次模型调用、慢一倍** |
| 数据写坏 | **通常不会**（两遍算的是同一份状态），但不要依赖这一点 |

**正确顺序**：

```text
改代码 → install-dev.mjs → 让用户重启 DSH → 再玩
```

**不要**刚装完就让用户继续玩——那段窗口里就是双份。

排查时如果看到日志成对出现（一条带 `turn`、一条不带），先怀疑这个，别去查业务逻辑。

面板侧（`client.js`）不一样：它只改浏览器产物，**刷新页面**即可，不需要重启。
