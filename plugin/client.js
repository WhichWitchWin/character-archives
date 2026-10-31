// 人物冷存档 · 浏览器侧（M1 骨架）
//
// 唯一入口：侧栏「NPC档案馆」面板（registerPanel）。
// 人物册内容与容量/动作记录都放在这一页里，不占「酒馆状态」页。
//
// 本文件由浏览器直接加载，不打包；改完几秒内自动生效。
// load 的 id 必须和 package.json 的 name 一致。

window.__ModuleLoader__.load({
  id: 'dsh-tavern-npc-archives',
  factory: (require) => {
    const React = require('react')
    const { useState, useEffect } = React
    const h = React.createElement

    const PLUGIN = 'dsh-tavern-npc-archives'

    // 向宿主侧要本局摘要。没有打开对局时不调用 render，正常不会走到 gameId 为空。
    function useSummary(tavernUi, gameId) {
      const [state, setState] = useState({ loading: true, summary: null, error: null })
      useEffect(() => {
        let live = true
        if (!gameId) return
        setState({ loading: true, summary: null, error: null })
        tavernUi
          .callHost(`${PLUGIN}/summary`, { gameId })
          .then((summary) => {
            if (live) setState({ loading: false, summary, error: null })
          })
          .catch((error) => {
            if (live) setState({ loading: false, summary: null, error: String(error?.message || error) })
          })
        return () => {
          live = false
        }
      }, [gameId])
      return state
    }

    const muted = { color: 'rgba(120,120,130,.9)', fontSize: 12 }

    // 两个入口共用的一小块内容：M1 只报「骨架在位 + 数据状态」。
    function SummaryBlock({ tavernUi, gameId, detailed }) {
      const { loading, summary, error } = useSummary(tavernUi, gameId)

      if (error) return h('div', { style: { color: '#c0392b', fontSize: 12 } }, `读取失败：${error}`)
      if (loading) return h('div', { style: muted }, '读取中…')

      const lines = [
        `结构版本 v${summary.version}`,
        summary.updatedTurn ? `最近结算轮次：第 ${summary.updatedTurn} 轮` : '还没有结算记录',
        `字典 ${summary.dictSize} 条 · 快照 ${summary.snapshotCount} 份`,
      ]

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { style: { fontSize: 13 } }, '人物册为空（M1 骨架）'),
        ...lines.map((line, index) => h('div', { key: index, style: muted }, line)),
        detailed
          ? h(
              'div',
              { style: { ...muted, marginTop: 4 } },
              '当前阶段只验证「能加载、能存、能读」。收录、召回、编辑在 M2～M4。',
            )
          : null,
      )
    }

    return {
      name: PLUGIN,
      inject: ['tavernUi'],
      apply(ctx) {
        const { tavernUi } = ctx
        if (!(tavernUi.apiVersion >= 3)) return

        // 侧栏「NPC档案馆」
        tavernUi.registerPanel({
          id: 'npc-archives',
          title: 'NPC档案馆',
          render: ({ gameId }) =>
            h(
              'div',
              { style: { padding: 12, display: 'flex', flexDirection: 'column', gap: 14 } },
              h('div', { style: { fontWeight: 600, fontSize: 15 } }, 'NPC档案馆'),
              h(SummaryBlock, { tavernUi, gameId, detailed: true }),
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                h('div', { style: { fontWeight: 600, fontSize: 13 } }, '记录'),
                h('div', { style: muted }, '暂无记录（容量变化与每轮动作会记在这里）'),
              ),
            ),
        })
      },
    }
  },
})
