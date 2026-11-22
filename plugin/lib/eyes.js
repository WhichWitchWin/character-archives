// 条目眼 / 值眼（M5-10、ADR 0114）
//
// 三层：人物 → 条目（栏目）→ 值（命题）。**只影响召回**（念不念），不影响写入——
// 与锁（写不写）正交，四种组合都合法（ADR 0037 的口径）。
//
// **不允许「子比父宽」**：人物闭眼时，他下面的条目与值一律算隐藏
// （否则面板会「人物闭眼、某栏显示睁眼」而模型其实看不见，反而更困惑）。
//
// 存储（整局数据：不回退、不写快照）：
//   flags.hidden        = { p7: true }      人物眼（已有）
//   flags.hiddenEntries = { "p7:a": true }  条目眼（**谁的指针** × 栏目）
//   flags.hiddenClaims  = { "12": true }    值眼（命题 id——同一句话只有一份，谁记得都不念）
//
// 注意与锁的方向差：条目锁/值锁按「命题属于谁」判，因为它们护的是内容；
// 条目眼按「谁的指针」判，因为召回注入的是**某个人记得的事**。
//
// 纯逻辑模块：不 import 酒馆接口、不接触 ctx。

const SEP = ':'

/** 条目眼的键：`p7:a`（与锁的键同格式，但故意各写一份——两个方向将来可能各自演化）。 */
export function entryEyeKey(personId, code) {
  return `${String(personId)}${SEP}${String(code)}`
}

/** 这个人整本档案是不是闭眼了。 */
export function isPersonHidden(flags, personId) {
  return flags?.hidden?.[personId] === true
}

/** 这个人这一栏是不是闭眼——人物眼上时整栏都算隐藏。 */
export function isEntryHidden(flags, { personId, code } = {}) {
  if (isPersonHidden(flags, personId)) return true
  return flags?.hiddenEntries?.[entryEyeKey(personId, code)] === true
}

/** 这条命题是不是闭眼。ownerId 给它所属的人：那个人闭眼时他的命题也算隐藏。 */
export function isClaimHidden(flags, { claimId, ownerId } = {}) {
  if (ownerId && isPersonHidden(flags, ownerId)) return true
  return flags?.hiddenClaims?.[String(claimId)] === true
}

/**
 * 谁闭的眼：`'person'` / `'entry'` / `'claim'` / `null`。按最上层报——面板据此显示「随人物隐藏」。
 */
export function hiddenReasonFor(flags, { personId, code, claimId } = {}) {
  if (!flags) return null
  if (personId && isPersonHidden(flags, personId)) return 'person'
  if (personId && code && flags?.hiddenEntries?.[entryEyeKey(personId, code)] === true) return 'entry'
  if (claimId !== undefined && claimId !== null && flags?.hiddenClaims?.[String(claimId)] === true) return 'claim'
  return null
}

/**
 * 命题被真正删掉时，把它号的值眼一并清掉。
 * 理由同锁：`nextClaimId` 是「最大值+1」，不清的话将来同号的新命题会莫名其妙看不见。
 * 回退不走这里，靠调用方按当前快照过滤（回到那条时间线时眼会自动恢复）。
 */
export function dropClaimHides(bucket, claimIds) {
  const ids = new Set((Array.isArray(claimIds) ? claimIds : [claimIds]).map((id) => String(id)))
  const next = {}
  let dropped = 0
  for (const [key, value] of Object.entries(bucket ?? {})) {
    if (ids.has(String(key))) {
      dropped += 1
      continue
    }
    next[key] = value
  }
  return { bucket: next, dropped }
}

/**
 * 给召回引擎用的三个 Set：把整局数据里的三只眼桶翻成引擎要的形状。
 *
 * 为什么单独抽出来：`index.mjs` 的 `apply()` 与 `runWriteback()` 是**两个作用域**，
 * 在调用处直接拼集合很容易引用到另一边的局部变量——2026-11-14 就这么错过一次：
 * `apply()` 里写了 `hiddenEntries`，而它只在 `runWriteback()` 里声明，
 * 运行期 ReferenceError 被外层 catch 吞掉，**召回注入整体静默失效**（920 条测试全绿）。
 * 抽成纯函数后，只有"传进来的东西"能被用到，且有单测盯着。
 *
 * 值眼按当前快照过滤：回退后旧号的命题可能已不存在，不过滤会标错
 * （注意：过滤只能挡"旧号不存在"，挡不住"号被复用"——那个靠 dropClaimHides）。
 */
export function recallEyeSets(flags, snapshot) {
  const live = new Set((Array.isArray(snapshot?.c) ? snapshot.c : []).map((claim) => String(claim?.[0])))
  const on = (bucket) => new Set(Object.keys(bucket ?? {}).filter((key) => bucket[key] === true))
  const liveClaims = Object.fromEntries(
    Object.entries(flags?.hiddenClaims ?? {}).filter(([key]) => live.has(String(key))),
  )
  return {
    hidden: on(flags?.hidden),
    hiddenEntries: on(flags?.hiddenEntries),
    hiddenClaims: on(liveClaims),
  }
}
