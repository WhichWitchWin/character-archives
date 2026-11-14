// Shift 区间选择（ADR 0112 补充）：多选里点一条、Shift 点另一条，把两次点击之间的行**并入**选择。
// 区间按面板上**看得见的顺序**算（跨栏目也能连选）。
//
// 为什么纯函数住在 client.js：浏览器侧不打包、也不 import 本地模块（宿主直接加载这个文件），
// 所以这段逻辑只能跟面板放一起；测试用标记把它抠出来跑——测的是**真正在跑的那份代码**，
// 不是另写一份副本（副本会漂移）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const START = '// __RANGE_HELPER_START__'
const END = '// __RANGE_HELPER_END__'

function loadRangeIds() {
  const src = readFileSync(fileURLToPath(new URL('../plugin/client.js', import.meta.url)), 'utf8')
  const start = src.indexOf(START)
  const end = src.indexOf(END)
  assert.ok(start >= 0 && end > start, 'client.js 里找不到区间选择的标记块（__RANGE_HELPER_START__/END）')
  const code = src.slice(start + START.length, end)
  return new Function(`${code}\nreturn rangeIds`)()
}

test('区间选择：从前往后，含两端', () => {
  const rangeIds = loadRangeIds()
  assert.deepEqual(rangeIds(['a', 'b', 'c', 'd'], 'b', 'd'), ['b', 'c', 'd'])
})

test('区间选择：从后往前也一样（谁先点都行）', () => {
  const rangeIds = loadRangeIds()
  assert.deepEqual(rangeIds(['a', 'b', 'c', 'd'], 'd', 'b'), ['b', 'c', 'd'])
})

test('区间选择：点同一条只返回它自己', () => {
  const rangeIds = loadRangeIds()
  assert.deepEqual(rangeIds(['a', 'b'], 'a', 'a'), ['a'])
})

test('区间选择：任一头不在可见列表里（折叠/换人/刚删）→ 只返回当前这一条，别猜区间', () => {
  const rangeIds = loadRangeIds()
  assert.deepEqual(rangeIds(['a', 'b'], 'gone', 'b'), ['b'])
  assert.deepEqual(rangeIds([], 'a', 'b'), ['b'])
  assert.deepEqual(rangeIds(null, 'a', 'b'), ['b'])
})

test('区间选择：顺序完全按传入的可见顺序（跨栏目、折叠后的顺序）', () => {
  const rangeIds = loadRangeIds()
  assert.deepEqual(rangeIds(['x', 'y', 'z'], 'z', 'x'), ['x', 'y', 'z'])
  // 数字与字符串混着来也要对（面板里两种都可能出现）
  assert.deepEqual(rangeIds([1, 2, 3], '1', 3), ['1', '2', '3'])
})
