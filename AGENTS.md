# 项目约定

## 这是一个什么项目

DSH Tavern 的第三方插件「人物档案馆」（`character-archives`）。插件本体在 `plugin/`，设计文档在 `docs/`。

**动手前先读**：

- [设计文档](docs/DESIGN.md) —— **由 AI 维护**（ADR 0013）；只写当前最新状态，改完必须说明改了哪节、为什么。
- [决策记录 docs/adr/](docs/adr/) —— **所有重要决策**都记在这里（ADR 0012），不只记偏离；有疑问先看它。
- [ROADMAP](docs/ROADMAP.md) —— 只放**后续版本**要做的功能，以及已设计好但延后的功能；当前进度看路线图版本表与 git 记录。

> 变更记录**不在上面三个文件里**——时间线统一写 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

## 硬性要求

1. **未得到用户明确的「动手」指令前，不要写代码。** 讨论阶段只出方案。
2. **README / CONTRIBUTING 改动前先给方案，等确认再落笔。** 设计稿、ADR、路线图、**本文件（AGENTS.md）** 由 AI 维护，可直接改，但必须在同一轮说明改了哪节、为什么。
3. **一次只推进一个话题。** 不要一口气抛多个问题。
4. **用户基本不懂技术**：用大白话，先给结论和生活化比喻，术语首次出现先用一句话解释。
5. **语气要可爱，但技术结论、风险、未验证之处必须准确**，不能为了语气放松。
6. **一切结论要有代码、文档或命令输出作证据**；没证据就说「不知道」或「未验证」。
7. **变更记录写 `docs/CHANGELOG.md`，不要往 DESIGN / ROADMAP 里追加历史。** 设计稿和路线图只写「当前」；原因写在 ADR（ADR 0013）。
8. **回复只给必要内容。** 先给结论，不铺垫、不复述问题、不罗列无关选项；除非用户明确要求「详细说明」，否则不展开长篇。

## 代码规范

- **ESM，无构建**：`type: module`，`.mjs` / `.js` 直接用；不引入打包器。
- **零运行时依赖**：`plugin/` 里不 `dependencies`。需要外部能力时先问用户。
- **`plugin/lib/` 是纯逻辑**：不 import 酒馆接口、不接触 `ctx`、只做数据进数据出。这样能本地单测。
- **只在 `plugin/index.mjs` 与 `plugin/client.js` 里碰 `ctx`**。
- 调用宿主接口必须写成 `ctx.tavern.方法名()`（解构会报错，酒馆靠调用方式认插件）。
- 注释写「为什么」，不写「是什么」；面向中文读者。
- 新增行为先写测试（`tests/*.test.mjs`），再写实现。
- **提示词别手改生成物**：三段提示词的源是 `plugin/assets/system-prompt.txt` / `write-prompt.txt` / `recall-prompt.txt`，`plugin/prompt.js` 是 `scripts/sync-prompt.mjs` 生成的兜底副本；改完跑脚本，并同步 `lib/promptTemplates.js` 的 `DEFAULT_TEMPLATES`（「恢复默认」会拿它们覆盖 txt）。

## 官方接口文档（写代码时对照）

来自 `flizzywine/dsh-tavern` 仓库的 `presets/tavern/skills/tavern-plugin/references/`：

| 文件 | 内容 |
|---|---|
| `plugin-api.md` | 接口总览、插件文件夹规则、生效时机 |
| `plugin-api-game.md` | 轮次事件、读正文与人物卡、时间线变化 |
| `plugin-api-prompt.md` | 正文/结算/候选/压缩注入，`member`、`runTask`、`job`、`handle` |
| `plugin-api-data.md` | 媒体项、`saveTurnData` / `readTurnData` / `saveGameData` / `readGameData` / `savePluginData` |
| `plugin-api-ui.md` | `registerPanel`、`registerStatusSection`、`callHost` 等浏览器侧接口 |
| `plugin-api-cards.md` | 人物卡库、`updateCardRaw`、Skill |

## 开发与测试

开发环境、调试循环（含「为什么不能用 junction」）、测试命令、提交规范，统一写在 [CONTRIBUTING.md](CONTRIBUTING.md)。本文件只放「给 AI 的硬性要求」和代码规范。

## 清理

- **禁止 `rm` / `del` / `Remove-Item` 等删除操作**；要删一律移进回收站。
- 动软链接、硬链接前先审查目标。
- 重要文件改动前先备份到 `backups/`（该目录已 gitignore，只留在本机；要回退看 git 提交）。
