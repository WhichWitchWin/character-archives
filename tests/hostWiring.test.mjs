// 守卫：index.mjs 里的几处「插错位置 / 插重复」曾经反复咬人。
//
// 这里读源码做静态检查——不是最优雅，但比"跑一轮看看日志对不对"快得多，
// 而且能在装之前就拦住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../plugin/index.mjs', import.meta.url)), 'utf8')
const lines = source.split(/\r?\n/)

/** 取出某个函数体的行（从函数名那行到下一个顶格 `}`）。 */
function bodyOf(name) {
  const start = lines.findIndex((line) => line.includes(`function ${name}(`))
  assert.ok(start >= 0, `找不到 ${name}`)
  const out = []
  for (let i = start; i < lines.length; i++) {
    out.push(lines[i])
    if (i > start && lines[i] === '}') break
  }
  return out
}

// 手动加命题：必须顺手给他自己建一条指针——没有指针的命题召回拿不到，等于白写。
test('add-claim：建完命题要给本人建指针并落盘', () => {
  const at = lines.findIndex((line) => line.includes("'character-archives/add-claim'"))
  assert.ok(at >= 0, '找不到 add-claim 接口')
  const body = []
  for (let i = at; i < lines.length; i++) {
    body.push(lines[i])
    if (i > at && lines[i] === '  })') break
  }
  assert.ok(body.some((line) => line.includes('addClaim(')), '要建命题')
  assert.ok(body.some((line) => line.includes('addPointer(')), '要建指针')
  assert.ok(body.some((line) => line.includes('saveSnapshot(')), '要落盘')
})

// 主角姓名＝玩家称呼：改一边必须写另一边，否则下一轮 ensurePlayer 会把档案里的名字冲回去。
test('主角姓名与玩家称呼双向同步', () => {
  const bodyOfHandle = (handle) => {
    const at = lines.findIndex((line) => line.includes(`'character-archives/${handle}'`))
    assert.ok(at >= 0, `找不到 ${handle} 接口`)
    const out = []
    for (let i = at; i < lines.length; i++) {
      out.push(lines[i])
      if (i > at && lines[i] === '  })') break
    }
    return out
  }

  const setNames = bodyOfHandle('set-names')
  assert.ok(setNames.some((line) => line.includes('saveIdentity(')), '改主角姓名要写回身份设置')
  assert.ok(setNames.some((line) => line.includes('keepOldName')), '主角改名要把旧称呼进别名')

  const setIdentity = bodyOfHandle('set-identity')
  assert.ok(setIdentity.some((line) => line.includes('setPersonNames(')), '改玩家称呼要同步快照里的 p0')
  assert.ok(setIdentity.some((line) => line.includes('keepOldName')), '改称呼也要把旧称呼进别名')
})

// 面板上的主角是 /archive 补出来的（不落盘）——所有按编号操作人物的接口都要先 ensurePlayer，
// 否则对主角操作会报「找不到这个人」。
test('按人物操作的接口：先补主角再找人', () => {
  for (const handle of ['set-names', 'rename-person', 'add-claim', 'status']) {
    const at = lines.findIndex((line) => line.includes(`'character-archives/${handle}'`))
    assert.ok(at >= 0, `找不到 ${handle} 接口`)
    const body = []
    for (let i = at; i < lines.length; i++) {
      body.push(lines[i])
      if (i > at && lines[i] === '  })') break
    }
    assert.ok(body.some((line) => line.includes('ensurePlayer(')), `${handle} 要先 ensurePlayer`)
  }
})

// 第一轮（还没结算）也要能改：改用 editTurnOf 找落点轮次，不再直接抛「还没结算过」。
test('手动操作接口：第一轮也放行（用 editTurnOf 找落点轮次）', () => {
  for (const handle of ['set-names', 'rename-person', 'add-claim', 'status']) {
    const at = lines.findIndex((line) => line.includes(`'character-archives/${handle}'`))
    assert.ok(at >= 0, `找不到 ${handle} 接口`)
    const body = []
    for (let i = at; i < lines.length; i++) {
      body.push(lines[i])
      if (i > at && lines[i] === '  })') break
    }
    assert.ok(body.some((line) => line.includes('editTurnOf(')), `${handle} 要用 editTurnOf`)
    assert.ok(
      !body.some((line) => line.includes("throw new Error('这一局还没结算过")),
      `${handle} 不该再卡「还没结算过」`,
    )
  }
})

// 写入阶段日志要记解析前的原始载荷：光看 valueActions 分不清「主动交空」和「交错形状」。
test('写入阶段：日志要记解析前的原始载荷', () => {
  const at = source.indexOf('写入阶段返回 ${valueActions.length}')
  assert.ok(at >= 0, '找不到写入阶段日志')
  const body = source.slice(at, at + 700)
  assert.ok(body.includes('载荷形状'), '要记形状（array / object）')
  assert.ok(body.includes('载荷:'), '要记原始载荷内容')
})

// 模型给主角改名后必须写回身份设置，否则下一轮 ensurePlayer 会把名字同步回旧称呼。
test('模型改主角名：判人链路里要写回身份设置', () => {
  assert.ok(source.includes('playerRename'), '判人链路要检测主角的 rename 动作')
  const at = source.indexOf('playerRename')
  assert.ok(source.slice(at, at + 400).includes('saveIdentity('), '检测到后要 saveIdentity')
})

// 一局还没结算过时，面板也得有主角——不能显示空册（ADR 0085：他是玩家自己）。
test('archive：没结算过也要摆出主角', () => {
  const at = lines.findIndex((line) => line.includes("'character-archives/archive'"))
  assert.ok(at >= 0, '找不到 archive 接口')
  const body = []
  for (let i = at; i < lines.length; i++) {
    body.push(lines[i])
    if (i > at && lines[i] === '  })') break
  }
  assert.ok(body.some((line) => line.includes('ensurePlayer(')), 'archive 要补主角')
})

test('pushDebug：只推一条（曾经推了两遍，日志每条出现两次）', () => {  const body = bodyOf('pushDebug')
  const pushes = body.filter((line) => line.includes('state.debugLog.push'))
  assert.equal(pushes.length, 1, `pushDebug 里应该只有一次 push，实际 ${pushes.length} 次`)
})

// 调试开关已删（2026-11-05）：原来读 `data.debug.enabled` 而设置在 `data.settings.debug.enabled`，
// 路径对不上，点了永远显示"调试没打开"。现在日志常开，这几条守卫也跟着删。
test('pushDebug：不再有调试开关门卫（日志常开）', () => {
  const body = bodyOf('pushDebug')
  assert.ok(
    !body.some((line) => line.includes('debugOn')),
    'pushDebug 里不该再有 debugOn 门卫',
  )
  assert.ok(
    !body.some((line) => line.includes('state.settings')),
    'pushDebug 也不该读 state.settings',
  )
})

// 守卫：重要人物（★）必须有写入口。
// 召回里「★ 拿 60% 预算」和面板「★ 不沉底」早就写好了，但 `/toggle` 当初只收
// lock / hidden——`flags.star` 永远是空对象，那两处逻辑等于死代码（2026-11-05 补上）。
test('/toggle 接受 star（重要人物标记的写入口）', () => {
  const start = lines.findIndex((line) => line.includes("'character-archives/toggle'"))
  assert.ok(start > 0, '找不到 /toggle 接口')
  const block = lines.slice(start, start + 10).join('\n')
  assert.ok(block.includes("'star'"), '/toggle 的白名单里要有 star')
})

// 守卫：写快照**只能**走 saveSnapshot（文件 + 指针）。
// 曾经有 6 处直接 saveTurnData({ data: snapshot })，写进去的是裸快照（没有 {f,h} 指针），
// 结果 readSnapshotAt 读不到指针 → 返回空快照 → 面板看着像"人物被删了"，下一轮还会把空快照写回文件。
test('写快照只能走 saveSnapshot：saveTurnData 只准出现在 saveSnapshot 里', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('../plugin/index.mjs', import.meta.url)), 'utf8')
  const lines = src.split(/\r?\n/)

  const sites = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('saveTurnData(')) sites.push(i)
  }
  assert.equal(sites.length, 1, `只该有 1 处 saveTurnData，实际 ${sites.length} 处`)

  // 那一处必须在 saveSnapshot 的函数体里
  const fnStart = lines.findIndex((l) => l.includes('async function saveSnapshot'))
  assert.ok(fnStart >= 0, '找不到 saveSnapshot')
  assert.ok(sites[0] > fnStart, 'saveTurnData 应该在 saveSnapshot 内部')

  // 而且写的必须是 pointer，不是 snapshot 本体
  assert.ok(lines[sites[0]].includes('data: pointer'), 'saveTurnData 写的必须是 { f, h } 指针')
})

// 守卫：模糊建档的过期清理（ADR 0075）。
// 这张表以前只进不出——几百个候选每轮都要拿全表去正文里逐个匹配。
test('模糊建档过期清理：接在 pruneDraft 之后、写入阶段之前，且上限读设置项', () => {
  const sites = lines
    .map((line, i) => (line.includes('expireDraft(') ? i : -1))
    .filter((i) => i >= 0)
  assert.equal(sites.length, 1, `expireDraft 只该有 1 处调用，实际 ${sites.length} 处`)

  const prune = lines.findIndex((line) => line.includes('pruneDraft('))
  const write = lines.findIndex((line) => line.includes('applyWriteActions({'))
  assert.ok(prune > 0, '找不到 pruneDraft 调用')
  assert.ok(write > prune, '找不到写入阶段的 runPhase')
  // 顺序：先摘掉刚建档的，再判过期——反了会把本轮刚转正的人也数一遍"没露面"
  assert.ok(sites[0] > prune, '过期清理要在「建档后摘除」之后跑')
  assert.ok(sites[0] < write, '过期清理要在写入阶段之前跑')

  // 上限必须来自设置，不能写死数字（否则设置页那个输入框是假的）
  const block = lines.slice(sites[0] - 2, sites[0] + 6).join('\n')
  assert.ok(block.includes('settings?.draft?.maxIdleTurns'), '上限要读设置项 draft.maxIdleTurns')
})

// 守卫：索引词只能住在值条目里（ADR 0076）。
// 曾经存在插件数据的跨局缓存里：回退时值没了、缓存里的词还在，重写一条同样的值会捡到旧词。
test('索引词不许再写回插件数据（必须跟着值一起回退）', () => {
  assert.ok(!source.includes('indexWords: '), 'index.mjs 不该再往插件数据里塞 indexWords')
  assert.ok(!source.includes('clueCache'), 'index.mjs 不该再传 clueCache（改成从条目读词）')
  assert.ok(source.includes('properNounsOf'), '应把专名挑出来收进跨局词库（ADR 0077）')
})

// 守卫：模型把「回头测试·通过」当成已建档时，/debug 里要能一眼看出来。
test('判人阶段：通过名单没对应建档动作 → 记一条调试日志', () => {
  assert.ok(source.includes('passedWithoutBuild'), '判人链路要调用 passedWithoutBuild')
  assert.ok(source.includes('没报建档'), '日志文案要能看出「通过但没建档」')
})

// 守卫：后台结算档每轮只能发一次消息，判人和写入必须合并成一次 runPhase。
test('判人与写入合并：一次结算只调一次 runPhase', () => {
  const calls = lines.filter((line) => line.includes('await runPhase('))
  assert.equal(calls.length, 1, `runPhase 只该调 1 次，实际 ${calls.length} 次`)
  assert.ok(source.includes('buildCombinedPrompt'), '要调用合并素材函数')
})

// 守卫：工具描述是模型看到的函数契约，必须和「一次交一个对象」一致（ADR 0092）。
test('工具描述：一次交一个对象，不再是判人/写入两段式', () => {
  assert.ok(source.includes('一次交一个对象'), '工具描述要写一次交一个对象')
  assert.ok(!source.includes('判人交对象'), '不许再写判人交对象')
  assert.ok(!source.includes('写入交对象'), '不许再写写入交对象')
})

// 守卫：模型分多次提交时合并，不许后交覆盖先交（ADR 0092）。
test('重复提交：合并 payload，不静默覆盖', () => {
  assert.ok(source.includes('payloadMerged'), '要标记合并')
  assert.ok(source.includes('box.payload = {'), 'execute 里要合并对象')
})

// 守卫：先应用判人、再用判人后的在场名单校验命题（ADR 0092）。
test('合并顺序：allowedIds 用判人后的 presentIds', () => {
  const applyAt = lines.findIndex((line) => line.includes('applyPersonActions('))
  const allowedAt = lines.findIndex((line) => line.includes('allowedIds: presentIds'))
  assert.ok(applyAt > 0, '找不到 applyPersonActions')
  assert.ok(allowedAt > applyAt, 'allowedIds 要在判人应用之后')
  assert.ok(!source.includes('allowedIds: presentBefore'), '不许用判人前的名单')
})

// 守卫：回退后整局数据里的 updatedTurn 不会自己变小，定位轮次必须问酒馆当前状态（B1）。
test('回退：loadGameState 用 getTurnState 校正当前轮次', () => {
  assert.ok(source.includes('getTurnState'), '要读酒馆当前轮次')
  assert.ok(source.includes('resolveTurn('), '要用 resolveTurn 校正')
  assert.ok(source.includes('pruneFutureFlags('), 'flags 里的未来记录也要清')
})

// 守卫：回退后开始的新一轮，要把未来轮次的旧快照挪进 trash（B1 清理）。
test('回退清理：每轮结算开头清掉未来轮次的旧快照', () => {
  assert.ok(source.includes('store.pruneAfter('), '要调用 store.pruneAfter')
  const at = lines.findIndex((line) => line.includes('store.pruneAfter('))
  const read = lines.findIndex((line) => line.includes('await readSnapshotAt(ctx, gameId, turn)'))
  assert.ok(at > 0 && read > at, '清理要在读快照之前')
})

// 守卫：历史快照预览要两个只读接口，且预览绝不许写盘。
test('历史快照：snapshot-list 与 snapshot-at 都在，预览只读', () => {
  assert.ok(source.includes("'character-archives/snapshot-list'"), '少了 snapshot-list')
  assert.ok(source.includes("'character-archives/snapshot-at'"), '少了 snapshot-at')
  const at = lines.findIndex((line) => line.includes("'character-archives/snapshot-at'"))
  const block = lines.slice(at, at + 60).join('\n')
  assert.ok(!block.includes('saveSnapshot('), '预览接口不许写盘')
})

// 守卫：预设改成「全局默认 + 按卡覆盖」（2026-11-05）。
// 存局不许再自动写卡级——否则每张卡各存一份，又回到旧行为。
test('预设：全局默认 + 按卡覆盖，存局不再自动写卡级', () => {
  const saveBody = bodyOf('saveGameState').join('\n')
  assert.ok(!saveBody.includes('writeCardPreset'), 'saveGameState 不许再自动写卡级')
  assert.ok(source.includes('readGlobalPreset'), '要读全局预设')
  const loadBody = bodyOf('loadGameState').join('\n')
  assert.ok(loadBody.includes('readCardPreset'), '要读卡级覆盖')
  assert.ok(loadBody.includes('readGlobalPreset'), '要读全局预设')
  assert.ok(source.includes("scope = 'global'"), 'presets-save 默认写全局')
})

// 守卫：index.mjs 必须能过 `node --check`。
// 曾经因为同一个 const 声明两次（cardKey），整个模块加载失败 → 所有 handle 都没注册，
// 面板报「没有名为 character-archives/archive 的插件处理函数」。
test('index.mjs 语法：node --check 必须过（重复声明会让整个插件不加载）', () => {
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ['--check', fileURLToPath(new URL('../plugin/index.mjs', import.meta.url))], { stdio: 'pipe' })
  }, 'index.mjs 语法错误')
})

// 守卫：后台写入档要真接到 member（跟书记/润色师同列），不再是假开关。
test('后台写入：注册 member 并用 runTask 跑结算', () => {
  assert.ok(source.includes('tavern.member('), '要注册后台成员')
  assert.ok(source.includes('runTask('), '要调 runTask')
  assert.ok(source.includes("member: MEMBER_NAME"), 'runTask 要指定成员')
  assert.ok(source.includes("'background'"), '要按 writeback 档位分支')
})

// 守卫：宿主规定「有 tools 就必须有 system」（plugin-api.js:1080），
// 少了 system 会直接抛错，成员注册不上、后台任务页看不到。
test('后台成员：注册时必须同时带 system 和 tools', () => {
  const at = lines.findIndex((line) => line.includes('tavern.member('))
  assert.ok(at > 0, '找不到 tavern.member(')
  const block = lines.slice(at, at + 14).join('\n')
  assert.ok(block.includes('system:'), 'member 必须带 system，否则宿主直接抛错')
  assert.ok(block.includes('tools:'), 'member 要带交卷工具')
})

// 守卫：面板读主角名字必须跟「本局设置」的玩家称呼一致（不能只用按卡手填）。
// 曾经 /archive 只读 readIdentity().playerName，空着就把主角显示成「主角」。
test('/archive：主角名字要补 resolvePlayerName', () => {
  const at = lines.findIndex((line) => line.includes("'character-archives/archive'"))
  assert.ok(at > 0, '找不到 archive 接口')
  const block = lines.slice(at, at + 90).join('\n')
  assert.ok(block.includes('resolvePlayerName('), '/archive 要用 resolvePlayerName 补称呼')
})

// 守卫：改名（含 NPC）要把旧名自动存进别名，跟主角同一套逻辑。
test('改名：NPC 也保留旧名进别名', () => {
  assert.ok(source.includes('keepOldName: true'), '改名要保留旧名')
  assert.ok(!source.includes('keepOldName: isPlayerRow'), '不许只对主角保留旧名')
})

// 守卫：改名设置是全局开关，两处手动改名都要读它；模型改名不看这个。
test('改名设置：names.keepOldName 接进两处手动改名', async () => {
  const { DEFAULT_SETTINGS, SCOPE } = await import('../plugin/lib/settings.js')
  assert.equal(DEFAULT_SETTINGS.names.keepOldName, true, '默认开')
  assert.equal(SCOPE.names, 'global', '作用域是全局')
  const count = (source.match(/settings\.names\?\.keepOldName/g) ?? []).length
  assert.equal(count, 2, 'set-names 与 rename-person 都要读这个开关')
})

// 守卫：空局（没人可写）也要先把主角落盘再跳过——否则第一轮主角不进快照，
// 回退到第 1 轮读到空册（ADR 0085「保证存在」不应被写入阶段的快捷出口拦住）。
test('空局也落盘主角：提前出口之前先 ensurePlayer', () => {
  const at = lines.findIndex((line) => line.includes('本轮没有可写入的人'))
  assert.ok(at > 0, '找不到写入阶段的快捷出口')
  const before = lines.slice(0, at).join('\n')
  assert.ok(before.includes('async function runWriteback'), '出口应在 runWriteback 内')
  const after = lines.slice(at).join('\n')
  const flushAt = after.indexOf('await flushSnapshot()')
  const ensureAt = after.indexOf('ensurePlayer(snapshot.p,')
  assert.ok(flushAt >= 0 && ensureAt >= 0 && ensureAt < flushAt, 'ensurePlayer 要在 flushSnapshot 之前')
})

// 守卫：整局数据是整份覆盖写的，两轮结算并发时后写会覆盖先写——
// saveGameState 必须排进 lib/queue.js 的串行队列（这把锁造了很久终于接线）。
test('saveGameState 走串行队列：并发结算不互相覆盖', () => {
  assert.ok(source.includes("from './lib/queue.js'"), '要 import queue.js')
  const body = bodyOf('saveGameState').join('\n')
  assert.ok(body.includes('stateWriteQueue('), 'saveGameState 要排进队列')
})

// 说明：原来这里有一条守卫「召回抬头：传人称名，不再用 viewpointOf」（ADR 0080）。
// 2026-11-04 旧召回引擎退役（ADR 0082 重做中），buildRecall 调用已删除，
// 这条守卫失去对象，一并移除；新引擎接线时要重新立一条同样的守卫。

// 守卫：认知组（P20）设了必须真生效。三处消费点：工单里的【认知口径】、
// 召回注入（自动 + 手动 + 查档案）、写入应用（来源组名额）。
// 只加设置不接线，玩家改了没反应，比没有这个设置更气人。
test('认知组接线：设置传到提示词、召回注入、写入应用', () => {
  const wired = (source.match(/cognition: settings\.cognition/g) ?? []).length
  assert.ok(wired >= 5, `只有 ${wired} 处传了 cognition：工单、/prompts 面板、自动召回、手动召回、查档案都要传`)
  assert.ok(
    source.includes('maxOtherSources: settings?.cognition?.maxOtherSources'),
    '写入应用要按设置传「别人组」名额',
  )
  const runPhaseLine = lines.find((line) => line.includes('function runPhase('))
  assert.ok(runPhaseLine, '找不到 runPhase')
  assert.ok(runPhaseLine.includes('cognition'), 'runPhase 要能收 cognition')
  const contextLine = lines.find((line) => line.includes('buildContextText({ viewpoint'))
  assert.ok(contextLine && contextLine.includes('cognition'), '工单里的动态上下文要带认知口径')
})

// ── 删命题 / 删认知（2026-11）：面板上的两个 🗑 ──

/** 取出某个 handle 的整段源码（从注册那行到收尾的 `  })`）。 */
function handleBody(handle) {
  const at = lines.findIndex((line) => line.includes(`'character-archives/${handle}'`))
  assert.ok(at >= 0, `找不到 ${handle} 接口`)
  const out = []
  for (let i = at; i < lines.length; i++) {
    out.push(lines[i])
    if (i > at && lines[i] === '  })') break
  }
  return out
}

// 删命题必须顺手摘掉指向它的指针：留着就是悬空指针（面板会去查不存在的命题）。
test('delete-claim：先摘命题，同时把指向它的指针一起摘掉', () => {
  const body = handleBody('delete-claim')
  assert.ok(body.some((line) => line.includes('dropClaim(')), '要摘命题')
  assert.ok(body.some((line) => line.includes('pointersTo(')), '要先列出指向它的指针')
  assert.ok(body.some((line) => line.includes('dropPointer(')), '要把那些指针摘掉，不留悬空')
  assert.ok(body.some((line) => line.includes('saveSnapshot(')), '要落盘')
  assert.ok(body.some((line) => line.includes('removedPointers')), '要把摘掉几条指针报回去')
})

// 参数校验：claimId 是命题表里的正整数 id，字符串／0／小数都不该往下传。
test('delete-claim：gameId 与 claimId 都要校验', () => {
  const body = handleBody('delete-claim')
  assert.ok(body.some((line) => line.includes('Number.isInteger(id)')), 'claimId 要统一成数字再校验成正整数')
  assert.ok(body.some((line) => line.includes('ok: false')), '参数不对要返回 {ok:false, reason}')
})

// 删认知**只摘指针，不许顺手删命题**：命题还是要出现在那个人的「他是什么样」里，
// 命题一删，他自己那条记录就跟着没了。
test('delete-cognition：只摘指针，绝不删命题', () => {
  const body = handleBody('delete-cognition')
  assert.ok(body.some((line) => line.includes('dropPointer(')), '要摘指针')
  assert.ok(!body.some((line) => line.includes('dropClaim(')), '不许顺手删命题')
  assert.ok(!body.some((line) => line.includes('snapshot.c =')), '不许动命题表')
  assert.ok(body.some((line) => line.includes('saveSnapshot(')), '要落盘')
  assert.ok(body.some((line) => line.includes("'没有这条认知'")), '本来没有这条认知要说清楚')
})

// 坑：删掉某条命题的**最后一条**指针，命题就成了"零指针孤儿"，
// 下一轮结算 `pruneOrphanClaims` 会把它悄悄摘掉（豁免只给本轮新建的）。
// 面板上写的是「命题本身不动」——那就必须在这里拦住，让玩家改用命题行的 🗑。
test('delete-cognition：最后一条认知要拒绝，并指向"删命题"', () => {
  const body = handleBody('delete-cognition')
  assert.ok(body.some((line) => /pointersTo\(snapshot\.pt,\s*(claimId|id)\)/.test(line)), '要先数这条命题还剩几条认知')
  assert.ok(body.some((line) => /<=\s*1/.test(line)), '只剩一条时要拒绝')
  assert.ok(body.some((line) => line.includes('孤儿')), '理由里要说清"下一轮会被当孤儿命题清掉"')
})

// 同一行里「改命题」能收数字字符串、「删命题」不收，外部调用会撞出「命题编号不对」。
test('delete-claim：编号跟 update-claim 一样接受数字字符串', () => {
  const body = handleBody('delete-claim')
  assert.ok(body.some((line) => line.includes('Number(claimId)')), 'claimId 要先统一成数字再校验')
})

// 约定细则移进每轮工单后，接线要把本局栏目定义传进 buildContextText（ADR 0105）。
test('约定规则接线：runPhase 与 /prompts 都把本局栏目定义传进动态上下文', () => {
  assert.match(lines.find((line) => line.includes('function runPhase(')) || '', /definitions\s*=\s*\{\}/u, 'runPhase 要能收 definitions')
  const phaseLine = lines.find((line) => line.includes('buildContextText({ viewpoint'))
  assert.ok(phaseLine && phaseLine.includes('definitions'), '工单里的动态上下文要带本局栏目定义')
  const runPhaseCall = lines.find((line) => line.includes('mode: settings.writeback'))
  assert.ok(runPhaseCall && runPhaseCall.includes('definitions'), '派发时要把本局栏目定义传进 runPhase')
  const handle = handleBody('prompts')
  assert.ok(handle.some((line) => line.includes('definitions: state.entries')), '/prompts 预览也要传本局栏目定义')
})

// 两段交卷工具说明原来各写一份，撤回块与约定块都没登记。
test('交卷工具说明共用一份并登记撤回块', () => {
  const count = (source.match(/description:\s*SUBMIT_TOOL_DESCRIPTION/g) || []).length
  assert.equal(count, 2, `两处 description 都要用常量，实际 ${count} 处`)
  assert.match(source, /const SUBMIT_TOOL_DESCRIPTION\s*=\s*'[^']*撤回:\[\{关于,序号\}\]/u, '常量定义行要登记撤回块')
  assert.match(source, /const SUBMIT_TOOL_DESCRIPTION\s*=\s*'[^']*【约定规则】/u, '常量定义行要指路约定规则')
  assert.match(source, /definitions: state\.entries \?\? \{\}/u, '约定栏目要由本局栏目定义决定，不是写死在工具说明里')
})

// 栏目抓取提示词会拼进**每轮**工单的【栏目定义】：8 条 × 40 字 = 320 字，
// 再长就从召回预算里抢字数。所以保存时按 40 字封顶（2026-11-06 定的）。
test('预设提示词：保存时按 40 字封顶', () => {
  assert.match(source, /const MAX_ENTRY_PROMPT_CHARS = 40\b/u, '要有 40 字上限的常量')
  const body = handleBody('presets-save')
  assert.ok(body.some((line) => line.includes('MAX_ENTRY_PROMPT_CHARS')), 'presets-save 要按这个上限校验')
})
