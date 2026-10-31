// 人物冷存档 · 人物编号
//
// 编号是**身份证**：`p` 开头 + 十进制数字（如 p7）。
// 规则（ADR 0004）：
//   - 出现就给号 —— 正文里被识别为一个"人物实体"（有名字，或有可指代的标识）就发一个；
//   - **号码永不复用** —— 判定为龙套、人物被删除、被合并，都只丢弃这个号，绝不发给下一个人。
//     否则回退到旧快照时，`rp7` 会指向另一个人，且没有任何报错。
//
// 计数器存在整局数据里（`nextId`），不随回退变、分叉时自动复制、删局自动清空。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

/** 计数器初值。 */
export function createIdCounter() {
  return 1
}

/**
 * 取一个新的人物编号。
 * @param {number} counter 当前计数器（整局数据里的 nextId）
 * @returns {{id: string, next: number}} 新编号，以及写回整局数据的新计数器
 */
export function takePersonId(counter) {
  const current = Number.isInteger(counter) && counter > 0 ? counter : createIdCounter()
  return { id: `p${current}`, next: current + 1 }
}
