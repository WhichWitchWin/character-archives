// 串行写队列：整局数据只有一个写入口，避免"读-改-写"互相覆盖。
// 锁只包住任务本身（毫秒级读写），绝不在任务里等模型 —— 那会把所有人卡住。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createQueue } from '../plugin/lib/queue.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('按提交顺序一个接一个跑，不交叉', async () => {
  const run = createQueue()
  const order = []
  await Promise.all([
    run(async () => {
      order.push('a1')
      await tick()
      order.push('a2')
    }),
    run(async () => {
      order.push('b')
    }),
  ])
  assert.deepEqual(order, ['a1', 'a2', 'b'])
})

test('前一个失败不会挡住后面', async () => {
  const run = createQueue()
  const order = []
  const bad = run(async () => {
    order.push('bad')
    throw new Error('故意失败')
  })
  const good = run(async () => {
    order.push('good')
  })
  await assert.rejects(bad, /故意失败/)
  await good
  assert.deepEqual(order, ['bad', 'good'])
})

test('任务的返回值原样交回调用方', async () => {
  const run = createQueue()
  assert.equal(await run(async () => 42), 42)
  assert.deepEqual(await run(() => ({ ok: true })), { ok: true })
})

test('前一个任务多久都不影响别人的入队（入队不阻塞）', async () => {
  const run = createQueue()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const first = run(async () => { await gate; return 'first' })
  let secondStarted = false
  const second = run(async () => { secondStarted = true; return 'second' })
  await tick()
  assert.equal(secondStarted, false)   // 前一个没完，第二个还没开始
  release()
  assert.equal(await first, 'first')
  assert.equal(await second, 'second')
})
