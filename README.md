# NPC档案馆（dsh-tavern-npc-archives）

DSH Tavern 插件。把游玩中出现、**具有后续价值的非龙套人物**，在离开现场后收进「人物册」；之后按关键词按需召回；人物回场则冻结，再次离场时恢复同一本人物书并刷新。

- 以**人物为中心**保存内容，不按剧情保存，不做剧情流水账
- 人物书属于**当前这一局**，随剧情回退、分叉，由酒馆自动处理
- 只维护**离场人物**；在场人物交给酒馆前台与人物卡原有机制

> **设计文档**：[docs/人物冷存档插件-设计稿.md](docs/人物冷存档插件-设计稿.md)（唯一权威）
> **接手必读**：[docs/交接说明-人物冷存档.md](docs/交接说明-人物冷存档.md)
> **开发手册**：[CONTRIBUTING.md](CONTRIBUTING.md)　**项目约定**：[AGENTS.md](AGENTS.md)

## 怎么装

DSH Tavern 的插件**就是一个文件夹**：把 `plugin/` 整个复制到酒馆数据目录的 `plugins/` 下即可，不需要编译、不需要装依赖、不改酒馆源码。

```text
~/.dsh/profile-data/tavern/data/plugins/
└─ dsh-tavern-npc-archives/
   ├─ package.json
   ├─ index.mjs     宿主侧
   ├─ client.js     浏览器侧
   └─ lib/
```

本地开发用：

```bash
npm run install:dev
```

## 怎么用

打开一局游戏后：**侧栏「＋」→ 插件 → NPC档案馆**。

人物册内容、容量提示与每轮动作记录，都在这一页里（不占「酒馆状态」页）。

## 结构

```text
plugin/            插件本体（复制进 plugins/ 即可运行）
├─ index.mjs       宿主侧入口：apply(ctx)
├─ client.js       浏览器侧：侧栏面板
└─ lib/            纯逻辑模块（不碰酒馆接口，可本地单测）
docs/              设计文档与交接说明
tests/             单元测试
scripts/           开发脚本
```

## 状态

**M1（骨架）已完成**：插件能被酒馆加载、面板能显示、整局数据能读写。

后续 M2 能存 → M3 能召回 → M4 能改，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。
