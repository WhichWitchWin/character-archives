# ADR 0094 · 后台写入档接到 member

- **日期**：2026-11-05
- **状态**：已定并已实现
- **相关**：[ADR 0028](0028-写入三档.md)（写入三档）、[ADR 0015](0015-采用member常驻成员.md)（采用 member）、[ADR 0092](0092-判人与写入合并成一次调用.md)（判人+写入合并）

## 背景

设置页的「写入方式」有三档：**子代理**（默认）／**后台任务**／**关闭**（[ADR 0028](0028-写入三档.md)）。但代码里只有一句判断：

```js
if (settings.writeback !== 'off') { await runWriteback(...) }
```

也就是说 `subagent` 和 `background` 走的是**同一条路**——后台任务档是个空壳，设置页那个选项点了没区别。

## 决定

**后台任务档用 `member` 跑。**

1. **注册成员**：`ctx.tavern.member({ name: 'character-archives', title: '档案员', tools: [交卷工具] })`——跟「书记」「润色师」同列，后台任务页能看到；
2. **档位分支**：`runPhase` 增加 `mode` 参数；`background` 档走 `ctx.tavern.runTask({ gameId, member: MEMBER_NAME, prompt })`，`subagent` 档仍走原来的 DSH 子代理；
3. **交卷**：工具 `char_archives_submit` 在成员里注册，`execute` 按 `execution.sessionId` 把 payload 存进**按局的交卷盒**（多次提交合并，不静默覆盖）；
4. **阻塞语义**：`runTask` 会等成员跑完才返回——这就是「后台任务档更及时」的代价（每轮多等一会儿）。

## 为什么

- **三档要名副其实**：设置页给了选项，代码里却是一个开关，玩家调了没感觉；
- **跟内置成员同列**：书记、润色师都在后台任务页，我们的「档案员」也应该在那里，玩家能看见它在跑；
- **合并调用之后正好能接**：判人+写入已经合成一次调用（[ADR 0092](0092-判人与写入合并成一次调用.md)），member 一次工单就能跑完。

## 代价与边界

- **member 带一段固定的简短 system**：宿主规定「带 tools 就必须带 system」（`plugin-api.js:1080`），所以成员前缀只写「你是档案员，按工单做，最后调 `char_archives_submit`」；动态占位符（`{{PERSON}}`／`{{PLAYER}}`／`{{ENTRIES}}`）每局不同，填不进固定前缀，完整规则仍**每轮拼进工单**；
- **旧宿主回落**：没有 `ctx.tavern.member` / `runTask` 时自动走子代理路径，不报错；
- **「上一轮没跑完就跳过」**：member 的任务是排队的，本插件不额外塞任务——沿用平台行为。
