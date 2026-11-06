// 删人时要**连带摘下来**的东西（ADR 0088）：他名下的命题、跟他有关的指针。
//
// 为什么必须连带：只把人物从 p 里拿掉的话，命题表里"关于他"的命题、
// 指针表里"他指出去的"和"指着他的"全都会变成悬空数据——召回时要么读到
// 一个不存在的主体，要么读到一条没有主体的认知。恢复时再原样塞回去。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { claimsOfPerson, pointersOfPerson } from '../plugin/lib/deleted.js'

const claim = (id, personId, code = 'a', text = '在旧港') => [id, personId, code, text, 3, [], 0]
const pointer = (personId, claimId) => [personId, claimId, [[0, '']], 3]

test('claimsOfPerson：只拿他名下的命题', () => {
  const claims = [claim(1, 'p1'), claim(2, 'p2'), claim(3, 'p1')]
  assert.deepEqual(claimsOfPerson(claims, 'p1').map((item) => item[0]), [1, 3])
})

test('claimsOfPerson：空 / 非法输入返回空数组', () => {
  assert.deepEqual(claimsOfPerson(null, 'p1'), [])
  assert.deepEqual(claimsOfPerson([], ''), [])
})

test('pointersOfPerson：他作主体的 + 指向他名下命题的，都要摘', () => {
  const pointers = [pointer('p1', 9), pointer('p2', 1), pointer('p2', 2)]
  const got = pointersOfPerson(pointers, 'p1', [1, 3])
  assert.deepEqual(got, [pointer('p1', 9), pointer('p2', 1)])
})

test('pointersOfPerson：指向别人命题的指针不动', () => {
  const pointers = [pointer('p2', 2), pointer('p3', 7)]
  assert.deepEqual(pointersOfPerson(pointers, 'p1', [1]), [])
})

test('pointersOfPerson：没给命题编号时只摘他自己作主体的', () => {
  const pointers = [pointer('p1', 9), pointer('p2', 1)]
  assert.deepEqual(pointersOfPerson(pointers, 'p1'), [pointer('p1', 9)])
})
