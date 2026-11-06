// 人物档案馆 · 浏览器侧
//
// 侧栏「人物档案馆」面板：分组、人物行、点开看条目与值、锁/眼睛、导出导入。
// 计算全在宿主侧的 lib/panelView.js 里做完了，这里只负责画。
//
// 本文件由浏览器直接加载，不打包；改完几秒内自动生效。
// load 的 id 必须和 package.json 的 name 一致。

window.__ModuleLoader__.load({
  id: 'character-archives',
  factory: (require) => {
    const React = require('react')
    const { useState, useEffect, useCallback, useRef } = React
    const h = React.createElement

    const PLUGIN = 'character-archives'


    // 身份（玩家称呼＋人称）：按卡存，档案界面顶部直接能改
    function useIdentity(tavernUi, gameId) {
      const [state, setState] = useState({ identity: null, options: [], canWriteTavern: false })
      const load = useCallback(() => {
        if (!gameId) return
        tavernUi
          .callHost(`${PLUGIN}/identity`, { gameId })
          .then((data) => setState({ identity: data.identity, options: data.options ?? [], canWriteTavern: data.canWriteTavern === true }))
          .catch(() => setState({ identity: null, options: [], canWriteTavern: false }))
      }, [gameId])
      useEffect(() => { load() }, [load])
      return { ...state, reload: load }
    }

    function IdentityBar({ tavernUi, gameId, visible = true, onChanged }) {
      const { identity, options, canWriteTavern, reload } = useIdentity(tavernUi, gameId)
      const [busy, setBusy] = useState(false)
      const [hint, setHint] = useState('')

      // 面板重新显示时重读一次：玩家可能刚在酒馆设置里改过称呼
      useEffect(() => {
        if (visible) reload()
      }, [visible, reload])

      if (!identity) return null

      const save = async (patch) => {
        setBusy(true)
        setHint('')
        try {
          const result = await tavernUi.callHost(`${PLUGIN}/set-identity`, { gameId, patch })
          if (result && result.ok === false) setHint(result.reason ?? '没改成')
          else {
            reload()
            // 称呼和主角姓名是同一个值：让档案那边也重读，人物行里 p0 的名字跟着变
            onChanged?.()
          }
        } catch (error) {
          setHint(String(error?.message || error))
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: 6, borderBottom: `1px solid ${ui.line}` } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          h('span', { style: { ...muted, fontSize: font.sm } }, '你是'),
          h('input', {
            type: 'text',
            defaultValue: identity.playerName,
            disabled: busy,
            placeholder: '玩家称呼',
            title: '酒馆「开局默认 → 基本信息 → 玩家默认称呼」里那个名字',
            onBlur: (event) => {
              const next = event.target.value.trim()
              if (next !== identity.playerName) save({ playerName: next })
            },
            style: { width: 96, fontSize: font.sm, padding: '2px 4px' },
          }),
          h('span', { style: { ...muted, fontSize: font.sm } }, '正文用'),
          h(
            'select',
            {
              value: identity.person,
              disabled: busy,
              onChange: (event) => save({ person: event.target.value }),
              style: { fontSize: font.sm, padding: '2px 4px' },
            },
            options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
          ),
          h(
            'button',
            { onClick: () => reload(), disabled: busy, title: '从酒馆重新读一次称呼', style: { ...iconBtn, fontSize: font.sm } },
            '↻',
          ),
        ),
        hint ? h('div', { style: { color: ui.danger, fontSize: font.xs } }, hint) : null,
        h(
          'div',
          { style: { ...muted, fontSize: font.xs } },
          canWriteTavern
            ? '改这里会同时改掉本局的玩家称呼（{{user}}）。'
            : '旧版酒馆读不到玩家称呼，这里是手填的备用值。',
        ),
      )
    }

    function useSettings(tavernUi, gameId) {
      const [state, setState] = useState({ loading: true, groups: null, error: null })
      useEffect(() => {
        let live = true
        if (!gameId) return
        tavernUi
          .callHost(`${PLUGIN}/settings`, { gameId })
          .then((data) => { if (live) setState({ loading: false, groups: data.groups, ui: data.ui ?? {}, error: null }) })
          .catch((error) => { if (live) setState({ loading: false, groups: null, error: String(error?.message || error) }) })
        return () => { live = false }
      }, [gameId])
      return state
    }

    // 语义色：酒馆每个主题都会往面板里灌一套 CSS 变量，写死颜色在浅色/花色主题上会糊成一片。
    // 一律写成 var(变量, 兜底值)，兜底值就是原来写死的那套灰——变量取不到时观感跟以前一模一样。
    //
    // 没抽的只有三类，都是**故意**留着的固定色：
    //   · 状态色（绿 #2e7d4f／琥珀 #b8791a 那一族）：表达"开/在场/待确认"，跟主题无关，换主题也不该变味；
    //   · 拖放的"可放/不可放"提示（#6a8 / ui.danger）和改名后的闪烁高亮（#e0a800）：是瞬时的功能信号，要跳出来；
    //   · 调试日志每种动作一个色（KIND_COLOR 里的杂色）：靠色相区分种类，本来就该多彩。
    const ui = {
      // 正文/控件上的字
      text: 'var(--SmartThemeBodyColor, rgba(90,90,105,.95))',
      // 次要说明文字
      muted: 'var(--SmartThemeQuoteColor, rgba(120,120,130,.9))',
      // 分隔线与描边（原来是 .1~.35 好几档灰，统一交给主题色）
      line: 'var(--SmartThemeBorderColor, rgba(120,120,140,.2))',
      // 浅底填充（chip、选中的标签页、表格行）
      fill: 'var(--SmartThemeBorderColor, rgba(120,120,140,.14))',
      // 更淡的底（说明块、预览框）
      soft: 'var(--SmartThemeBlurTintColor, rgba(120,120,140,.08))',
      // 危险/报错（红）
      danger: 'var(--SmartThemeEmColor, #c0392b)',
      // 强调色：只给「本轮有变化」的小圆点用。跟主题的强调色走，换主题不会变成一个突兀的色块
      accent: 'var(--SmartThemeEmColor, #c0392b)',
    }

    // 字号阶梯：**不写死像素**，一律「宿主基准字号 × 倍数」。
    // 为什么不用裸 em：em 是相对**父元素**的，父级 0.9em 里再写 0.82em 会叠乘成 0.74em，
    // 嵌套一深反而更小。这里用 `--ca-base`（面板根上由 JS 读一次宿主的实际字号，见 ArchivePanel）
    // 做基准，所有字号都是它的倍数，互不叠乘；宿主调大字号，面板跟着变。
    const font = {
      xxs: 'calc(var(--ca-base, 1em) * 0.75)',   // 最次的脚注
      xs: 'calc(var(--ca-base, 1em) * 0.82)',    // 标签、脚注
      sm: 'calc(var(--ca-base, 1em) * 0.9)',     // 正文说明
      md: 'calc(var(--ca-base, 1em) * 1)',       // 小标题
      lg: 'calc(var(--ca-base, 1em) * 1.08)',    // 正文输入框
      xl: 'calc(var(--ca-base, 1em) * 1.15)',    // 区块标题
    }

    const muted = { color: ui.muted, fontSize: font.sm }

    // 酒馆只给侧栏标签页，**不给滚动容器**——面板得自己滚，否则下面几屏永远看不到。
    // 但 `height: 100%` 靠不住（父容器没有确定高度），所以这里**实测**：
    // 量出面板顶端到窗口底部的距离，直接当高度用；窗口缩放时重量一次。
    function useFitHeight() {
      const ref = useRef(null)
      const [height, setHeight] = useState(null)
      useEffect(() => {
        const measure = () => {
          const node = ref.current
          if (!node) return
          const top = node.getBoundingClientRect().top
          setHeight(Math.max(180, Math.floor(window.innerHeight - top - 8)))
        }
        measure()
        window.addEventListener('resize', measure)
        const timer = window.setTimeout(measure, 60)   // 首帧布局稳定后再量一次
        return () => {
          window.removeEventListener('resize', measure)
          window.clearTimeout(timer)
        }
      }, [])
      return { ref, height }
    }

    const panelRoot = {
      minHeight: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
      boxSizing: 'border-box',
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      // 字体跟宿主走：不指定族名，继承酒馆的；em 字号就是相对这个继承值算的
      fontFamily: 'inherit',
    }
    // 表单控件（input/textarea/button/select）浏览器默认**不继承**字体，会退回 13.33px 系统字。
    // 用一条受控的样式盖住它们（只在这个面板的根类名下生效），让字体和字号都跟宿主。
    // 注意：不写死字号，只写 inherit —— em 阶梯才起作用。
    const FONT_STYLE_ID = 'character-archives-panel-font'
    const FONT_STYLE_TEXT = '.ca-panel input,.ca-panel textarea,.ca-panel button,.ca-panel select{font-family: inherit}'
    const chip = {
      fontSize: font.xs,
      padding: '1px 6px',
      borderRadius: 8,
      background: ui.fill,
      color: ui.text,
      whiteSpace: 'nowrap',
    }
    const iconBtn = {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      fontSize: font.md,
      lineHeight: 1,
      padding: '2px 4px',
      borderRadius: 4,
      opacity: 0.55,
    }
    const iconOn = { ...iconBtn, opacity: 1 }

    function useArchive(tavernUi, gameId) {
      const [state, setState] = useState({ loading: true, data: null, error: null })
      const reload = useCallback(() => {
        if (!gameId) return
        setState((prev) => ({ ...prev, loading: true, error: null }))
        tavernUi
          .callHost(`${PLUGIN}/archive`, { gameId })
          .then((data) => setState({ loading: false, data, error: null }))
          .catch((error) => setState({ loading: false, data: null, error: String(error?.message || error) }))
      }, [gameId])
      useEffect(() => {
        reload()
      }, [reload])
      return { ...state, reload }
    }

    function Toolbar({ tavernUi, gameId, onReload, onDeleted }) {
      const [busy, setBusy] = useState('')
      const [hint, setHint] = useState('')

      const doExport = async () => {
        setBusy('导出中…')
        setHint('')
        try {
          const bundle = await tavernUi.callHost(`${PLUGIN}/export`, { gameId })
          const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `人物档案馆-第${bundle?.archive?.turn ?? 0}轮.json`
          a.click()
          URL.revokeObjectURL(url)
          setHint('已导出')
        } catch (error) {
          setHint(`导出失败：${String(error?.message || error)}`)
        } finally {
          setBusy('')
        }
      }

      const doImport = async (file) => {
        setBusy('导入中…')
        setHint('')
        try {
          const text = await file.text()
          const bundle = JSON.parse(text)
          let result = await tavernUi.callHost(`${PLUGIN}/import`, { gameId, bundle })
          if (!result?.ok && /已经有档案/.test(String(result?.reason || ''))) {
            if (window.confirm(`${result.reason}\n\n确定要覆盖吗？`)) {
              result = await tavernUi.callHost(`${PLUGIN}/import`, { gameId, bundle, force: true })
            } else {
              setHint('已取消')
              return
            }
          }
          if (!result?.ok) {
            setHint(`导入失败：${result?.reason ?? '未知原因'}`)
            return
          }
          setHint(`已导入（${result.persons ?? 0} 人）——下一轮结算后生效`)
          onReload?.()
        } catch (error) {
          setHint(`导入失败：${String(error?.message || error)}`)
        } finally {
          setBusy('')
        }
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h(
            'button',
            { onClick: doExport, disabled: Boolean(busy), style: { ...iconBtn, opacity: 0.9, fontSize: font.sm } },
            '导出',
          ),
          h(
            'button',
            { onClick: () => onReload?.(), disabled: Boolean(busy), style: { ...iconBtn, opacity: 0.9, fontSize: font.sm }, title: '重新读一遍档案' },
            '刷新',
          ),
          h(
            'button',
            { onClick: () => onDeleted?.(), disabled: Boolean(busy), style: { ...iconBtn, opacity: 0.9 }, title: '看已删除的人物（可恢复）' },
            '已删除',
          ),
          h(
            'button',
            {
              onClick: async () => {
                const name = window.prompt('新建人物：输入称呼（没有真名就用「瞎眼的鱼贩」这种能唯一指代他的说法）')
                if (!name || !name.trim()) return
                setBusy('新建中…')
                setHint('')
                try {
                  const result = await tavernUi.callHost(`${PLUGIN}/create`, { gameId, name: name.trim() })
                  if (!result?.ok) setHint(`建不了：${result?.reason ?? '未知原因'}`)
                  else {
                    setHint('已新建（默认按「离场」处理，可点状态按钮切换）')
                    onReload?.()
                  }
                } catch (error) {
                  setHint(`建不了：${String(error?.message || error)}`)
                } finally {
                  setBusy('')
                }
              },
              disabled: Boolean(busy),
              style: { ...iconBtn, opacity: 0.9, fontSize: font.sm },
            },
            '新建人物',
          ),
          h(
            'button',
            {
              onClick: async () => {
                const label = window.prompt('新建栏目：填栏目名（如「随身物品」「口头禅」）')
                if (!label || !label.trim()) return
                setBusy('新建栏目中…')
                setHint('')
                try {
                  const result = await tavernUi.callHost(`${PLUGIN}/add-entry`, { gameId, name: label.trim() })
                  if (!result?.ok) setHint(`建不了：${result?.reason ?? '未知原因'}`)
                  else {
                    setHint(`已新建栏目「${label.trim()}」`)
                    onReload?.()
                  }
                } catch (error) {
                  setHint(`建不了：${String(error?.message || error)}`)
                } finally {
                  setBusy('')
                }
              },
              disabled: Boolean(busy),
              style: { ...iconBtn, opacity: 0.9, fontSize: font.sm },
            },
            '新建栏目',
          ),
          h(
            'label',
            { style: { ...iconBtn, opacity: 0.9, fontSize: font.sm, cursor: 'pointer' } },
            '导入',
            h('input', {
              type: 'file',
              accept: 'application/json,.json',
              style: { display: 'none' },
              onChange: (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) doImport(file)
              },
            }),
          ),
          busy ? h('span', { style: muted }, busy) : null,
        ),
        hint ? h('div', { style: muted }, hint) : null,
      )
    }

    // 一栏里条数一多，铺开就把下面几屏顶出去；先只给前 N 条，剩下的点开再看。
    const COLUMN_LIMIT = 6

    // 可折叠小标题：▸/▾ + 「标题 · N 条」。
    // 展开状态由**调用方**持有——hook 只能写在组件最前面，藏进这里就会跟着条数变，
    // React 直接抛 #300（hook 数量对不上），整个面板白屏。
    function FoldHeader({ open, title, count, onToggle }) {
      return h(
        'div',
        {
          onClick: onToggle,
          style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600, fontSize: font.sm },
          title: open ? '点我收起' : '点我展开',
        },
        h('span', { style: { ...muted, width: 10 } }, open ? '▾' : '▸'),
        h('span', null, `${title} · ${count} 条`),
      )
    }

    // 这一栏只画前 COLUMN_LIMIT 条（点开才全给）。
    function shownItems(list, expanded) {
      const all = Array.isArray(list) ? list : []
      if (expanded || all.length <= COLUMN_LIMIT) return all
      return all.slice(0, COLUMN_LIMIT)
    }

    // 「还有 N 条（点开）」/「收起」：两块共用，别各写一份。
    function MoreToggle({ total, expanded, onToggle }) {
      if (total <= COLUMN_LIMIT) return null
      return h(
        'button',
        {
          onClick: onToggle,
          style: { ...iconBtn, fontSize: font.xs, opacity: 0.9, padding: '1px 2px' },
          title: expanded ? '收起这一栏多出来的条目' : '展开这一栏剩下的条目',
        },
        expanded ? '收起' : `还有 ${total - COLUMN_LIMIT} 条（点开）`,
      )
    }

    // 眼睛图标（内联 SVG，不再用 emoji 表情）：表情符号在有些字体里会被画成大彩图、把行撑高，
    // 大小也不跟字号走。currentColor + 1em 让它和旁边的字同色同大小。
    // 两个都不含 hook：纯函数组件，跟着条数 map 出来也不会搅乱 hook 顺序。
    // 图标底板：所有操作图标共用（D8：别每个图标抄一份 width/height/viewBox）。
    // 1em + currentColor = 跟旁边的字同色同大小，玩家调大酒馆字号它也跟着大。
    const ICON_SVG = {
      width: '1em',
      height: '1em',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      style: { display: 'block' },
    }
    const EYE_SHAPE = 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z'

    /** 划掉的眼睛：这个人物对模型隐藏（不召回他，写入照常）。 */
    function EyeOffIcon() {
      return h(
        'svg',
        ICON_SVG,
        h('path', { d: EYE_SHAPE }),
        h('circle', { cx: 12, cy: 12, r: 3 }),
        h('path', { d: 'M3 3l18 18' }),
      )
    }

    /** 正常的眼睛：照常召回。 */
    function EyeIcon() {
      return h(
        'svg',
        ICON_SVG,
        h('path', { d: EYE_SHAPE }),
        h('circle', { cx: 12, cy: 12, r: 3 }),
      )
    }

    /** 垃圾桶：删这条（命题／认知／人物）。危险动作，调用处一律先 confirm。 */
    function TrashIcon() {
      return h(
        'svg',
        ICON_SVG,
        h('path', { d: 'M4 7h16' }),
        h('path', { d: 'M9 7V5h6v2' }),
        h('path', { d: 'M6 7l1 13h10l1-13' }),
      )
    }

    /** 铅笔：改名字。 */
    function PencilIcon() {
      return h(
        'svg',
        ICON_SVG,
        h('path', { d: 'M4 20h4L20 8l-4-4L4 16v4z' }),
        h('path', { d: 'M14 6l4 4' }),
      )
    }

    /** 锁：锁住的人物／条目不给模型改。开着的那只把锁梁掀起来。 */
    function LockIcon({ locked = false } = {}) {
      return h(
        'svg',
        ICON_SVG,
        h('rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }),
        h('path', { d: locked ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7-2.6' }),
      )
    }

    // 展开区：按浏览方式显示不同东西——
    //   browse='columns'    「他是什么样」：关于他的命题，按栏目列（空栏目也列）
    //   browse='cognitions'「他的认知」：他的指针，按命题的栏目分组
    function DetailBlock({ tavernUi, gameId, row, codes, onChanged, browse = 'columns' }) {
      const [busy, setBusy] = useState('')
      const [hint, setHint] = useState('')
      const [nameDraft, setNameDraft] = useState(row.name ?? '')
      const [aliasDraft, setAliasDraft] = useState(row.aliases ?? '')
      // 两块各自可折叠，默认都展开（点开一个人多半就是想看内容）。
      // 只放组件 state、不存盘：这是"看一眼就收起"的临时状态，切个标签页回来忘了也无所谓。
      const [openAbout, setOpenAbout] = useState(true)
      const [openCognitions, setOpenCognitions] = useState(true)
      // 哪几栏已经点开「还有 N 条」：按栏目码记，两块共用一个集合（码不会同时出现在两边之外）
      const [openColumns, setOpenColumns] = useState(() => new Set())

      const toggleColumn = (code) => {
        setOpenColumns((prev) => {
          const next = new Set(prev)
          if (next.has(code)) next.delete(code)
          else next.add(code)
          return next
        })
      }

      const call = async (handle, payload, label) => {
        setBusy(label)
        setHint('')
        try {
          const result = await tavernUi.callHost(`${PLUGIN}/${handle}`, { gameId, ...payload })
          if (!result?.ok) setHint(result?.reason ?? '没成功')
          else onChanged?.()
        } catch (error) {
          setHint(String(error?.message || error))
        } finally {
          setBusy('')
        }
      }

      // 姓名和别名**一起**提交：按「提交后的样子」校验，这样把旧姓名挪进别名不用绕占位符。
      const saveNames = () => {
        if (!String(nameDraft ?? '').trim()) {
          setHint('姓名不能留空：留空的人既召回不到，也写不进去。')
          return
        }
        call('set-names', { personId: row.id, name: nameDraft, aliases: aliasDraft }, '保存中…')
      }

      // 折叠标题行上的条数：收起时也能知道这块有多少东西（两块各数各的）
      const aboutCount = (row.aboutColumns ?? [])
        .reduce((total, col) => total + (col.claims?.length ?? 0), 0)
      const cognitionCount = (row.cognitionColumns ?? [])
        .reduce((total, col) => total + (col.items?.length ?? 0), 0)

      return h(
        'div',
        { style: { padding: '2px 0 8px 22px', display: 'flex', flexDirection: 'column', gap: 6 } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          h('span', { style: { ...muted, fontSize: font.sm } }, '姓名'),
          h('input', {
            value: nameDraft,
            onChange: (event) => setNameDraft(event.target.value),
            placeholder: '不能留空',
            style: { flex: '1 1 90px', minWidth: 80, fontSize: font.sm, padding: '2px 4px' },
          }),
          h('span', { style: { ...muted, fontSize: font.sm } }, '别名'),
          h('input', {
            value: aliasDraft,
            onChange: (event) => setAliasDraft(event.target.value),
            placeholder: '逗号分隔，可留空',
            title: '多个别名用逗号隔开；不许和任何人的姓名或别名重复',
            style: { flex: '2 1 140px', minWidth: 100, fontSize: font.sm, padding: '2px 4px' },
          }),
          h(
            'button',
            { onClick: saveNames, disabled: Boolean(busy), style: { ...iconBtn, fontSize: font.xs } },
            '保存',
          ),
        ),
        // 两块放在一个会换行的行里：宽了并排、窄了自动上下堆叠。
        // 侧栏只有三四百像素时并排会挤成两条缝——这里用纯 CSS（flexWrap + 每块最小 240px），
        // 不用 JS 量宽度：量宽度得监听 resize，还会抖一下。
        h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' } },
          // 「他是什么样」：**关于他的命题**，按栏目列；空栏目也列出来，玩家才知道该补哪一栏。
          // 跟下面「他的认知」不是一个视角：这里只收「说的是他」的命题。
          browse === 'columns' && row.aboutColumns?.length
            ? h(
                'div',
                { style: { flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
                h(FoldHeader, {
                  open: openAbout,
                  title: '他是什么样',
                  count: aboutCount,
                  onToggle: () => setOpenAbout((value) => !value),
                }),
                openAbout ? row.aboutColumns.map((col) => {
                  const expanded = openColumns.has(col.code)
                  return h(
                    'div',
                    {
                      key: col.code,
                      style: { display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: font.xs },
                    },
                    h(
                      'span',
                      { style: { ...muted, flex: '0 0 68px', display: 'flex', alignItems: 'center', gap: 2 } },
                      col.name,
                      h(
                        'button',
                        {
                          onClick: () => {
                            const next = window.prompt(`给「${row.name}」的「${col.name}」加一条：`, '')
                            if (!next || !next.trim()) return
                            call('add-claim', { personId: row.id, code: col.code, text: next.trim() }, '已添加')
                          },
                          disabled: Boolean(busy),
                          title: '加一条关于他的命题',
                          style: { ...iconBtn, fontSize: font.xxs, padding: '0 3px', lineHeight: '14px' },
                        },
                        '＋',
                      ),
                    ),
                    col.claims.length
                      ? h(
                          'span',
                          { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                          shownItems(col.claims, expanded).map((claim) =>
                            h(
                              'span',
                              {
                                key: claim.claimId,
                                style: { display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
                              },
                              h(
                                'span',
                                {
                                  style: { cursor: 'pointer', textDecoration: 'underline dotted' },
                                  title: '点我改这条命题的内容',
                                  onClick: () => {
                                    const next = window.prompt('改成：', claim.text)
                                    if (!next || !next.trim() || next.trim() === claim.text) return
                                    call('update-claim', { claimId: claim.claimId, text: next.trim() }, '命题已改')
                                  },
                                },
                                claim.text,
                              ),
                              // 索引词：这里当组件用（h(WordsChip, …)），它自己收着"展开/收起"——
                              // 以前是直接函数调用来着，那样 state 会算到 DetailBlock 头上，条数一变就崩
                              h(WordsChip, {
                                key: `words-${claim.claimId}`,
                                words: claim.words,
                                onSave: (raw) => call('update-claim-words', { claimId: claim.claimId, words: raw }, '索引词已改'),
                              }),
                              h(AutoWordsChip, { key: `auto-${claim.claimId}`, words: claim.autoWords }),
                              // 删这条命题：连"谁知道它"一起没。破坏面比下面那个大，所以文案要点名
                              h(
                                'button',
                                {
                                  onClick: () => {
                                    if (!window.confirm(`删掉「${claim.text}」这条命题？\n\n指向它的「谁知道」会一起删掉。`)) return
                                    call('delete-claim', { claimId: claim.claimId }, '命题已删')
                                  },
                                  disabled: Boolean(busy),
                                  title: '删除这条命题（会一起删掉谁知道它）',
                                  style: { ...iconBtn, fontSize: font.xxs, padding: '0 3px', color: ui.danger },
                                },
                                h(TrashIcon),
                              ),
                            ),
                          ),
                          h(MoreToggle, {
                            total: col.claims.length,
                            expanded,
                            onToggle: () => toggleColumn(col.code),
                          }),
                        )
                      : h('span', { style: { ...muted, fontStyle: 'italic' } }, '（空）'),
                  )
                }) : null,
              )
            : null,
          // 他的认知（指针）：按**命题的栏目**分组——「他认为周砚的职业是画师」落在「职业」下面。
          // 只列有内容的栏目：认知视角不补空。
          browse === 'cognitions' && row.cognitionColumns?.length
            ? h(
                'div',
                { style: { flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
                h(FoldHeader, {
                  open: openCognitions,
                  title: '他的认知',
                  count: cognitionCount,
                  onToggle: () => setOpenCognitions((value) => !value),
                }),
                openCognitions ? row.cognitionColumns.map((col) => {
                  const expanded = openColumns.has(col.code)
                  return h(
                    'div',
                    { key: col.code, style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                    h('div', { style: { ...muted, fontSize: font.xs, fontWeight: 600 } }, col.name),
                    shownItems(col.items, expanded).map((cog) =>
                      h(
                        'div',
                        {
                          key: cog.claimId,
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: font.xs,
                            overflowX: 'auto',
                            whiteSpace: 'nowrap',
                            paddingBottom: 2,
                          },
                        },
                        h(
                          'span',
                          {
                            style: { cursor: 'pointer', textDecoration: 'underline dotted' },
                            title: '点我改这条命题的内容',
                            onClick: () => {
                              const next = window.prompt('改成：', cog.text)
                              if (!next || !next.trim() || next.trim() === cog.text) return
                              call('update-claim', { claimId: cog.claimId, text: next.trim() }, '命题已改')
                            },
                          },
                          cog.text,
                        ),
                        cog.aboutName ? h('span', { style: muted }, `（关于${cog.aboutName}）`) : null,
                        // 索引词：默认只给一个「索引词 N」，点开才见 chip 和「✎」编辑（逗号分隔；必须是原文片段、≤10 字）
                        h(WordsChip, {
                          key: `words-${cog.claimId}`,
                          words: cog.words,
                          onSave: (raw) => call('update-claim-words', { claimId: cog.claimId, words: raw }, '索引词已改'),
                        }),
                        h(AutoWordsChip, { key: `auto-${cog.claimId}`, words: cog.autoWords }),
                        cog.groups.map((group) =>
                          h(
                            'span',
                            { key: group.index, style: { display: 'inline-flex', alignItems: 'center', gap: 3 } },
                            h(
                              'select',
                              {
                                value: String(group.state),
                                onChange: (event) =>
                                  call(
                                    'update-pointer',
                                    {
                                      personId: row.id,
                                      claimId: cog.claimId,
                                      index: group.index,
                                      state: Number(event.target.value),
                                    },
                                    '态度已改',
                                  ),
                                style: { fontSize: font.xs },
                              },
                              h('option', { value: '0' }, '真'),
                              h('option', { value: '1' }, '假'),
                              h('option', { value: '2' }, '未定'),
                            ),
                            h('input', {
                              defaultValue: group.sourceName,
                              title: '来源：自己／未知／某个已建档的人名',
                              onBlur: (event) => {
                                const next = String(event.target.value ?? '').trim()
                                if (!next || next === group.sourceName) return
                                call(
                                  'update-pointer',
                                  { personId: row.id, claimId: cog.claimId, index: group.index, source: next },
                                  '来源已改',
                                )
                              },
                              style: { width: 64, fontSize: font.xs },
                            }),
                            group.gt ? h('span', { style: muted }, group.gt) : null,
                          ),
                        ),
                        // 删这条认知：只摘"谁知道"，命题本身还留在他档案里（两栏是同一批命题的两个视角）
                        h(
                          'button',
                          {
                            onClick: () => {
                              if (!window.confirm(`删掉「${row.name}」知道「${cog.text}」这条认知？\n\n只删「谁知道」，命题本身不动。`)) return
                              call('delete-cognition', { personId: row.id, claimId: cog.claimId }, '认知已删')
                            },
                            disabled: Boolean(busy),
                            title: '删除这条认知（只删"谁知道"，不删命题本身）',
                            style: { ...iconBtn, fontSize: font.xxs, padding: '0 3px', color: ui.danger },
                          },
                          h(TrashIcon),
                        ),
                      ),
                    ),
                    h(MoreToggle, {
                      total: col.items.length,
                      expanded,
                      onToggle: () => toggleColumn(col.code),
                    }),
                  )
                }) : null,
              )
            : null,
        ),
        busy ? h('div', { style: muted }, busy) : null,
        hint ? h('div', { style: { color: ui.danger, fontSize: font.sm } }, hint) : null,
      )
    }
    // 模糊建档候选：模型拿不准的人先记在这儿；以前玩家看不见（只能翻调试）
    function DraftBlock({ tavernUi, gameId, rows, onChanged }) {
      const [open, setOpen] = useState(false)
      const [busy, setBusy] = useState(false)
      const [hint, setHint] = useState('')

      const call = async (host, payload, okText) => {
        setBusy(true)
        setHint('')
        try {
          const result = await tavernUi.callHost(`${PLUGIN}/${host}`, { gameId, ...payload })
          if (result?.ok) {
            setHint(okText ?? '已保存')
            onChanged?.()
          } else {
            setHint(result?.reason ?? '没成功')
          }
        } catch (error) {
          setHint(String(error?.message || error))
        } finally {
          setBusy(false)
        }
      }

      const add = () => {
        const name = window.prompt('加进模糊建档候选：填正文里怎么叫他的')
        if (!name || !name.trim()) return
        call('draft-add', { name: name.trim() }, '已加入候选')
      }

      const list = Array.isArray(rows) ? rows : []

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4, borderTop: `1px solid ${ui.line}`, paddingTop: 8 } },
        h(
          'div',
          {
            onClick: () => setOpen((v) => !v),
            style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontWeight: 600, fontSize: font.md },
          },
          h('span', { style: { ...muted, width: 10 } }, open ? '▾' : '▸'),
          h('span', null, '模糊建档候选'),
          h('span', { style: { ...muted, fontSize: font.xs, fontWeight: 400 } }, `${list.length} 人`),
        ),
        open
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 16 } },
              h('div', { style: { ...muted, fontSize: font.xs } }, '模型拿不准的人先记在这儿（不占档案）。等他够格了，模型会把他转成正式档案；太久没露面的会被自动清掉，你也可以现在手动删。'),
              hint ? h('div', { style: { ...muted, fontSize: font.xs } }, hint) : null,
              h('button', { onClick: add, disabled: busy, style: { ...iconBtn, fontSize: font.xs } }, '＋ 手动加一个'),
              list.length
                ? list.map((item) =>
                    h(
                      'div',
                      {
                        key: item.name,
                        draggable: true,
                        onDragStart: (event) => {
                          window.__archivesDrag = { kind: 'draft', name: item.name }
                          event.dataTransfer?.setData('text/plain', JSON.stringify({ kind: 'draft', name: item.name }))
                          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
                        },
                        onDragEnd: () => { window.__archivesDrag = null },
                        style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: font.sm, borderBottom: `1px solid ${ui.line}`, padding: '3px 0' },
                      },
                      h('span', { style: { flex: 1 } }, item.name),
                      h(
                        'span',
                        { style: { ...muted, fontSize: font.xxs } },
                        item.at === null
                          ? '轮次未知'
                          : `第 ${item.at} 轮露面${item.gap === null ? '' : `，已 ${item.gap} 轮没见`}`,
                      ),
                      h(
                        'button',
                        { onClick: () => call('draft-remove', { name: item.name }, '已移出候选'), disabled: busy, style: { ...iconBtn, fontSize: font.xs }, title: '从候选表里去掉（不影响已建档的人）' },
                        '移出',
                      ),
                    ),
                  )
                : h('div', { style: { ...muted, fontSize: font.xs } }, '候选表是空的。'),
            )
          : null,
      )
    }

    function PersonRow({ tavernUi, gameId, row, codes, onChanged, focus, browse }) {
      const [open, setOpen] = useState(false)
      const [editingName, setEditingName] = useState(false)
      const [nameDraft, setNameDraft] = useState('')
      const [flash, setFlash] = useState(false)
      // 改名／锁／眼睛／删除四个小按钮**常显**（2026-11 定）：以前收进「⋯」，
      // 玩家得先点开才看得见，等于把功能藏起来了。窄侧栏的拥挤改由「图标小、字号 xs」扛。
      const nodeRef = useRef(null)

      // 「查人物」定位到这一行：展开、滚到眼前、闪 3 秒高亮
      useEffect(() => {
        const wanted = String(focus?.personId ?? '')
        if (!wanted || wanted !== String(row.id)) return undefined
        setOpen(true)
        nodeRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
        setFlash(true)
        const timer = window.setTimeout(() => setFlash(false), 3000)
        return () => window.clearTimeout(timer)
      }, [focus?.token])

      const toggle = async (field) => {
        try {
          await tavernUi.callHost(`${PLUGIN}/toggle`, { gameId, personId: row.id, field })
          onChanged?.()
        } catch {
          /* 面板上不弹错，宿主侧有日志 */
        }
      }

      // 改姓名：**留空一律不保存**——留空的人既召回不到、也写不进去（2026-11-04 定）。
      // 只在回车／点别处时保存，避免边打字边发请求。
      const saveName = async () => {
        const next = String(nameDraft ?? '').trim()
        if (!next) {
          window.alert('姓名不能留空：留空的人既召回不到，也写不进去。')
          setNameDraft(row.name ?? '')
          setEditingName(false)
          return
        }
        if (next === row.name) {
          setEditingName(false)
          return
        }
        try {
          const result = await tavernUi.callHost(`${PLUGIN}/rename-person`, {
            gameId,
            personId: row.id,
            name: next,
          })
          if (!result?.ok) {
            window.alert(result?.reason || '改不了这个名字')
            return
          }
          setEditingName(false)
          onChanged?.()
        } catch (error) {
          window.alert('改名失败：' + String(error?.message || error))
        }
      }

      return h(
        'div',
        {
          ref: nodeRef,
          // 拖拽只挂在**标题那一行**（下个 div）：整行可拖的话，展开后在正文里想选中
          // 一段文字也会变成拖动人物，很烦人（2026-11-06 用户反馈）。
          style: {
            borderBottom: `1px solid ${ui.line}`,
            outline: flash ? '2px solid #e0a800' : 'none',
            outlineOffset: flash ? -2 : 0,
            borderRadius: 3,
          },
        },
        h(
          'div',
          {
            draggable: true,
            onDragStart: (event) => {
              window.__archivesDrag = { kind: 'person', id: row.id }
              event.dataTransfer?.setData('text/plain', JSON.stringify({ kind: 'person', id: row.id }))
              if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
            },
            onDragEnd: () => { window.__archivesDrag = null },
            style: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 2px', cursor: 'grab' },
          },
          h(
            'button',
            {
              onClick: () => setOpen((value) => !value),
              style: { ...iconBtn, fontSize: font.xs },
              title: open ? '收起' : '展开',
            },
            open ? '▾' : '▸',
          ),
          // 本轮有变化：一个主题强调色的小圆点。放在名字左边，扫一遍就能看出"这轮谁被动过"
          row.changedThisTurn
            ? h('span', {
                style: {
                  width: 6,
                  height: 6,
                  flex: '0 0 auto',
                  borderRadius: '50%',
                  background: ui.accent,
                },
                title: '本轮有变化',
              })
            : null,
          editingName
            ? h('input', {
                value: nameDraft,
                autoFocus: true,
                placeholder: '姓名不能留空',
                onChange: (event) => setNameDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                },
                onBlur: () => saveName(),
                style: { flex: 1, fontSize: font.md, padding: '2px 4px', minWidth: 80 },
              })
            : h(
                'span',
                {
                  onClick: () => setOpen((value) => !value),
                  onDoubleClick: () => {
                    setNameDraft(row.name ?? '')
                    setEditingName(true)
                  },
                  style: { flex: 1, cursor: 'pointer', fontSize: font.md, fontWeight: row.locked ? 600 : 400 },
                  title: '双击改姓名',
                },
                row.name || `${row.id}（未命名）`,
              ),
          // 主角标签：第二人称卡里主角名常常就是「你」，不加这个会被当成误建的 NPC
          row.isPlayer
            ? h(
                'span',
                {
                  style: {
                    fontSize: font.xxs,
                    padding: '0 4px',
                    borderRadius: 3,
                    background: ui.fill,
                    whiteSpace: 'nowrap',
                  },
                  title: '玩家本人（主角档 p0），不是 NPC',
                },
                '主角',
              )
            : null,
          // ★ 紧跟名字右侧（和主角徽章同一处）：它是最常点的一个，
          // 混在右边那串操作按钮里就找不着了。
          // 主角不给 ★：他本来就走"回场全量注入"、也不进冷档，标了没意义
          row.isPlayer
            ? null
            : h(
                'button',
                {
                  onClick: () => toggle('star'),
                  style: row.starred ? iconOn : iconBtn,
                  title: row.starred
                    ? '★ 重要人物：召回时拿 60% 预算份额，也不会被沉到冷档'
                    : '标成重要人物（★）',
                },
                row.starred ? '★' : '☆',
              ),
          h(
            'button',
            {
              onClick: async () => {
                const next = row.status === 1 ? '离场' : '在场'
                try {
                  await tavernUi.callHost(`${PLUGIN}/status`, { gameId, personId: row.id, status: next })
                  onChanged?.()
                } catch {
                  /* 宿主侧有日志 */
                }
              },
              style: { ...chip, border: 'none', cursor: 'pointer' },
              title: '点击切换在场／离场',
            },
            row.status === 1 ? '在场' : '离场',
          ),
            row.fuzzyLeft
              ? h(
                  'span',
                  { style: { ...chip, color: '#8a6d3b' }, title: '连续几轮没露面，程序判的离场——点左边的状态按钮就能直接拉回在场' },
                  '模糊离场',
                )
              : null,
            row.unnamed ? h('span', { style: chip, title: '没有姓名无法参与召回' }, '未命名') : null,
            // 单字名：可能召不回来（正文里「景」常是「景公子」的一部分，切词切不走）
            row.singleCharName
              ? h(
                  'span',
                  {
                    style: { ...chip, color: '#b8791a' },
                    title: '单字名：他可能召不回来——正文里这个字常是别的词的一部分。给他加个两字以上的别名就好。',
                  },
                  '单字名',
                )
              : null,
          row.cold ? h('span', { style: chip, title: '长期没动静，已沉底' }, '冷档') : null,
          // 改名／锁／眼睛／删除：**常显**（2026-11 定）。以前收进「⋯」，玩家得先点开才看得见。
          editingName
            ? null
            : h(
                'button',
                {
                  onClick: () => {
                    setNameDraft(row.name ?? '')
                    setEditingName(true)
                  },
                  style: { ...iconBtn, fontSize: font.xs },
                  title: '改姓名（不能留空，也不能和别人已有的姓名或别名重名）',
                },
                h(PencilIcon),
              ),
          h(
            'button',
            {
              onClick: () => toggle('lock'),
              style: row.locked ? iconOn : iconBtn,
              title: row.locked ? '已锁：模型不能改他的档案（召回照常）' : '未锁：模型可以改',
            },
            row.locked ? h(LockIcon, { locked: true }) : h(LockIcon, { locked: false }),
          ),
          h(
            'button',
            {
              onClick: () => toggle('hidden'),
              style: row.hidden ? iconOn : iconBtn,
              title: row.hidden ? '对模型隐藏：不召回他（写入照常）' : '正常召回：模型能看到他',
            },
            row.hidden ? h(EyeOffIcon) : h(EyeIcon),
          ),
          h(
            'button',
            {
              onClick: async () => {
                const label = row.name || (row.id + '（未命名）')
                const count = Number.isInteger(row.cognitionCount) ? row.cognitionCount : 0
                if (!window.confirm('确定把「' + label + '」移出档案？\n\n他有 ' + count + ' 条认知会一起进「已删除」，之后可以在那里恢复。')) return
                try {
                  const result = await tavernUi.callHost(`${PLUGIN}/delete-person`, { gameId, ids: [row.id] })
                  onChanged?.()
                  // 宿主说一个人都没删掉时必须说出来：以前静默无事发生，查不出原因（B2）
                  if (!result?.removed) {
                    window.alert('没有删掉任何人。宿主返回：' + JSON.stringify(result))
                  }
                } catch (error) {
                  window.alert('删除失败：' + String(error?.message || error))
                }
              },
              style: iconBtn,
              title: '移出档案（进「已删除」，可恢复）',
            },
            h(TrashIcon),
          ),
        ),
        open ? h(DetailBlock, { key: `${row.name ?? ''}|${row.aliases ?? ''}`, tavernUi, gameId, row, codes, onChanged, browse }) : null,
      )
    }

    // 档案操作条（2026-11-04 定；2026-11 合并成一个搜索入口）：
    //   · 人物＝搜到人直接定位（展开+滚过去），不碰档案；
    //   · 认知＝纯展示：完整给、不看冷却、**不盖章**、不进上下文；
    //   · 内容＝按关键词搜所有命题正文（跨人物跨栏目）；
    //   · 召回＝排进队列，下一轮正文生成前塞给正文模型（档位去设置页改，面板不再选）。
    const LEVEL_LABEL = { full: '全量', detailed: '详细', brief: '简单' }

    // 名字白名单——照抄 `lib/inputLimit.js` 的 ALLOWED_NAME_RE 与 NAME_MAX。
    // 浏览器脚本不能 import lib，两边写岔了由 tests/queryInput.test.mjs 的守卫测试比对。
    const NAME_MAX = 24
    const NAME_CHARS = /^[\u4e00-\u9fff\u3400-\u4dbfA-Za-z0-9·\- \u3000]+$/u
    const filterNameChars = (text, max = NAME_MAX) =>
      [...String(text ?? '')].filter((ch) => NAME_CHARS.test(ch)).slice(0, max).join('')

    // 自动词：程序从这条内容里分出来的词（仅展示，不可编辑、不落盘）。
    // 为什么要显示：玩家看不到它，就会以为"这人没有索引词，凭什么被召回"。
    // 为什么不可编辑：它是现算的，改了也存不住；泛词表一调整，所有老档案自动跟着变。
    function AutoWordsChip({ words }) {
      const [open, setOpen] = useState(false)
      const list = Array.isArray(words) ? words : []
      if (!list.length) return null
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 3 } },
        h(
          'button',
          {
            onClick: () => setOpen((value) => !value),
            style: { ...iconBtn, fontSize: font.xxs, padding: '0 3px', lineHeight: '14px', opacity: 0.7 },
            title: open ? '收起自动词' : '程序从这条内容里分出来的词（只用于召回，不能编辑）',
          },
          `自动词 ${list.length}`,
        ),
        open ? list.map((word) =>
          h(
            'span',
            {
              key: String(word),
              style: { ...chip, opacity: 0.65, borderStyle: 'dashed' },
              title: '程序自动分词（只用于召回打分，不存盘、不进跨局词库）',
            },
            String(word),
          ),
        ) : null,
      )
    }

    // 索引词标签：默认收起——一条命题后面铺开三四个小标签，值行就被挤到换行了，
    // 而多数时候玩家只是扫一眼内容、不关心索引词。
    // 有词才给一个「索引词 N」开关；没词就直接给「✎」，不然新命题永远加不上索引词。
    // onSave(原始文本) 由外层发请求——这里只管显示和收集输入。
    function WordsChip({ words, onSave }) {
      const [open, setOpen] = useState(false)
      const list = Array.isArray(words) ? words : []
      const edit = () => {
        const next = window.prompt(
          '索引词（逗号或顿号分隔；必须是这条内容的原文片段，每个 ≤10 字）：',
          list.map((one) => one.词 ?? one).join(','),
        )
        if (next === null) return
        onSave?.(next)
      }
      const editButton = h(
        'button',
        {
          onClick: edit,
          style: { ...iconBtn, fontSize: font.xxs, padding: '0 3px', lineHeight: '14px' },
          title: '编辑这条命题的索引词',
        },
        '✎',
      )
      if (!list.length) return editButton
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 3 } },
        h(
          'button',
          {
            onClick: () => setOpen((value) => !value),
            style: { ...iconBtn, fontSize: font.xxs, padding: '0 3px', lineHeight: '14px', opacity: 0.9 },
            title: open ? '收起索引词' : '展开索引词（点开才能编辑）',
          },
          `索引词 ${list.length}`,
        ),
        open ? list.map((one) =>
          h(
            'span',
            {
              key: one.词 ?? String(one),
              style: chip,
              title: `索引词（${one.类 ?? '未分类'}）`,
            },
            `${one.词 ?? one}`,
          ),
        ) : null,
        open ? editButton : null,
      )
    }

    // 查询条：一个输入框 + 一个类型选择 + 一个「搜索」。
    // 原来并排四个按钮（查认知／查人物／召回／搜内容），前三个都是"按这个名字查什么"，
    // 玩家每回都得先想"我这次要按哪个"。改成先选类型再搜；
    // 「召回」是**注入动作**（会改下一轮正文），不是查询，所以单独留在右边并用 title 说清。
    function QueryBox({ tavernUi, gameId, onFocusPerson }) {
      const [name, setName] = useState('')
      // 'person' 定位到人 | 'cognition' 看这个人的全部认知 | 'claims' 按关键词搜命题正文
      const [queryKind, setQueryKind] = useState('person')
      const [text, setText] = useState('')
      const [hint, setHint] = useState('')
      const [busy, setBusy] = useState('')

      // 条目值搜索（M4-11）：关键词在所有命题内容里字面匹配，跨人物跨栏目
      const [searchResults, setSearchResults] = useState(null)

      const submit = async () => {
        const wanted = String(name ?? '').trim()
        if (!wanted) {
          setHint(queryKind === 'claims' ? '先输入要找的词' : '先填个人名')
          return
        }
        setBusy(queryKind)
        setHint('')
        setText('')
        try {
          if (queryKind === 'cognition') {
            const result = await tavernUi.callHost(`${PLUGIN}/lookup-person`, { gameId, name: wanted })
            setText(result?.ok ? result.text : (result?.reason ?? '查不到'))
          } else if (queryKind === 'claims') {
            const result = await tavernUi.callHost(`${PLUGIN}/search-claims`, { gameId, keyword: wanted })
            if (result?.ok) setSearchResults({ keyword: wanted, list: result.results ?? [] })
            else setHint(result?.reason ?? '搜不到')
          } else {
            const result = await tavernUi.callHost(`${PLUGIN}/find-person`, { gameId, name: wanted })
            if (result?.ok) {
              onFocusPerson?.(result.personId)
              setHint(`已定位：${result.name}`)
            } else {
              setHint(result?.reason ?? '找不到')
            }
          }
        } catch (error) {
          setHint(String(error?.message || error))
        } finally {
          setBusy('')
        }
      }

      // 召回不是搜索：它会往下一轮正文里塞内容，所以单独立一个按钮，入口不跟着类型变
      const recall = async () => {
        const wanted = String(name ?? '').trim()
        if (!wanted) {
          setHint('先填个人名')
          return
        }
        setBusy('recall')
        setHint('')
        try {
          const result = await tavernUi.callHost(`${PLUGIN}/recall-person`, { gameId, name: wanted })
          setHint(
            result?.ok
              ? `已排队：「${result.name}」会在下一轮正文生成前塞给正文模型（${LEVEL_LABEL[result.level] ?? result.level}档）`
              : (result?.reason ?? '排不上'),
          )
        } catch (error) {
          setHint(String(error?.message || error))
        } finally {
          setBusy('')
        }
      }

      // 类型选择：分段按钮，选中的那个加深；title 里写清这一档到底查什么
      const segment = (key, label, note) =>
        h(
          'button',
          {
            onClick: () => setQueryKind(key),
            title: note,
            style: {
              border: 'none',
              cursor: 'pointer',
              padding: '2px 8px',
              borderRadius: 9,
              fontSize: font.xs,
              background: queryKind === key ? ui.fill : 'transparent',
              color: queryKind === key ? ui.text : ui.muted,
              fontWeight: queryKind === key ? 600 : 400,
            },
          },
          label,
        )

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          h('input', {
            value: name,
            onChange: (event) => {
              const raw = event.target.value
              const clean = filterNameChars(raw)
              setName(clean)
              // 被剔字时给一句：不然玩家会以为键盘坏了
              if (clean !== raw) setHint(`名字里不能用括号、逗号或顿号（也不能超 ${NAME_MAX} 字），已经去掉了`)
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') submit()
            },
            placeholder: queryKind === 'claims' ? '要搜的关键词' : '姓名或别名',
            style: { flex: 1, fontSize: font.sm },
          }),
          h(
            'div',
            { style: { display: 'flex', gap: 2, alignItems: 'center' } },
            segment('person', '人物', '按名字定位到人：滚动过去、展开他所在的那一组，不改档案'),
            segment('cognition', '认知', '按名字列出这个人全部认知（纯展示，不进正文）'),
            segment('claims', '内容', '按关键词搜所有命题正文（跨人物跨栏目）'),
          ),
          h(
            'button',
            { onClick: submit, disabled: Boolean(busy), style: { ...iconBtn, fontSize: font.xs } },
            busy === queryKind ? '…' : '搜索',
          ),
          h(
            'button',
            {
              onClick: recall,
              disabled: Boolean(busy),
              style: { ...iconBtn, fontSize: font.xs },
              title: '召回：把这个人塞进下一轮正文——下一轮生成前交给正文模型看一眼（不是搜索，会改正文）',
            },
            busy === 'recall' ? '…' : '召回',
          ),
        ),
        hint ? h('div', { style: { ...muted, fontSize: font.xs } }, hint) : null,
        searchResults
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 2, border: `1px solid ${ui.line}`, borderRadius: 8, padding: 6 } },
              h(
                'div',
                { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                h('span', { style: { ...muted, fontSize: font.xs } }, `搜「${searchResults.keyword}」命中 ${searchResults.list.length} 条`),
                h('button', { onClick: () => setSearchResults(null), style: { ...iconBtn, fontSize: font.xs } }, '收起'),
              ),
              searchResults.list.length === 0
                ? h('div', { style: { ...muted, fontSize: font.xs } }, '没有命中的命题')
                : searchResults.list.map((item) =>
                    h(
                      'div',
                      {
                        key: item.claimId,
                        onClick: () => onFocusPerson?.(item.personId),
                        style: { fontSize: font.xs, padding: '3px 4px', borderBottom: `1px solid ${ui.line}`, cursor: 'pointer' },
                        title: '点击跳到这个人',
                      },
                      `${item.personName} · ${item.columnName}：${item.text}`,
                    ),
                  ),
            )
          : null,
        text ? h('pre', { style: { fontSize: font.xs, whiteSpace: 'pre-wrap', margin: 0, ...muted } }, text) : null,
      )
    }

    // 分组：**拖放的目标容器**。拖进来的规则由父组件 onDropItem 决定：
    // 在场／离场＝改状态；冷档＝手动沉底；模糊建档与模糊离场**不收任何东西**。
    function Group({ title, kind, rows, tavernUi, gameId, codes, onChanged, defaultOpen, onDropItem, focus, browse }) {
      const [open, setOpen] = useState(Boolean(defaultOpen))
      const [over, setOver] = useState('')   // '' 无 | 'ok' 绿 | 'no' 红

      // 「查人物」定位到本组里的人：自动展开这一组（token 变了才动，玩家仍能自己收起）
      useEffect(() => {
        const wanted = String(focus?.personId ?? '')
        if (!wanted) return
        if (!rows.some((row) => String(row.id) === wanted)) return
        setOpen(true)
      }, [focus?.token])

      // 拖放规则（用户定）：在场/离场/冷档 三个位置收东西；
      // **模糊建档与模糊离场互不接收**（fuzzyOffline 这里直接拒，draft 是另一个组件）。
      const applyDrop = async (target, item) => {
        if (!item) return
        if (target === 'fuzzyOffline') return                 // 模糊离场不收
        try {
          if (item.kind === 'draft') {
            // 模糊建档的候选名字 → 建档后落到目标组
            const status = target === 'present' ? '在场' : '离场'
            const created = await tavernUi.callHost(`${PLUGIN}/create`, { gameId, name: item.name, status })
            if (created?.ok && target === 'cold') {
              await tavernUi.callHost(`${PLUGIN}/mark-cold`, { gameId, personId: created.id, cold: true })
            }
          } else if (target === 'cold') {
            await tavernUi.callHost(`${PLUGIN}/mark-cold`, { gameId, personId: item.id, cold: true })
          } else {
            await tavernUi.callHost(`${PLUGIN}/status`, {
              gameId,
              personId: item.id,
              status: target === 'present' ? '在场' : '离场',
            })
            // 从冷档拖出来：撤掉手动冷档标记
            await tavernUi.callHost(`${PLUGIN}/mark-cold`, { gameId, personId: item.id, cold: false })
          }
          onChanged?.()
        } catch (error) {
          window.alert('拖动没生效：' + String(error?.message || error))
        }
      }
      // 本轮有变化的人数：一眼知道该往哪组看（0 处就不说，免得每组标题都挂一句废话）
      const changedCount = rows.filter((row) => row.changedThisTurn).length
      return h(
        'div',
        {
          onDragOver: (event) => {
            const src = window.__archivesDrag
            if (!src) return
            // 模糊离场**不收任何东西**：亮红框，且**不 preventDefault**——
            // 浏览器会直接显示"禁止"光标，也不会触发 drop（以前只是不处理，框还是绿的）。
            if (kind === 'fuzzyOffline') {
              setOver('no')
              return
            }
            event.preventDefault()
            setOver('ok')
          },
          onDragLeave: () => setOver(''),
          onDrop: (event) => {
            event.preventDefault()
            setOver('')
            const src = window.__archivesDrag
            window.__archivesDrag = null
            if (!src || kind === 'fuzzyOffline') return
            void applyDrop(kind, src)
          },
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            // 拖放的两种瞬时提示：能放＝绿，不能放＝红（走 ui.danger，主题里也能看清）
            outline: over === 'ok' ? '2px dashed #6a8' : over === 'no' ? `2px dashed ${ui.danger}` : 'none',
            borderRadius: 4,
          },
        },
        h(
          'button',
          {
            onClick: () => setOpen((value) => !value),
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              fontWeight: 600,
              fontSize: font.md,
            },
          },
          h('span', { style: { fontSize: font.xs } }, open ? '▾' : '▸'),
          // 人数直接写在标题上：收起时也知道这组几个人（「在场 · 7」）
          h('span', null, `${title} · ${rows.length}`),
          changedCount
            ? h(
                'span',
                { style: { ...muted, fontSize: font.xs, fontWeight: 400 } },
                `本轮 ${changedCount} 处变化`,
              )
            : null,
        ),
        open
          ? rows.length
            ? rows.map((row) =>
                h(PersonRow, { key: row.id, tavernUi, gameId, row, codes, onChanged, focus, browse }),
              )
            : h('div', { style: { ...muted, paddingLeft: 18 } }, '（空）')
          : null,
      )
    }

    /**
     * 数值输入的字符限制 + 上下限夹紧（浏览器侧）。
     *
     * ⚠️ 这份规则必须和 `plugin/lib/settingsView.js` 的 `parseNumberInput` 一致——
     * 浏览器脚本不能 import lib，只能各留一份。守卫测试会比对两边的正则字面量。
     *
     * 为什么不用 `<input type="number">`：浏览器允许键入 e / + / - / .，清空后
     * value 是空串，而 `Number('')` 是 0——清空一次就把设置改成了 0。
     */
    function parseNumberInput(raw, { min, max } = {}) {
      const text = String(raw ?? '').trim()
      if (!text) return { ok: false, reason: '不能为空' }
      if (!/^-?\d+(?:\.\d+)?$/u.test(text)) return { ok: false, reason: '只能填数字' }
      const num = Number(text)
      if (!Number.isFinite(num)) return { ok: false, reason: '数字超出范围' }
      const rounded = Math.round(num)
      const low = Number.isFinite(min) ? min : -Infinity
      const high = Number.isFinite(max) ? max : Infinity
      return { ok: true, value: Math.min(high, Math.max(low, rounded)) }
    }

    function SettingRow({ tavernUi, gameId, item, onSaved }) {
      const [busy, setBusy] = useState(false)
      const changed = JSON.stringify(item.value) !== JSON.stringify(item.default)

      const save = async (value) => {
        setBusy(true)
        try {
          const result = await tavernUi.callHost(`${PLUGIN}/set-settings`, {
            gameId,
            patch: { [item.path]: value },
          })
          if (result?.ok) onSaved?.(result.groups)
        } catch {
          /* 宿主侧有日志 */
        } finally {
          setBusy(false)
        }
      }

      let control = null
      if (item.type === 'switch') {
        control = h(
          'button',
          {
            onClick: () => save(!item.value),
            disabled: busy,
            style: {
              ...chip,
              border: 'none',
              cursor: 'pointer',
              minWidth: 44,
              background: item.value ? 'rgba(60,160,90,.18)' : ui.fill,
              color: item.value ? '#2e7d4f' : ui.text,
            },
          },
          item.value ? '开' : '关',
        )
      } else if (item.type === 'number') {
        // 用 text + inputMode 而不是 type=number：number 拦不住 e/+/-/.，清空后 value 是空串，
        // 而 Number('') 是 0——清空一次就把设置改成了 0。
        const commit = (event) => {
          const parsed = parseNumberInput(event.target.value, { min: item.min, max: item.max })
          if (!parsed.ok) {
            event.target.value = String(item.value)   // 不合法就恢复原值，不静默吞掉
            return
          }
          event.target.value = String(parsed.value)   // 立刻回显夹紧后的数，别让玩家以为填进去了
          if (parsed.value !== item.value) save(parsed.value)
        }
        control = h('input', {
          type: 'text',
          inputMode: 'numeric',
          defaultValue: item.value,
          disabled: busy,
          onInput: (event) => {
            // 字符限制：只留数字和小数点（下限是负数时才留负号）
            const allowMinus = Number.isFinite(item.min) && item.min < 0
            const cleaned = String(event.target.value).replace(allowMinus ? /[^\d.-]/gu : /[^\d.]/gu, '')
            if (cleaned !== event.target.value) event.target.value = cleaned
          },
          onBlur: commit,
          onKeyDown: (event) => {
            if (event.key === 'Enter') commit(event)
          },
          style: { width: 72, fontSize: font.sm, padding: '2px 4px' },
        })
      } else if (item.type === 'select') {
        control = h(
          'select',
          {
            value: item.value,
            disabled: busy,
            onChange: (event) => save(event.target.value),
            style: { fontSize: font.sm, padding: '2px 4px' },
          },
          (item.options ?? []).map((option) => h('option', { key: option.value, value: option.value }, option.label)),
        )
      } else if (item.type === 'codes') {
        // 多选：每个条目码一个按钮，存成数组
        const picked = new Set(Array.isArray(item.value) ? item.value.map(String) : [])
        const all = Array.isArray(item.codes) ? item.codes : []
        control = h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
          all.map((entry) =>
            h(
              'button',
              {
                onClick: () => {
                  const next = new Set(picked)
                  if (next.has(entry.code)) next.delete(entry.code)
                  else next.add(entry.code)
                  save([...next])
                },
                disabled: busy,
                style: {
                  ...chip,
                  border: 'none',
                  cursor: 'pointer',
                  background: picked.has(entry.code) ? 'rgba(46,125,79,.85)' : ui.fill,
                  color: picked.has(entry.code) ? '#fff' : ui.text,
                  fontWeight: picked.has(entry.code) ? 600 : 400,
                },
              },
              (picked.has(entry.code) ? '✓ ' : '') + (entry.name ?? entry.code),
            ),
          ),
        )
      } else {
        // text / list：都是输入框；list 用逗号连接，保存时宿主侧再拆开
        const shown = Array.isArray(item.value) ? item.value.join(', ') : (item.value ?? '')
        control = h('input', {
          type: 'text',
          defaultValue: shown,
          disabled: busy,
          placeholder: item.type === 'list' ? '用逗号分隔' : '',
          onBlur: (event) => {
            const next = event.target.value
            const before = Array.isArray(item.value) ? item.value.join(', ') : (item.value ?? '')
            if (next !== before) save(next)
          },
          style: { width: 150, fontSize: font.sm, padding: '2px 4px' },
        })
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 2, padding: '5px 0' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { flex: 1, fontSize: font.md } }, item.label),
          changed ? h('span', { style: { ...chip, background: 'rgba(220,160,40,.18)', color: '#9a6b00' } }, '已改') : null,
          control,
        ),
        h('div', { style: { ...muted, fontSize: font.xs } }, item.hint),
      )
    }

    function SettingsView({ tavernUi, gameId, onChanged }) {
      // 注意：这里的 ui 是「界面偏好」对象，跟文件顶部的语义色常量 ui 同名。
      // 语义色在下面这些组件里要用，所以把偏好改名成 uiPrefs，别让两者互相遮挡。
      const { loading, groups, error, ui: uiPrefs } = useSettings(tavernUi, gameId)
      const [live, setLive] = useState(null)
      // 三段默认：插件级展开，卡级和会话级收起（别一打开就铺满屏）
      // 折叠状态存在插件数据里（插件级），刷新后保持
      const [openSections, setOpenSections] = useState({ global: true, card: false, game: false })
      const [sectionsReady, setSectionsReady] = useState(false)
      // 第一次拿到 ui 时套用（之后玩家点过就以玩家为准）
      useEffect(() => {
        if (sectionsReady) return
        // **还没拿到就等**：ui 初始是 undefined，等宿主返回再套用；
        // 否则一挂载就把"已就绪"打上，数据到了也不会应用
        if (uiPrefs === undefined) return
        const saved = uiPrefs?.settingsSections
        if (saved && typeof saved === "object") {
          setOpenSections({ global: saved.global !== false, card: saved.card === true, game: saved.game === true })
        }
        setSectionsReady(true)
      }, [uiPrefs, sectionsReady])

      const toggleSection = (scope) => {
        setOpenSections((prev) => {
          const next = { ...prev, [scope]: !prev[scope] }
          // 存起来（插件级 UI 偏好），失败不影响界面
          tavernUi.callHost(`${PLUGIN}/set-ui`, { ui: { settingsSections: next } }).catch(() => {})
          return next
        })
      }

      // 组内手风琴：九组全平铺有 40 多项，一屏翻不到底。
      // 默认只开最常动的两组，其余收起——玩家要找的多半就在这两组里。
      // 只放组件 state（不存盘）：这是"看一眼就收起"的临时展开状态，切个标签页回来忘了也无所谓。
      const DEFAULT_OPEN_GROUPS = ['档案写入方式', '召回']
      const [openGroups, setOpenGroups] = useState(() => new Set(DEFAULT_OPEN_GROUPS))
      const toggleGroup = (title) => {
        setOpenGroups((prev) => {
          const next = new Set(prev)
          if (next.has(title)) next.delete(title)
          else next.add(title)
          return next
        })
      }

      if (error) return h('div', { style: { color: ui.danger, fontSize: font.sm } }, `读取失败：${error}`)
      if (loading && !groups) return h('div', { style: muted }, '读取中…')

      const list = live ?? groups ?? []

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        list.map((section) =>
          h(
            'div',
            { key: section.scope, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            // 段标题：点一下整段收起／展开
            h(
              'div',
              {
                onClick: () => toggleSection(section.scope),
                style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontWeight: 600, fontSize: font.md },
              },
              h('span', { style: { ...muted, width: 10 } }, openSections[section.scope] ? '▾' : '▸'),
              h('span', null, section.title),
              h('span', { style: { ...muted, fontSize: font.xs, fontWeight: 400 } }, `${section.groups.length} 组`),
            ),
            openSections[section.scope]
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 16 } },
                  section.hint ? h('div', { style: { ...muted, fontSize: font.xs } }, section.hint) : null,
                  section.groups.map((group) => {
                    const isOpen = openGroups.has(group.title)
                    return h(
                      'div',
                      { key: group.title, style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                      // 组标题：点一下只收起这一组，别的组不受影响
                      h(
                        'div',
                        {
                          onClick: () => toggleGroup(group.title),
                          style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontWeight: 600, fontSize: font.sm },
                        },
                        h('span', { style: { ...muted, width: 10 } }, isOpen ? '▾' : '▸'),
                        h('span', null, group.title),
                        // 收起时也给个"这儿有几项"的量，省得玩家为了找一项把每组都点一遍
                        h('span', { style: { ...muted, fontSize: font.xs, fontWeight: 400 } }, `${group.items.length} 项`),
                      ),
                      isOpen
                        ? h(
                            'div',
                            { style: { display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 16 } },
                            group.hint ? h('div', { style: { ...muted, fontSize: font.xs } }, group.hint) : null,
                            group.items.map((item) =>
                              h(SettingRow, {
                                key: item.path,
                                tavernUi,
                                gameId,
                                item,
                                onSaved: (groups) => {
                                  setLive(groups)
                                  // 设置存完立刻让外层重读：显示类设置当场生效，不用等下一轮
                                  onChanged?.()
                                },
                              }),
                            ),
                          )
                        : null,
                    )
                  }),
                )
              : null,
          ),
        ),
      )
    }

    // 动作类型 → 颜色（和 index.mjs 里的 DEBUG_KINDS 对应）
    const KIND_COLOR = {
      settle: '#4a6fa5',
      mvu: '#2f8f8f',
      judge: '#7b5ea7',
      write: '#2e7d4f',
      reject: '#b8791a',
      error: ui.danger,
      other: ui.text,
    }

    // 一轮一个折叠组：默认只开最新的一轮
    function TurnGroup({ turn, items, defaultOpen }) {
      const [open, setOpen] = useState(Boolean(defaultOpen))
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 6 } },
        h(
          'div',
          {
            onClick: () => setOpen((v) => !v),
            style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontWeight: 600, fontSize: font.sm, padding: '2px 0' },
          },
          h('span', { style: { ...muted, width: 10 } }, open ? '▾' : '▸'),
          h('span', null, turn === null ? '旧版日志（没有轮次）' : '第 ' + turn + ' 轮'),
          h('span', { style: { ...muted, fontSize: font.xs } }, items.length + ' 条'),
        ),
        open ? items.map((item, index) => h(DebugRow, { key: index, item })) : null,
      )
    }

    // 一条调试日志：默认**只显示一行**，点了才展开原始数据（数据往往很长）。
    function DebugRow({ item }) {
      const [open, setOpen] = useState(false)
      const hasData = item.data !== undefined && item.data !== null
      return h(
        'div',
        { style: { fontSize: font.xs, lineHeight: 1.5, borderBottom: `1px solid ${ui.line}`, paddingBottom: 4 } },
        h(
          'div',
          {
            onClick: hasData ? () => setOpen((v) => !v) : undefined,
            style: { display: 'flex', gap: 4, alignItems: 'baseline', cursor: hasData ? 'pointer' : 'default' },
          },
          hasData ? h('span', { style: { ...muted, width: 10 } }, open ? '▾' : '▸') : h('span', { style: { width: 10 } }),
          h('span', { style: { color: KIND_COLOR[item.kind] ?? KIND_COLOR.other, fontWeight: 600 } }, `[${item.kind ?? item.level}]`),
          h('span', { style: muted }, String(item.at).slice(11, 19)),
          h('span', { style: { flex: 1 } }, item.message),
        ),
        open && hasData
          ? h('pre', { style: { margin: '2px 0 0 14px', fontSize: font.xxs, whiteSpace: 'pre-wrap', opacity: 0.8 } }, JSON.stringify(item.data, null, 1))
          : null,
      )
    }

    // 已删除名单：可恢复、可单独永久删除、可勾选批量
    function DeletedView({ tavernUi, gameId, onBack, onChanged }) {
      const [state, setState] = useState({ loading: true, people: [], error: null })
      const [picked, setPicked] = useState(new Set())

      const load = useCallback(() => {
        if (!gameId) return
        setState((prev) => ({ ...prev, loading: true }))
        tavernUi
          .callHost(`${PLUGIN}/deleted-list`, { gameId })
          .then((data) => setState({ loading: false, people: data?.people ?? [], error: null }))
          .catch((error) => setState({ loading: false, people: [], error: String(error?.message || error) }))
      }, [gameId])
      useEffect(() => { load() }, [load])

      const togglePick = (id) => {
        setPicked((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      const act = async (host, ids) => {
        if (!ids.length) return
        try {
          await tavernUi.callHost(`${PLUGIN}/${host}`, { gameId, ids })
          setPicked(new Set())
          load()
          onChanged?.()
        } catch (error) {
          window.alert(`${host} 失败：${String(error?.message || error)}`)
        }
      }

      const allPicked = state.people.length > 0 && picked.size === state.people.length

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
          h('button', { onClick: onBack, style: { ...iconBtn, fontSize: font.sm } }, '← 回档案'),
          h('span', { style: { fontWeight: 600, fontSize: font.md } }, `已删除 ${state.people.length} 人`),
          h('button', {
            onClick: () => setPicked(allPicked ? new Set() : new Set(state.people.map((item) => item.id))),
            style: { ...iconBtn, fontSize: font.sm },
          }, allPicked ? '取消全选' : '全选'),
          h('button', {
            onClick: () => act('restore-person', [...picked]),
            disabled: !picked.size,
            style: { ...iconBtn, fontSize: font.sm, opacity: picked.size ? 1 : 0.45 },
          }, `恢复选中（${picked.size}）`),
          h('button', {
            onClick: () => {
              if (!picked.size) return
              if (!window.confirm(`永久删除选中的 ${picked.size} 人？这一步不可撤销。`)) return
              act('purge-deleted', [...picked])
            },
            disabled: !picked.size,
            style: { ...iconBtn, fontSize: font.sm, opacity: picked.size ? 1 : 0.45, color: ui.danger },
          }, '永久删除选中'),
        ),
        state.error ? h('div', { style: { color: ui.danger, fontSize: font.sm } }, `读取失败：${state.error}`) : null,
        state.loading
          ? h('div', { style: muted }, '读取中…')
          : state.people.length
            ? state.people.map((item) =>
                h(
                  'div',
                  {
                    key: item.id,
                    style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: font.sm, borderBottom: `1px solid ${ui.line}`, padding: '4px 2px' },
                  },
                  h('input', {
                    type: 'checkbox',
                    checked: picked.has(item.id),
                    onChange: () => togglePick(item.id),
                  }),
                  h('span', { style: { flex: 1 } }, item.name || `${item.id}（未命名）`),
                  h('span', { style: muted }, `${(item.entries ?? []).length} 条 · 第 ${item.turn} 轮删的`),
                  h('button', { onClick: () => act('restore-person', [item.id]), style: { ...iconBtn, fontSize: font.xs } }, '恢复'),
                  h('button', {
                    onClick: () => {
                      if (!window.confirm(`永久删除「${item.name || item.id}」？不可撤销。`)) return
                      act('purge-deleted', [item.id])
                    },
                    style: { ...iconBtn, fontSize: font.xs, color: ui.danger },
                  }, '永久删除'),
                ),
              )
            : h('div', { style: muted }, '没有已删除的人物。'),
      )
    }

    // 设置页里的「调试」折叠区：默认收起，点标题才展开日志
    function DebugSection({ tavernUi, gameId }) {
      const [open, setOpen] = useState(false)
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 4, borderTop: `1px solid ${ui.line}`, paddingTop: 8 } },
        h(
          'div',
          {
            onClick: () => setOpen((v) => !v),
            style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontWeight: 600, fontSize: font.md },
          },
          h('span', { style: { ...muted, width: 10 } }, open ? '▾' : '▸'),
          h('span', null, '调试'),
          h('span', { style: { ...muted, fontSize: font.xs, fontWeight: 400 } }, open ? '' : '（点开看最近几轮的日志与报错）'),
        ),
        open ? h(DebugView, { tavernUi, gameId }) : null,
      )
    }

    // 数据位置：列出各个存储目录，点一下用资源管理器打开
    function DataLocations({ tavernUi, gameId }) {
      const [state, setState] = useState({ loading: true, list: [], error: null, hint: '', trashCount: 0 })
      const [emptying, setEmptying] = useState(false)

      // 宿主给的 label 是写给我们自己看的（"插件自持数据（快照／整局数据／已删除／回收站）"），
      // 玩家看了只会更糊。这里按 key 换成大白话；宿主以后加了新 key 就退回它自己的 label。
      const LOCATION_TEXT = {
        store: { label: '插件自己的文件夹', note: '人物档案本体都在这儿；预设表在「全局设置」那个文件里' },
        snapshots: { label: '历史存档（回退时用）', note: '回退到某一轮时，读的就是这一轮那份' },
        games: { label: '本局的运行记录', note: '这局的运行状态；预设表在「全局设置」那个文件里' },
        deleted: { label: '已删除名单', note: '删掉的人记在这儿（模型不会重建他们）' },
        trash: { label: '废文件（自动清）', note: '删存档、剪枝掉的旧数据先挪到这儿，不硬删' },
        pluginData: { label: '全局设置（跨存档共用）', note: '所有存档共用一份；上限 256 KB' },
      }

      const load = useCallback(() => {
        setState((prev) => ({ ...prev, loading: true }))
        tavernUi
          .callHost(`${PLUGIN}/data-locations`, { gameId })
          .then((data) => setState({ loading: false, list: data?.locations ?? [], error: null, hint: '', trashCount: data?.trashCount ?? 0 }))
          .catch((error) => setState({ loading: false, list: [], error: String(error?.message || error), hint: '', trashCount: 0 }))
      }, [gameId])
      useEffect(() => { load() }, [load])

      const open = async (key) => {
        try {
          await tavernUi.callHost(`${PLUGIN}/open-folder`, { target: key })
          setState((prev) => ({ ...prev, hint: '已打开' }))
        } catch (error) {
          setState((prev) => ({ ...prev, hint: `打不开：${String(error?.message || error)}` }))
        }
      }

      // 立即清空废文件：里面都是剪枝/回退/删局挪进来的死数据，真删（P22③）。
      // 这是**不可恢复**的操作，先问一句——点错一次，那些旧轮次就真没了。
      const emptyTrash = async () => {
        const confirmed = window.confirm(
          `清空废文件？\n\n现在有 ${state.trashCount} 个文件。它们都是死数据（剪枝、回退、删存档时挪过来的旧副本），`
          + '平时已经用不到；删了不能恢复，也不会进回收站。',
        )
        if (!confirmed) return
        setEmptying(true)
        try {
          const result = await tavernUi.callHost(`${PLUGIN}/empty-trash`, {})
          setState((prev) => ({
            ...prev,
            trashCount: 0,
            hint: result?.removed > 0
              ? `已清空废文件（删 ${result.removed} 个，释放约 ${Math.max(1, Math.round((result.freedBytes ?? 0) / 1024))} KB）`
              : '废文件箱已经是空的',
          }))
        } catch (error) {
          setState((prev) => ({ ...prev, hint: `清理失败：${String(error?.message || error)}` }))
        } finally {
          setEmptying(false)
        }
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('div', { style: { fontWeight: 600, fontSize: font.md } }, '数据位置'),
        h('div', { style: { ...muted, fontSize: font.xs } }, '点右边「打开」直接用资源管理器打开这个文件夹。'),
        state.error ? h('div', { style: { color: ui.danger, fontSize: font.sm } }, `读取失败：${state.error}`) : null,
        h(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: font.xs } },
          h('span', { style: { ...muted } }, `废文件箱里现在有 ${state.trashCount} 个（超过设置天数后结算时自动清）`),
          h(
            'button',
            {
              onClick: emptyTrash,
              disabled: emptying || state.trashCount === 0,
              style: { ...iconBtn, fontSize: font.xs, opacity: state.trashCount === 0 ? 0.4 : 1 },
              title: '马上清空废文件箱（删了不能恢复）',
            },
            emptying ? '清理中…' : '立即清理',
          ),
        ),
        state.hint ? h('div', { style: { ...muted, fontSize: font.xs } }, state.hint) : null,
        state.list.map((item) => {
          const text = LOCATION_TEXT[item.key] ?? {}
          return h(
            'div',
            {
              key: item.key,
              style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: font.xs, borderBottom: `1px solid ${ui.line}`, padding: '4px 0' },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', null, text.label ?? item.label),
              h('div', { style: { ...muted, fontSize: font.xxs, wordBreak: 'break-all' } }, item.path),
              h('div', { style: { ...muted, fontSize: font.xxs } }, text.note ?? item.note ?? ''),
            ),
            h(
              'button',
              {
                onClick: () => open(item.key),
                disabled: !item.exists,
                style: { ...iconBtn, fontSize: font.xs, opacity: item.exists ? 1 : 0.4 },
                title: item.exists ? '用资源管理器打开' : '这个位置还不存在',
              },
              '打开',
            ),
          )
        }),
      )
    }

    // 预设表：条目定义（名字/描述/勾选/唯一值）+ MVU 字段映射
    function PresetView({ tavernUi, gameId }) {
      const [state, setState] = useState({ loading: true, data: null, error: null, hint: '' })
      const [edits, setEdits] = useState({})

      const load = useCallback(() => {
        if (!gameId) return
        setState((prev) => ({ ...prev, loading: true }))
        tavernUi
          .callHost(`${PLUGIN}/presets-view`, { gameId })
          .then((data) => setState({ loading: false, data, error: null, hint: '' }))
          .catch((error) => setState({ loading: false, data: null, error: String(error?.message || error), hint: '' }))
      }, [gameId])
      useEffect(() => { load() }, [load])

      const save = async (patch, hintText, scope = 'global') => {
        try {
          await tavernUi.callHost(`${PLUGIN}/presets-save`, { gameId, patch, scope })
          setState((prev) => ({ ...prev, hint: hintText ?? '已保存' }))
          setEdits({})
          load()
        } catch (error) {
          setState((prev) => ({ ...prev, hint: `保存失败：${String(error?.message || error)}` }))
        }
      }

      if (state.error) return h('div', { style: { color: ui.danger, fontSize: font.sm } }, `读取失败：${state.error}`)
      if (!state.data) return h('div', { style: muted }, '读取中…')

      const { definitions, order, checkedCodes, mvu } = state.data
      const checked = new Set(checkedCodes ?? [])
      // MVU 人物字段映射已退役（ADR 0091）：现在只有时间／地点两个兜底下拉
      const paths = mvu?.paths ?? []

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        state.hint ? h('div', { style: { ...muted, fontSize: font.xs } }, state.hint) : null,

        // ── 存哪：默认全局，按卡是可选覆盖（2026-11-05）──
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('span', { style: { ...muted, fontSize: font.xs } },
            state.data.scope?.card ? '当前用：这张卡的覆盖' : '当前用：全局预设'),
          h('button', { onClick: () => save({}, '已按卡保存（这张卡以后用自己的预设）', 'card'), style: { ...iconBtn, fontSize: font.sm } }, '按卡保存'),
          state.data.scope?.card
            ? h('button', { onClick: () => save({}, '已回到全局预设', 'clear-card'), style: { ...iconBtn, fontSize: font.sm } }, '回到全局')
            : null,
        ),

        // ── 条目定义 ──
        h('div', { style: { fontWeight: 600, fontSize: font.md } }, '条目（这一栏该写什么）'),
        h(
          'div',
          { style: { ...muted, fontSize: font.xs } },
          '勾选＝这条会出现在面板和召回里；「唯一」＝这栏只能有一条；「必带」＝每次召回强制给、不参与预算竞争；「约定」＝这栏记的是约定（模型会判完成/过期/失败）。',
        ),
        order.map((code) => {
          const item = definitions?.[code]
          if (!item) return null
          const name = edits[`${code}.name`] ?? item.name
          const prompt = edits[`${code}.prompt`] ?? item.prompt ?? ''
          return h(
            'div',
            {
              key: code,
              style: { display: 'flex', flexDirection: 'column', gap: 4, borderBottom: `1px solid ${ui.line}`, paddingBottom: 8 },
            },
            h(
              'div',
              { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h('input', {
                type: 'checkbox',
                checked: checked.has(code),
                onChange: () => {
                  const next = new Set(checked)
                  if (next.has(code)) next.delete(code)
                  else next.add(code)
                  save({ checkedCodes: [...next] }, `${name} ${next.has(code) ? '已勾上' : '已取消'}`)
                },
              }),
              h('input', {
                value: name,
                onChange: (event) => setEdits((prev) => ({ ...prev, [`${code}.name`]: event.target.value })),
                style: { flex: 1, fontSize: font.md, fontWeight: 600, background: 'transparent', border: 'none', borderBottom: `1px solid ${ui.line}` },
              }),
              h(
                'button',
                {
                  onClick: () => save(
                    { entries: { [code]: { mustRecall: item.mustRecall !== true } } },
                    `${name} ${item.mustRecall === true ? '取消必带' : '改为必带'}`,
                  ),
                  style: { ...iconBtn, fontSize: font.xs, opacity: item.mustRecall === true ? 1 : 0.45 },
                  title: '必带召回＝不参与打分与预算竞争，每次召回都强制给（人物属性类，如人生目标）',
                },
                '必带',
              ),
              h(
                'button',
                {
                  onClick: () => save(
                    { entries: { [code]: { convention: item.convention !== true } } },
                    `${name} ${item.convention === true ? '取消约定' : '改为约定'}`,
                  ),
                  style: { ...iconBtn, fontSize: font.xs, opacity: item.convention === true ? 1 : 0.45 },
                  title: '约定类＝这个栏目记的是约定（明天卯时见、三日后交银）；模型下一轮会判断完成/过期/失败',
                },
                '约定',
              ),
              h('span', { style: { ...muted, fontSize: font.xxs } }, `码 ${code}`),
            ),
            h('textarea', {
              value: prompt,
              rows: 2,
              spellCheck: false,
              placeholder: '这一栏该写什么（给模型看）',
              onChange: (event) => setEdits((prev) => ({ ...prev, [`${code}.prompt`]: event.target.value })),
              style: { width: '100%', fontSize: font.xs, fontFamily: 'monospace', boxSizing: 'border-box' },
            }),
            (edits[`${code}.name`] !== undefined || edits[`${code}.prompt`] !== undefined)
              ? h(
                  'div',
                  { style: { display: 'flex', gap: 6 } },
                  h('button', {
                    onClick: () => save({ entries: { [code]: { name, prompt } } }, `${name} 的说明已保存`),
                    style: { ...iconBtn, fontSize: font.xs },
                  }, '保存这条'),
                  h('button', {
                    onClick: () => setEdits((prev) => {
                      const next = { ...prev }
                      delete next[`${code}.name`]
                      delete next[`${code}.prompt`]
                      return next
                    }),
                    style: { ...iconBtn, fontSize: font.xs },
                  }, '放弃修改'),
                )
              : null,
          )
        }),

        // ── MVU 时间／地点兜底（人物字段映射已退役，ADR 0091）──
        h('div', { style: { fontWeight: 600, fontSize: font.md } }, 'MVU 时间与地点（兜底）'),
        h(
          'div',
          { style: { ...muted, fontSize: font.xs } },
          '程序先按常见形状自己找「时间」「地点」；**找不到**才用你这里选的字段——自己找得到就不会被顶掉。人物字段不再从 MVU 抄，一律由模型读正文写。',
        ),
        paths.length
          ? ['time', 'loc'].map((key) =>
              h(
                'div',
                { key, style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: font.sm } },
                h('span', { style: { minWidth: 60 } }, key === 'time' ? '时间来源' : '地点来源'),
                h(
                  'select',
                  {
                    value: mvu?.[key] ?? '',
                    onChange: (event) => {
                      const next = event.target.value
                      save(
                        { mvuTimeLoc: { [key]: next } },
                        `${key === 'time' ? '时间' : '地点'}来源 → ${next || '(自动)'}`,
                      )
                    },
                    style: { fontSize: font.xs, flex: 1 },
                  },
                  h('option', { value: '' }, '(自动 —— 程序自己找)'),
                  paths.map((item) =>
                    h(
                      'option',
                      { key: item.path, value: item.path },
                      `${item.path}　例：${String(item.sample ?? '').slice(0, 12)}`,
                    ),
                  ),
                ),
              ),
            )
          : h(
              'div',
              { style: { ...muted, fontSize: font.xs, display: 'flex', flexDirection: 'column', gap: 2 } },
              // 光说"没读到"没法排查：把这一轮到底拿到了什么摊出来
              h(
                'div',
                null,
                mvu?.survey?.error
                  ? `读 MVU 出错：${mvu.survey.error}`
                  : '这张卡没读到 MVU 变量，暂时没得选。',
              ),
              h(
                'div',
                null,
                mvu?.turn === null || mvu?.turn === undefined
                  ? '这局还没结算过——先跑一轮再看。'
                  : `拿到的是第 ${mvu.turn} 轮的变量。`,
              ),
              mvu?.survey?.keys?.length
                ? h(
                    'div',
                    null,
                    `MVU 顶层键：${mvu.survey.keys
                      .map((key) => `${key.key}（${key.kind === 'list' ? `${key.count} 项` : key.kind === 'map' ? `${key.count} 个` : '单值'}）`)
                      .join('、')}`,
                  )
                : h('div', null, '没拿到任何 MVU 变量（这张卡可能本来就不用 MVU）。'),
            ),
      )
    }

    // 三段提示词（系统/写入/召回）：全局存，改完下一轮生效
    function PromptView({ tavernUi, gameId }) {
      const [state, setState] = useState({ loading: true, data: null, error: null, hint: '' })
      const load = useCallback(() => {
        setState((prev) => ({ ...prev, loading: true, hint: '' }))
        tavernUi
          .callHost(`${PLUGIN}/prompts`, { gameId })
          .then((data) => setState({ loading: false, data, error: null, hint: '' }))
          .catch((error) => setState({ loading: false, data: null, error: String(error?.message || error), hint: '' }))
      }, [tavernUi, gameId])
      useEffect(() => { load() }, [load])

      const [drafts, setDrafts] = useState({})
      // 三块 textarea（18/14/14 行）竖排下来有四五屏，改一块要翻半天。
      // 默认只展开「系统提示词」（最常改的就是它），写入/召回收起成卡片标题。
      // 收起时留一行摘要：不然只剩标题，分不清哪张是空的。
      const [openCards, setOpenCards] = useState({ system: true })
      const toggleCard = (key) => setOpenCards((prev) => ({ ...prev, [key]: !prev[key] }))

      if (state.error) return h('div', { style: { color: ui.danger, fontSize: font.sm } }, `读取失败：${state.error}`)
      if (!state.data) return h('div', { style: muted }, '读取中…')

      const { templates, defaults, placeholders } = state.data
      const rows = [
        { key: 'system', label: '系统提示词', hint: '子代理每轮随工单发；跟随后台时是成员的固定前缀' },
        { key: 'write', label: '写入提示词', hint: '每轮第二次 followup 的素材骨架' },
        { key: 'recall', label: '召回提示词', hint: '注入正文模型的那一段' },
      ]

      const save = async (key, value) => {
        try {
          const result = await tavernUi.callHost(`${PLUGIN}/set-prompts`, { patch: { [key]: value } })
          if (result?.ok) {
            // 系统提示词是成员前缀：存下去 → 注册表换掉 → 下一轮结算现取，两条路径都是下一轮生效
            const note = key !== 'system'
              ? '已保存，下一轮生效'
              : result.memberMounted === false
                ? '已保存，但没能装进后台成员前缀（成员仍用旧的），详情看日志'
                : '已保存；下一轮结算生效（提示词缓存会失效一次）'
            setState({ loading: false, data: result, error: null, hint: note })
            setDrafts((prev) => ({ ...prev, [key]: undefined }))
          }
        } catch (error) {
          setState((prev) => ({ ...prev, hint: `保存失败：${String(error?.message || error)}` }))
        }
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        // 常显提示：这一页就是模型真正拿到的那份，但「跟随后台」的前缀只在会话开头注入
        h(
          'div',
          {
            style: {
              fontSize: font.xs,
              lineHeight: 1.7,
              color: ui.text,
              background: ui.soft,
              borderRadius: 8,
              padding: '6px 8px',
            },
          },
          '这一页就是模型真正拿到的那份，两条路径都是保存后下一轮结算就生效。',
          h('br'),
          '跟随后台档把它注册成成员前缀：改了文本会让提示词缓存失效一次（下一轮会慢一点、贵一点），之后每轮又稳定；不需要重开 DSH，也不需要重开一局。',
        ),
        state.hint ? h('div', { style: { ...muted, fontSize: font.xs } }, state.hint) : null,
        // 动态上下文（只读）：本局视角、称呼、栏目定义——每轮自动拼进工单，这里只能看
        state.data.contextText
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              h('div', { style: { fontWeight: 600, fontSize: font.md } }, '动态上下文（只读）'),
              h('div', { style: { ...muted, fontSize: font.xs } }, '本局视角、玩家称呼与栏目定义——每轮自动拼进工单，这里只能看，改不了。'),
              h(
                'pre',
                {
                  style: {
                    margin: 0,
                    padding: '8px 10px',
                    fontSize: font.sm,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    background: ui.soft,
                    borderRadius: 8,
                    maxHeight: 260,
                    overflowY: 'auto',
                  },
                },
                state.data.contextText,
              ),
            )
          : null,
        rows.map((row) => {
          const value = drafts[row.key] ?? templates[row.key] ?? ''
          const isOpen = Boolean(openCards[row.key])
          // 摘要取第一行非空内容：收起时一眼能认出这是哪张卡、有没有东西
          const summary = String(value).split('\n').map((line) => line.trim()).find(Boolean) ?? '（空）'
          return h(
            'div',
            {
              key: row.key,
              style: { display: 'flex', flexDirection: 'column', gap: 4, border: `1px solid ${ui.line}`, borderRadius: 8 },
            },
            // 卡片标题：点一下展开／收起，textarea 和按钮都跟着收进去
            h(
              'div',
              {
                onClick: () => toggleCard(row.key),
                style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', padding: '5px 8px' },
              },
              h('span', { style: { ...muted, width: 10 } }, isOpen ? '▾' : '▸'),
              h('span', { style: { fontWeight: 600, fontSize: font.md } }, row.label),
              isOpen
                ? null
                : h(
                    'span',
                    { style: { ...muted, fontSize: font.xs, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    summary,
                  ),
              isOpen ? null : h('span', { style: { ...muted, fontSize: font.xs } }, '展开'),
            ),
            isOpen
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px 8px' } },
                  h('div', { style: { ...muted, fontSize: font.xs } }, row.hint),
                  h('div', { style: { ...muted, fontSize: font.xs } }, `可用占位符：${(placeholders[row.key] ?? []).map((k) => `{{${k}}}`).join(' ')}`),
                  h('textarea', {
                    value,
                    rows: row.key === 'system' ? 18 : 14,
                    spellCheck: false,
                    onChange: (event) => setDrafts((prev) => ({ ...prev, [row.key]: event.target.value })),
                    // 离开输入框就存，不用点按钮（2026-11-03 用户要求）
                    onBlur: (event) => {
                      const next = event.target.value
                      if (next === (templates[row.key] ?? '')) return
                      save(row.key, next)
                    },
                    // 字放大到 14、行距 1.6、加内边距：11 号等宽字挤在一起看不清（2026-11-05 用户要求）
                    style: { width: '100%', fontSize: font.lg, lineHeight: 1.6, padding: '8px 10px', fontFamily: 'monospace', boxSizing: 'border-box' },
                  }),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                    h('button', {
                      onClick: () => save(row.key, ''),
                      style: { ...iconBtn, fontSize: font.sm },
                      title: '清空后保存 = 恢复内置默认',
                    }, '恢复默认'),
                    h('span', { style: { ...muted, fontSize: font.xs } }, '离开输入框即保存'),
                  ),
                )
              : null,
          )
        }),
      )
    }

    // 调试窗口：显示最近的诊断与报错。只在设置里打开 `debug.enabled` 时出现。
    function DebugView({ tavernUi, gameId }) {
      const [state, setState] = useState({ loading: true, data: null, error: null })
      const load = useCallback(() => {
        if (!gameId) return
        setState((prev) => ({ ...prev, loading: true }))
        tavernUi
          .callHost(`${PLUGIN}/debug`, { gameId })
          .then((data) => setState({ loading: false, data, error: null }))
          .catch((error) => setState({ loading: false, data: null, error: String(error?.message || error) }))
      }, [gameId])
      useEffect(() => { load() }, [load])

      if (state.error) return h('div', { style: { color: ui.danger, fontSize: font.sm } }, `读取失败：${state.error}`)
      if (!state.data) return h('div', { style: muted }, '读取中…')

      const logs = state.data.logs ?? []

      // 按轮次分组：**同轮次的全部归一堆**，不依赖相邻（旧日志没有 turn，单独归一堆）
      const buckets = new Map()
      for (const item of logs) {
        const key = Number.isInteger(item.turn) ? String(item.turn) : 'legacy'
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(item)
      }
      const groups = [...buckets.entries()]
        .map(([key, items]) => ({ turn: key === 'legacy' ? null : Number(key), items: [...items].reverse() }))
        .sort((a, b) => (a.turn === null ? 1 : b.turn === null ? -1 : b.turn - a.turn))

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('button', { onClick: load, disabled: state.loading, style: { ...iconBtn, fontSize: font.sm } }, '刷新'),
          h(
            'button',
            {
              onClick: async () => {
                try {
                  await tavernUi.callHost(`${PLUGIN}/debug`, { gameId, clear: true })
                  load()
                } catch { /* 忽略 */ }
              },
              style: { ...iconBtn, fontSize: font.sm },
            },
            '清空日志',
          ),
          h('span', { style: muted }, `${logs.length} / ${state.data.limits?.max ?? '?'} 条`),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          logs.length
            ? groups.map((group, index) => h(TurnGroup, {
                key: index,
                turn: group.turn,
                items: group.items,
                defaultOpen: index === 0,
              }))
            : h('div', { style: muted }, '还没有日志。跑一轮之后再看。'),
        ),
        h(
          'details',
          { style: { fontSize: font.xs } },
          h('summary', { style: { cursor: 'pointer', ...muted } }, '各阶段快照（原始数据）'),
          h('pre', { style: { fontSize: font.xxs, whiteSpace: 'pre-wrap', opacity: 0.8 } }, JSON.stringify(state.data.stages, null, 1)),
        ),
      )
    }

    // 历史快照：下拉选一轮，只读预览那一轮的人物册（不落盘、不影响当前进度）
    // 文案：`第N轮 · 时间 · 地点`——轮次一定在最前，时间/地点缺哪段就省哪段。
    // 原来拼的是 `gt|loc|轮次`，竖线加字段名像程序日志；玩家要的是"哪一轮、什么时候、在哪儿"。
    function snapshotLabel(item) {
      const gt = String(item?.gt ?? '').trim()
      const loc = String(item?.loc ?? '').trim()
      const turn = `第${item?.turn ?? 0}轮`
      return [turn, gt, loc].filter(Boolean).join(' · ')
    }

    function SnapshotPicker({ tavernUi, gameId, previewTurn, onPick, onBack }) {
      const [open, setOpen] = useState(false)
      const [state, setState] = useState({ loading: false, turns: [], error: null })
      const load = useCallback(() => {
        setState((prev) => ({ ...prev, loading: true }))
        tavernUi
          .callHost(`${PLUGIN}/snapshot-list`, { gameId })
          .then((data) => setState({ loading: false, turns: Array.isArray(data?.turns) ? data.turns : [], error: null }))
          .catch((error) => setState({ loading: false, turns: [], error: String(error?.message || error) }))
      }, [tavernUi, gameId])
      useEffect(() => {
        if (open) load()
      }, [open, load])

      const current = state.turns.find((item) => item.turn === previewTurn) ?? null
      const buttonText = previewTurn
        ? `历史：${current ? snapshotLabel(current) : `第${previewTurn}轮`}`
        : '看历史快照'

      return h(
        'div',
        { style: { display: 'flex', gap: 6, alignItems: 'center', position: 'relative' } },
        h(
          'button',
          { onClick: () => setOpen((value) => !value), style: { ...iconBtn, fontSize: font.sm } },
          `${buttonText} ${open ? '▴' : '▾'}`,
        ),
        previewTurn
          ? h('button', { onClick: () => { setOpen(false); onBack?.() }, style: { ...iconBtn, fontSize: font.sm } }, '回到当前')
          : null,
        open
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  zIndex: 30,
                  marginTop: 4,
                  minWidth: 260,
                  maxHeight: 5 * 26,
                  overflowY: 'auto',
                  background: 'Canvas',
                  color: 'CanvasText',
                  border: `1px solid ${ui.line}`,
                  borderRadius: 8,
                  boxShadow: '0 6px 20px rgba(0,0,0,.18)',
                  padding: 4,
                },
              },
              state.loading
                ? h('div', { style: { ...muted, fontSize: font.sm, padding: 6 } }, '读取中…')
                : state.error
                  ? h('div', { style: { color: ui.danger, fontSize: font.sm, padding: 6 } }, `读取失败：${state.error}`)
                  : state.turns.length === 0
                    ? h('div', { style: { ...muted, fontSize: font.sm, padding: 6 } }, '还没有历史快照')
                    : state.turns.map((item) =>
                        h(
                          'div',
                          {
                            key: item.turn,
                            onClick: () => { setOpen(false); onPick?.(item.turn) },
                            style: {
                              fontSize: font.sm,
                              padding: '5px 8px',
                              borderRadius: 6,
                              cursor: 'pointer',
                              background: item.turn === previewTurn ? 'rgba(46,125,79,.15)' : 'transparent',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            },
                            title: snapshotLabel(item),
                          },
                          snapshotLabel(item),
                        ),
                      ),
            )
          : null,
      )
    }

    function SnapshotPreview({ data }) {
      const groups = [
        ['在场', data?.groups?.present ?? []],
        ['模糊离场', data?.groups?.fuzzyOffline ?? []],
        ['离场', data?.groups?.offline ?? []],
        ['冷档', data?.groups?.cold ?? []],
      ].filter(([, rows]) => rows.length)

      if (data?.empty) return h('div', { style: muted }, '这一轮没有快照')
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h(
          'div',
          { style: { ...muted, fontSize: font.sm } },
          `只读预览 · 第${data?.turn ?? '?'}轮${data?.gt ? ` · ${data.gt}` : ''}${data?.loc ? ` · ${data.loc}` : ''}`,
        ),
        groups.length === 0
          ? h('div', { style: muted }, '这一轮档案里没有人')
          : groups.map(([title, rows]) =>
              h(
                'div',
                { key: title },
                h('div', { style: { fontWeight: 600, fontSize: font.md } }, `${title}（${rows.length}）`),
                ...rows.map((row) =>
                  h(
                    'div',
                    {
                      key: row.id,
                      style: { fontSize: font.sm, padding: '3px 0', borderBottom: `1px solid ${ui.line}` },
                    },
                    `${row.name}${row.status === 0 ? ' · 离场' : ''}`,
                  ),
                ),
              ),
            ),
      )
    }

    function ArchivePanel({ tavernUi, gameId, visible = true }) {
      const { loading, data, error, reload } = useArchive(tavernUi, gameId)
      const [view, setView] = useState('archive')
      // 档案视窗内的两种浏览方式：
      //   columns    「他是什么样」——关于他的命题，按栏目列（空栏目也列）
      //   cognitions 「他的认知」——他的指针，按命题的栏目分组
      const [browse, setBrowse] = useState('columns')
      // 主角姓名和「本局设置」里的玩家称呼是同一个值：改任一边都要让另一边重新读一遍。
      // 人物行改名 → 递增 identitySeq 让 IdentityBar 重挂载；改称呼 → 直接 reload 档案。
      const [identitySeq, setIdentitySeq] = useState(0)
      const reloadAll = useCallback(() => {
        reload()
        setIdentitySeq((n) => n + 1)
      }, [reload])
      // 「查人物」定位信号：token 每次点击都变，子组件靠它触发一次展开+滚动。
      // 用递增计数器而不是 Date.now()——同一毫秒连点两次时间戳会相同，第二次就不生效。
      const [focus, setFocus] = useState(null)
      const focusSeq = useRef(0)
      // 历史快照预览：null = 看当前；{turn, loading, view, error} = 看历史（只读）
      const [preview, setPreview] = useState(null)
      const pickSnapshot = useCallback(
        (turn) => {
          setPreview({ turn, loading: true, view: null, error: null })
          tavernUi
            .callHost(`${PLUGIN}/snapshot-at`, { gameId, turn })
            .then((view) => setPreview({ turn, loading: false, view, error: null }))
            .catch((error) => setPreview({ turn, loading: false, view: null, error: String(error?.message || error) }))
        },
        [tavernUi, gameId],
      )
      // 信号用完就清：不然那个人以后因为拖分组重新挂载，会莫名其妙又滚一次
      useEffect(() => {
        if (!focus) return undefined
        const timer = window.setTimeout(() => setFocus(null), 4000)
        return () => window.clearTimeout(timer)
      }, [focus])
      const fit = useFitHeight()
      const root = { ...panelRoot, ...(fit.height ? { height: fit.height } : {}) }

      // 表单控件的"继承宿主字体"规则只插一次（挂在 <style> 上），面板反复挂载不会重复插。
      useEffect(() => {
        if (document.getElementById(FONT_STYLE_ID)) return undefined
        const style = document.createElement('style')
        style.id = FONT_STYLE_ID
        style.textContent = FONT_STYLE_TEXT
        document.head.appendChild(style)
        return undefined
      }, [])

      // 面板被切回来时重读：跑完一轮再从别的标签页切回来，就能看到新数据
      useEffect(() => {
        if (visible) reload()
      }, [visible, reload])

      // **结算即推送**（M4-16）：宿主每轮结算后 publishState，我们订阅后立刻重读。
      // 比轮询省电、也更及时（不会再出现"等 3 秒才变"）。
      useEffect(() => {
        if (!visible || !gameId) return undefined
        let dispose = null
        try {
          dispose = tavernUi.watchState(gameId, 'archive', () => reload())
        } catch {
          return undefined
        }
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      }, [visible, gameId, reload])

      // 把宿主的**实际字号**量一次，写成根上的 --ca-base：面板里所有字号都是它的倍数（见 font）。
      // 为什么量而不是直接继承：`em` 会跟父元素叠乘，量成绝对基准才不会越嵌越小；
      // 宿主换主题/调字号后，切回面板或改窗口大小会重新量。
      // ⚠️ 位置很要紧：必须排在下面那些 `if (view === …) return` **之前**——
      // 放在后面的话，切标签页时有的分支跑了这个 hook、有的没跑，hook 数量对不上，
      // React 直接抛 #300 "Rendered more hooks than during the previous render"，整个面板崩掉。
      useEffect(() => {
        if (!visible) return undefined
        const sync = () => {
          const node = fit.ref.current
          if (!node) return
          const size = Number.parseFloat(window.getComputedStyle(node).fontSize)
          if (Number.isFinite(size) && size > 0) node.style.setProperty('--ca-base', `${size}px`)
        }
        sync()
        window.addEventListener('resize', sync)
        // 首帧布局还没稳定，隔一帧再量一次（跟 useFitHeight 同一个理由）
        const timer = window.setTimeout(sync, 60)
        return () => {
          window.removeEventListener('resize', sync)
          window.clearTimeout(timer)
        }
      }, [visible, fit.ref])

      const tab = (key, label) =>
        h(
          'button',
          {
            onClick: () => setView(key),
            style: {
              border: 'none',
              cursor: 'pointer',
              padding: '3px 10px',
              borderRadius: 10,
              fontSize: font.sm,
              background: view === key ? ui.fill : 'transparent',
              fontWeight: view === key ? 600 : 400,
            },
          },
          label,
        )

      const tabs = h(
        'div',
        { style: { display: 'flex', gap: 4, alignItems: 'center' } },
        tab('archive', '档案'),
        tab('settings', '设置'),
        tab('prompts', '提示词'),
        tab('presets', '预设'),
      )

      // 档案视窗里的两个切换按钮：同一个「栏目」壳，数据源不同。
      const browseBtn = (key, label) =>
        h(
          'button',
          {
            onClick: () => setBrowse(key),
            style: {
              border: 'none',
              cursor: 'pointer',
              padding: '2px 9px',
              borderRadius: 9,
              fontSize: font.xs,
              background: browse === key ? 'rgba(46,125,79,.18)' : ui.soft,
              fontWeight: browse === key ? 600 : 400,
            },
          },
          label,
        )

      const stats = data?.stats ?? { total: 0, present: 0, offline: 0, cold: 0 }
      const codes = (data?.checkedCodes ?? []).map((code) => ({
        code,
        name: data?.definitions?.[code]?.name ?? code,
      }))

      // 一律用同一个根节点（带 ref 量高度），内容按状态换——这样滚动区永远是它
      let body = null
      if (view === 'deleted') {
        return h(
          'div',
          { className: 'ca-panel', style: { ...panelRoot, gap: 12 } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } }, h('div', { style: { fontWeight: 600, fontSize: font.xl } }, '人物档案馆'), tabs),
          h(DeletedView, { tavernUi, gameId, onBack: () => setView('archive'), onChanged: reload }),
        )
      }

      if (view === 'presets') {
        return h(
          'div',
          { className: 'ca-panel', style: { ...panelRoot, gap: 12 } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } }, h('div', { style: { fontWeight: 600, fontSize: font.xl } }, '人物档案馆'), tabs),
          h(PresetView, { tavernUi, gameId }),
        )
      }

      if (view === 'prompts') {
        return h(
          'div',
          { className: 'ca-panel', style: { ...panelRoot, gap: 12 } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } }, h('div', { style: { fontWeight: 600, fontSize: font.xl } }, '人物档案馆'), tabs),
          h(PromptView, { tavernUi, gameId }),
        )
      }

      if (view === 'debug') {
        return h(
          'div',
          { className: 'ca-panel', style: { ...panelRoot, gap: 12 } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } }, h('div', { style: { fontWeight: 600, fontSize: font.xl } }, '人物档案馆'), tabs),
          h(DebugView, { tavernUi, gameId }),
        )
      }

      if (view === 'settings') {
        body = [
          h('div', { key: 'title', style: { display: 'flex', alignItems: 'baseline', gap: 8 } }, h('div', { style: { fontWeight: 600, fontSize: font.xl } }, '人物档案馆'), tabs),
          h(SettingsView, { key: 'settings', tavernUi, gameId, onChanged: reload }),
          // 调试面板放进设置页、默认收起：不占地方，也不用依赖标签页的显隐判断
          h(DebugSection, { key: 'debug-section', tavernUi, gameId }),
          h(DataLocations, { key: 'data-locations', tavernUi, gameId }),
        ]
      } else if (error) {
        body = [tabs, h('div', { key: 'err', style: { color: ui.danger, fontSize: font.sm } }, `读取失败：${error}`)]
      } else if (loading && !data) {
        body = [tabs, h('div', { key: 'loading', style: muted }, '读取中…')]
      } else if (data) {
        body = [
          h(
            'div',
            { key: 'title', style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
            h('div', { style: { fontWeight: 600, fontSize: font.xl } }, '人物档案馆'),
            h('div', { style: muted }, `共 ${stats.total} 人 · 在场 ${stats.present} · 离场 ${stats.offline}${stats.cold ? ` · 冷档 ${stats.cold}` : ''}`),
          ),
          h('div', { key: 'tabs', style: { display: 'flex', gap: 4, alignItems: 'center' } }, tabs),
          h(SnapshotPicker, {
            key: 'snapshot-picker',
            tavernUi,
            gameId,
            previewTurn: preview?.turn ?? null,
            onPick: pickSnapshot,
            onBack: () => setPreview(null),
          }),
        ]
        if (preview) {
          body.push(
            preview.loading
              ? h('div', { key: 'pv-loading', style: muted }, '读取中…')
              : preview.error
                ? h('div', { key: 'pv-error', style: { color: ui.danger, fontSize: font.sm } }, `读取失败：${preview.error}`)
                : h(SnapshotPreview, { key: 'pv', data: preview.view }),
          )
        } else {
          body.push(
            h(IdentityBar, { key: `identity-${identitySeq}`, tavernUi, gameId, visible, onChanged: reload }),
            data.gt || data.loc
              ? h('div', { key: 'gt', style: muted }, `当前：${[data.gt, data.loc].filter(Boolean).join(' · ')}`)
              : null,
            h(Toolbar, { key: 'toolbar', tavernUi, gameId, onReload: reload, onDeleted: () => setView('deleted') }),
            h(QueryBox, {
              key: 'query',
              tavernUi,
              gameId,
              onFocusPerson: (personId) => {
                focusSeq.current += 1
                setFocus({ personId: String(personId), token: focusSeq.current })
              },
            }),
            data.empty
              ? h('div', { key: 'empty', style: muted }, '这一局还没有人物册。等下一轮结算后会自动建档。')
              : h(
                  'div',
                  { key: 'groups', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                  h(
                    'div',
                    { key: 'browse', style: { display: 'flex', gap: 4, alignItems: 'center', paddingBottom: 2 } },
                    browseBtn('columns', '按栏目浏览'),
                    browseBtn('cognitions', '按认知浏览'),
                  ),
                  h(DraftBlock, { key: 'draft', tavernUi, gameId, rows: data.draft ?? [], onChanged: reload }),
                  h(Group, { title: '在场', kind: 'present', rows: data.groups?.present ?? [], tavernUi, gameId, codes, onChanged: reloadAll, defaultOpen: true, focus, browse }),
                  h(Group, { title: '模糊离场', kind: 'fuzzyOffline', rows: data.groups?.fuzzyOffline ?? [], tavernUi, gameId, codes, onChanged: reloadAll, defaultOpen: false, focus, browse }),
                  h(Group, { title: '离场', kind: 'offline', rows: data.groups?.offline ?? [], tavernUi, gameId, codes, onChanged: reloadAll, defaultOpen: false, focus, browse }),
                  h(Group, { title: '冷档', kind: 'cold', rows: data.groups?.cold ?? [], tavernUi, gameId, codes, onChanged: reloadAll, defaultOpen: false, focus, browse }),
                ),
          )
        }
      } else {
        body = [tabs]
      }

      return h('div', { ref: fit.ref, className: 'ca-panel', style: root }, body)
    }

    return {
      name: PLUGIN,
      inject: ['tavernUi'],
      apply(ctx) {
        const { tavernUi } = ctx
        if (!(tavernUi.apiVersion >= 3)) return

        tavernUi.registerPanel({
          id: 'character-archives',
          title: '人物档案馆',
          render: ({ gameId, visible }) => h(ArchivePanel, { tavernUi, gameId, visible }),
        })
      },
    }
  },
})
