// 人物编号：出现就给号，号码永不复用（作废的号也不给下一个人）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createIdCounter, takePersonId } from '../plugin/lib/person.js'

test('编号从 1 开始，取一次加一', () => {
  assert.equal(createIdCounter(), 1)
  const first = takePersonId(1)
  assert.equal(first.id, 'p1')
  assert.equal(first.next, 2)

  const second = takePersonId(first.next)
  assert.equal(second.id, 'p2')
  assert.equal(second.next, 3)
})

test('号码单调递增，不因外部删除而回退', () => {
  let counter = createIdCounter()
  const taken = []
  for (let i = 0; i < 3; i += 1) {
    const result = takePersonId(counter)
    taken.push(result.id)
    counter = result.next
  }
  assert.deepEqual(taken, ['p1', 'p2', 'p3'])
  // 就算前面的人都作废了，counter 也不会退回去
  assert.equal(takePersonId(counter).id, 'p4')
})
