// 自持文件存储：快照与整局数据都写文件，酒馆里只留指针
//
// 为什么要自己存：酒馆的会话存储有硬上限（每局 2000 条 / 8MB，每条 64KB），
// 每轮一份快照的话几百轮就顶到天花板。文件没有这个限制。
//
// 但**版本正确性仍然交给酒馆**：每轮只存一条几十字节的指针，回退时酒馆会
// 自己丢掉旧版本的记录 → 我们读不到指针 → 就读不到"未来"的档案。
//
// 清理学叙事锚定：按轮次窗口保留 + index.json 记名单 + 写完顺手剪枝；
// 删掉的文件不直接抹掉，先挪进 trash/（玩家可以自己清）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFileStore, hashKey } from '../plugin/lib/store.js'

function withStore(fn) {
  const root = mkdtempSync(join(tmpdir(), 'archives-store-'))
  try {
    fn(createFileStore({ root }), root)
  } finally {
    try { rmSync(root, { recursive: true, force: true }) } catch { /* 测试自己的临时目录 */ }
  }
}

test('整局数据：写进去能读回来；没写过返回 null', () => {
  withStore((store) => {
    assert.equal(store.readGame('s1'), null)
    store.writeGame('s1', { v: 1, entries: { a: { name: '身份职业' } } })
    assert.deepEqual(store.readGame('s1').entries.a.name, '身份职业')
    assert.equal(store.readGame('s2'), null)
  })
})

test('快照：按轮次写读，返回指针信息（文件＋短哈希）', () => {
  withStore((store) => {
    const pointer = store.writeSnapshot('s1', { turn: 3, key: 'abc123', data: { v: 1, t: 3, p: [] } })
    assert.ok(pointer.f.includes('3-'))
    assert.equal(pointer.h, hashKey('abc123'))
    assert.deepEqual(store.readSnapshot('s1', 3).data.t, 3)
  })
})

test('快照：读没有的轮次返回 null；同一轮重写会覆盖', () => {
  withStore((store) => {
    assert.equal(store.readSnapshot('s1', 9), null)
    store.writeSnapshot('s1', { turn: 3, key: 'k1', data: { v: 1, t: 3, p: [], gt: '第一次' } })
    store.writeSnapshot('s1', { turn: 3, key: 'k2', data: { v: 1, t: 3, p: [], gt: '第二次' } })
    assert.equal(store.readSnapshot('s1', 3).data.gt, '第二次')
    // 换了版本，老文件应该被清掉，不能留下两个
    const files = readdirSync(join(store.root, 'snapshots', 's1')).filter((name) => name.endsWith('.json') && name !== 'index.json')
    assert.equal(files.length, 1, `同轮应该只剩一份，实际 ${files.join('、')}`)
  })
})

test('清理：超过窗口的旧快照挪进 trash，最近的留着', () => {
  withStore((store, root) => {
    for (let turn = 1; turn <= 10; turn += 1) {
      store.writeSnapshot('s1', { turn, key: `k${turn}`, data: { v: 1, t: turn, p: [] } })
    }
    const result = store.pruneSnapshots('s1', { keepTurns: 3, currentTurn: 10 })
    assert.deepEqual(result.removed.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7])
    assert.equal(store.readSnapshot('s1', 8).data.t, 8, '窗口内的还在')
    assert.equal(store.readSnapshot('s1', 1), null, '剪掉的读不到了')
    // 不是硬删：trash 里有东西
    assert.ok(readdirSync(join(root, 'trash')).length > 0, '应该挪进了 trash')
  })
})

test('清理：窗口为 0 表示不清理', () => {
  withStore((store) => {
    store.writeSnapshot('s1', { turn: 1, key: 'k1', data: { v: 1, t: 1, p: [] } })
    store.writeSnapshot('s1', { turn: 2, key: 'k2', data: { v: 1, t: 2, p: [] } })
    assert.deepEqual(store.pruneSnapshots('s1', { keepTurns: 0, currentTurn: 2 }).removed, [])
  })
})

test('回退清理：指定轮次之后的快照挪进 trash，索引同步', () => {
  withStore((store, root) => {
    for (let turn = 1; turn <= 5; turn += 1) {
      store.writeSnapshot('s1', { turn, key: `k${turn}`, data: { v: 1, t: turn, p: [] } })
    }
    const result = store.pruneAfter('s1', 2)
    assert.deepEqual(result.removed, [3, 4, 5])
    assert.deepEqual(store.listSnapshots('s1').map((item) => item.turn), [1, 2])
    assert.equal(store.readSnapshot('s1', 3), null)
    assert.ok(existsSync(join(root, 'trash')), '删掉的要挪进 trash')
  })
})

test('回退清理：turn 不合法时不动', () => {
  withStore((store) => {
    store.writeSnapshot('s1', { turn: 3, key: 'k', data: { v: 1, t: 3, p: [] } })
    assert.deepEqual(store.pruneAfter('s1', 0).removed, [])
    assert.deepEqual(store.pruneAfter('s1', null).removed, [])
    assert.equal(store.listSnapshots('s1').length, 1)
  })
})

// ── trash 回收（P22③）──

test('emptyTrash：全清删光所有废文件', () => {
  withStore((store, root) => {
    store.writeSnapshot('s1', { turn: 1, key: 'k1', data: { v: 1, t: 1, p: [] } })
    store.writeSnapshot('s1', { turn: 2, key: 'k2', data: { v: 1, t: 2, p: [] } })
    store.pruneSnapshots('s1', { keepTurns: 1, currentTurn: 2 })   // 第 1 轮进 trash
    const before = readdirSync(join(root, 'trash')).length
    assert.ok(before > 0, 'trash 里应该有东西')
    const result = store.emptyTrash({})
    assert.ok(result.removed >= 1)
    const left = existsSync(join(root, 'trash')) ? readdirSync(join(root, 'trash')).length : 0
    assert.equal(left, 0, 'trash 应该空了')
  })
})

test('emptyTrash：按天数只清超龄的（文件名时间戳）', () => {
  withStore((store, root) => {
    // 手工造一个「30 天前」的废文件（文件名带老时间戳）和一个新的
    const trashDir = join(root, 'trash')
    mkdirSync(trashDir, { recursive: true })
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().replace(/[:.]/g, '-')
    const fresh = new Date().toISOString().replace(/[:.]/g, '-')
    writeFileSync(join(trashDir, `1-abc-${old}`), '{}')
    writeFileSync(join(trashDir, `2-def-${fresh}`), '{}')
    const result = store.emptyTrash({ maxAgeDays: 15 })
    assert.deepEqual(result.removed, 1, '只删超龄的那一个')
    const left = readdirSync(trashDir)
    assert.equal(left.length, 1)
    assert.ok(left[0].includes('2-def'), '新的要留着')
  })
})

test('emptyTrash：maxAgeDays 非法时当全清；trash 不存在返回 0', () => {
  withStore((store, root) => {
    assert.deepEqual(store.emptyTrash({ maxAgeDays: 15 }), { removed: 0, freedBytes: 0 })
    mkdirSync(join(root, 'trash'), { recursive: true })
    writeFileSync(join(root, 'trash', 'x-2020-01-01T00-00-00-000Z'), '{}')
    assert.equal(store.emptyTrash({ maxAgeDays: '乱写' }).removed, 1, '天数不是数字＝全清')
  })
})

test('删局：整个目录挪进 trash，之后读不到', () => {
  withStore((store, root) => {
    store.writeGame('s9', { v: 1 })
    store.writeSnapshot('s9', { turn: 1, key: 'k', data: { v: 1, t: 1, p: [] } })
    const result = store.dropGame('s9')
    assert.ok(result.moved)
    assert.equal(store.readGame('s9'), null)
    assert.equal(store.readSnapshot('s9', 1), null)
    assert.ok(readdirSync(join(root, 'trash')).length > 0)
  })
})

test('索引坏了也能重建：以磁盘上真实存在的文件为准', () => {
  withStore((store, root) => {
    store.writeSnapshot('s1', { turn: 4, key: 'k4', data: { v: 1, t: 4, p: [] } })
    // 故意把索引写坏
    writeFileSync(join(root, 'snapshots', 's1', 'index.json'), '{ 这不是 json', 'utf8')
    const list = store.listSnapshots('s1')
    assert.deepEqual(list.map((item) => item.turn), [4], '坏索引不该让整个档案读不出来')
  })
})

test('sessionId 里带奇怪字符也不会写到别处去', () => {
  withStore((store) => {
    store.writeGame('../evil', { v: 1 })
    assert.deepEqual(store.readGame('../evil'), { v: 1 })
    const dirs = readdirSync(join(store.root, 'games'))
    assert.equal(dirs.length, 1)
    assert.ok(!dirs[0].includes('..'), `目录名被清洗过：${dirs[0]}`)
  })
})

test('写入是原子的：临时的 .tmp 不会留下来', () => {
  withStore((store, root) => {
    store.writeGame('s1', { v: 1 })
    store.writeSnapshot('s1', { turn: 1, key: 'k', data: { v: 1, t: 1, p: [] } })
    const all = []
    const walk = (dir) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, name.name)
        if (name.isDirectory()) walk(full)
        else all.push(name.name)
      }
    }
    walk(root)
    assert.deepEqual(all.filter((name) => name.endsWith('.tmp')), [])
  })
})

test('读文件坏掉不抛错，当作没有', () => {
  withStore((store, root) => {
    store.writeGame('s1', { v: 1 })
    writeFileSync(join(root, 'games', readdirSync(join(root, 'games'))[0]), '{坏了', 'utf8')
    assert.equal(store.readGame('s1'), null)
  })
})

// 跨局专名词库（ADR 0077）：它是**跨局**数据，所以放数据根下，不进插件数据
test('跨局专名词库：写进去能读回来，文件落在数据根下', () => {
  withStore((store, root) => {
    assert.equal(store.readGlobalWords(), null, '没写过返回 null')
    store.writeGlobalWords({ v: 1, map: { 旧港: 3 } })
    assert.deepEqual(store.readGlobalWords(), { v: 1, map: { 旧港: 3 } })
    assert.ok(readdirSync(root).includes('global-words.json'), '应该落在数据根下')
  })
})
