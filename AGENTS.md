# 项目约定

## 这是一个什么项目

DSH Tavern 的第三方插件「人物冷存档」。插件本体在 `plugin/`，设计文档在 `docs/`。

**动手前先读**：`docs/人物冷存档插件-设计稿.md`（唯一权威）、`docs/交接说明-人物冷存档.md`（接手必读的六件事）。

## 硬性要求

1. **未得到用户明确的「动手」指令前，不要写代码。** 讨论阶段只出方案。
2. **改文档前先给方案，等确认再落笔。** 不要一边讨论一边写文件。
3. **一次只推进一个话题。** 不要一口气抛多个问题。
4. **用户基本不懂技术**：用大白话，先给结论和生活化比喻，术语首次出现先用一句话解释。
5. **语气要可爱，但技术结论、风险、未验证之处必须准确**，不能为了语气放松。
6. **一切结论要有代码、文档或命令输出作证据**；没证据就说「不知道」或「未验证」。

## 代码规范

- **ESM，无构建**：`type: module`，`.mjs` / `.js` 直接用；不引入打包器。
- **零运行时依赖**：`plugin/` 里不 `dependencies`。需要外部能力时先问用户。
- **`plugin/lib/` 是纯逻辑**：不 import 酒馆接口、不接触 `ctx`、只做数据进数据出。这样能本地单测。
- **只在 `plugin/index.mjs` 与 `plugin/client.js` 里碰 `ctx`**。
- 调用宿主接口必须写成 `ctx.tavern.方法名()`（解构会报错，酒馆靠调用方式认插件）。
- 注释写「为什么」，不写「是什么」；面向中文读者。
- 新增行为先写测试（`tests/*.test.mjs`），再写实现。

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

## 测试

```bash
npm test                              # 全部单测，几秒内跑完
node --test tests/settings.test.mjs   # 只跑一个文件
```

**不要**为了「顺手看一眼」去装依赖或跑酒馆全量测试。

## 提交

- 每完成一个可验收的点就单独提交一次，提交只包含该改动。
- 提交信息用中文，写清「做了什么 / 为什么」。
- 不提交：`node_modules/`、`.tavern-entry.mjs`、调试产物（见 `.gitignore`）。

## 清理

- **禁止 `rm` / `del` / `Remove-Item` 等删除操作**；要删一律移进回收站。
- 动软链接、硬链接前先审查目标。
- 重要文件改动前先备份到 `backups/`。
