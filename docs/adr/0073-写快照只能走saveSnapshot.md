# 0073 写快照只能走 saveSnapshot（裸快照会让整本人物册"消失"）

- **状态**：有效
- **日期**：2026-11-03
- **相关**：[ADR 0057](0057-自持文件存储.md)（内容写文件、酒馆存指针）、[ADR 0058](0058-数据放插件数据区.md)

## 症状

玩家在面板上**删一条值**，结果**整个人的档案不见了**——面板上一个人都没有。

## 根因

有 **5 处**接口直接往酒馆轮数据里写了**整份快照**：

```js
await ctx.tavern.saveTurnData({ gameId, turn, data: snapshot })   // ❌
```

而按 ADR 0057，酒馆里只该存 **`{ f, h }` 指针**（内容在我们自己的文件里）。

写成裸快照之后：

```
轮数据里没有 f 指针
   ↓
readSnapshotAt 判 `typeof payload.f !== 'string'` → 当作"这一轮没有快照"
   ↓
返回【空快照】 → 面板显示 0 人（看着像"人被删了"）
   ↓
下一轮结算把空快照写回文件 → **真丢数据**
```

**人没被删，是快照读不到了。**

涉及 5 处：手动新建人物、改状态、改值、删值、以及导入的落盘（`pendingImport`）。

## 决定

### 1. 写快照**只能**走 `saveSnapshot`

`saveSnapshot` 干两件事：内容写文件 + 酒馆里存指针。所有写路径统一走它。

### 2. 加守卫测试钉死

`tests/hostWiring.test.mjs`：`saveTurnData` 在 `index.mjs` 里**只准出现 1 次**，且必须在 `saveSnapshot` 内部、写的必须是 `data: pointer`。

### 3. 手动操作要补 `textVersion`

手动接口拿不到当前轮的 textVersion，要自己读一次 `readTurnData` 再传给 `saveSnapshot`。

## 数据修复

已经写坏的轮数据可以按 `snapshots/<会话>/index.json` 里记的文件名，把 `data` 改回 `{ f, h }`。**快照文件本身没被破坏**（那次只写坏了指针），所以修完人就回来了。

## 后果

- **收益**：这类"人突然消失"的故障从根上没了。
- **代价**：手动操作多一次 `readTurnData`（一次很小的读）。
- **教训**：和存储层打交道时，**写入路径必须收敛到一个函数**——散着写迟早早出这种"格式不一致"的坑。ADR 0072 里设置分三个作用域也是同一个道理（收敛到 `readScopedSettings` / `writeScopedSettings`）。
