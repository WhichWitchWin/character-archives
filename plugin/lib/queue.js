// 人物冷存档 · 串行写队列
//
// 整局数据（saveGameData）是**整份覆盖**的：A 读 → B 读 → A 写 → B 写，A 的修改就丢了。
// 所以所有"读-改-写"都丢进同一条队列，一个跑完再跑下一个。
//
// 关键约束：**队列里的任务必须几毫秒就结束**。
// 需要等模型的长任务（写回）不要在队列里等 —— 只在"把结果落盘"时进队列。

/**
 * 建一条串行队列。
 * @returns <T>(task: () => T | Promise<T>) => Promise<T>
 *   返回的函数把任务排到队尾，任务返回什么就交回什么；前一个失败不影响后一个。
 */
export function createQueue() {
  let tail = Promise.resolve()

  return function run(task) {
    // 前一个成功或失败都接着跑（onFulfilled 和 onRejected 都给 task）
    const result = tail.then(task, task)
    // 队尾只关心"这一段结束了"，不关心成败，也不把错误再抛下去
    tail = result.then(() => {}, () => {})
    return result
  }
}
