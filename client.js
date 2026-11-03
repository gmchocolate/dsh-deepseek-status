/**
 * Browser half of the DeepSeek service-status light: one lamp in the sidebar
 * footer plus a hover card with the full component breakdown.
 *
 * Data comes from the Host half's same-origin JSON route
 * (`/plugins/deepseek-status.json`), which polls the public status page. The
 * browser never talks to status.deepseek.com directly: that origin sends no
 * CORS headers.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-deepseek-status',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NAMESPACE = 'deepseek-status'
    const ENDPOINT = '/plugins/deepseek-status.json'
    const POLL_MS = 60_000
    const CARD_WIDTH = 344
    /** Lit segments inside the lamp tube. */
    const LAMP_CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

    /** Statuses a component can report, in ascending severity. */
    const STATUS_ORDER = ['operational', 'maintenance', 'degraded', 'partial_outage', 'full_outage']
    /** Change statuses the card can name; anything else falls back to the raw value. */
    const CHANGE_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved', 'scheduled', 'in_progress', 'completed', 'verifying']

    /** State colors are theme tokens; unknown states use the idle token. */
    const STATUS_TOKEN = {
      operational: 'var(--dsw-alias-state-success-primary)',
      maintenance: 'var(--dsw-alias-brand-primary)',
      degraded: 'var(--dsw-alias-state-warn-primary)',
      partial_outage: 'var(--dsw-alias-state-error-primary)',
      full_outage: 'var(--dsw-alias-state-error-primary)',
      unknown: 'var(--dsw-alias-state-idle-primary)',
    }

    const EN = {
      'title': 'DeepSeek status',
      'overall.operational': 'All systems operational',
      'overall.maintenance': 'Scheduled maintenance',
      'overall.degraded': 'Degraded performance',
      'overall.partial_outage': 'Partial outage',
      'overall.full_outage': 'Major outage',
      'overall.unknown': 'Status unavailable',
      'short.operational': 'Operational',
      'short.maintenance': 'Maintenance',
      'short.degraded': 'Degraded',
      'short.partial_outage': 'Partial outage',
      'short.full_outage': 'Major outage',
      'short.unknown': 'Unknown',
      'status.operational': 'Operational',
      'status.maintenance': 'Maintenance',
      'status.degraded': 'Degraded',
      'status.partial_outage': 'Partial outage',
      'status.full_outage': 'Full outage',
      'section.components': 'Components',
      'section.incidents': 'Active incidents',
      'incidents.none': 'No active incidents',
      'change.status.investigating': 'Investigating',
      'change.status.identified': 'Identified',
      'change.status.monitoring': 'Monitoring',
      'change.status.resolved': 'Resolved',
      'change.status.scheduled': 'Scheduled',
      'change.status.in_progress': 'In progress',
      'change.status.completed': 'Completed',
      'change.status.verifying': 'Verifying',
      'affects': 'Affects: {names}',
      'updated': 'Updated {time}',
      'loading': 'Loading live status…',
      'refreshFailed': 'Live status unavailable',
      'stale': 'Last known status',
      'hoverHint': 'Hover for details',
    }

    const ZH = {
      'title': 'DeepSeek 服务状态',
      'overall.operational': '所有系统运行正常',
      'overall.maintenance': '计划维护中',
      'overall.degraded': '部分服务性能下降',
      'overall.partial_outage': '部分服务中断',
      'overall.full_outage': '服务大规模中断',
      'overall.unknown': '状态暂不可用',
      'short.operational': '正常',
      'short.maintenance': '维护中',
      'short.degraded': '性能下降',
      'short.partial_outage': '部分中断',
      'short.full_outage': '严重中断',
      'short.unknown': '未知',
      'status.operational': '正常',
      'status.maintenance': '维护中',
      'status.degraded': '性能下降',
      'status.partial_outage': '部分中断',
      'status.full_outage': '完全中断',
      'section.components': '服务组件',
      'section.incidents': '进行中的事件',
      'incidents.none': '暂无进行中的事件',
      'change.status.investigating': '排查中',
      'change.status.identified': '已定位',
      'change.status.monitoring': '监控中',
      'change.status.resolved': '已解决',
      'change.status.scheduled': '已计划',
      'change.status.in_progress': '进行中',
      'change.status.completed': '已完成',
      'change.status.verifying': '验证中',
      'affects': '影响：{names}',
      'updated': '更新于 {time}',
      'loading': '正在加载实时状态…',
      'refreshFailed': '无法获取实时状态',
      'stale': '最后一次已知状态',
      'hoverHint': '悬停查看详情',
    }

    /** Translate function replaced by the locale service once the plugin applies. */
    let fallbackTranslate = makeTranslate(EN)
    /** Registration-unique suffix so a second instance cannot collide. */
    let instanceSeq = 0

    /** Build a dictionary lookup with `{name}` interpolation. */
    function makeTranslate(dict) {
      return function translate(key, params) {
        const template = dict[key]
        if (template === undefined) return key
        if (params === undefined || params === null) return template
        return template.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined ? whole : String(params[name])))
      }
    }

    /** Translate with an explicit fallback for open-ended values. */
    function label(translate, key, fallback) {
      const text = translate(key)
      return text === key ? fallback : text
    }

    /** Normalize an upstream status value into the known set. */
    function normalizeStatus(value) {
      return typeof value === 'string' && STATUS_ORDER.indexOf(value) >= 0 ? value : 'operational'
    }

    /** Point a subtree at a status color by setting the local `--dss-color`. */
    function colorStyle(status) {
      return { '--dss-color': STATUS_TOKEN[status] ?? STATUS_TOKEN.unknown }
    }

    /** Format one timestamp for display, tolerating invalid values. */
    function formatTime(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      try {
        return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
      } catch {
        return new Date(value).toLocaleTimeString()
      }
    }

    /** Collapse and bound a long upstream description. */
    function condense(text, limit) {
      const flat = String(text).replace(/\s+/g, ' ').trim()
      return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
    }

    const CSS = `
.dss-root { position: relative; display: inline-flex; align-items: center; --dss-color: var(--dsw-alias-state-idle-primary); --dss-glow: color-mix(in srgb, var(--dss-color) 72%, transparent); }
.dss-trigger { box-sizing: border-box; display: inline-flex; align-items: center; gap: 7px; height: 28px; max-width: 100%; padding: 0 7px; margin: 0; border: 0; border-radius: 9px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 1; cursor: default; user-select: none; outline: none; }
.dss-trigger:hover, .dss-root[data-open='true'] .dss-trigger { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
.dss-trigger:focus-visible { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); }
.dss-caption { flex: 0 1 auto; min-width: 0; max-width: 56px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
/* The lamp: a glass tube of lit segments with a soft bloom and a faint spill below. */
.dss-lamp { position: relative; flex: none; display: inline-flex; align-items: center; gap: 2px; box-sizing: border-box; padding: 4px 5px; border-radius: 999px; background: linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-label-primary) 15%, transparent), color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 17%, transparent), inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent); }
.dss-lamp::before { content: ''; position: absolute; inset: -10px -14px; border-radius: 999px; background: radial-gradient(ellipse at center, color-mix(in srgb, var(--dss-color) 58%, transparent), transparent 72%); filter: blur(9px); opacity: .9; pointer-events: none; }
.dss-lamp::after { content: ''; position: absolute; left: 4px; right: 4px; top: calc(100% + 1px); height: 10px; border-radius: 999px; background: linear-gradient(180deg, color-mix(in srgb, var(--dss-color) 45%, transparent), transparent 88%); filter: blur(5px); opacity: .55; pointer-events: none; }
.dss-lamp-core { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 2px; filter: drop-shadow(0 0 3px var(--dss-glow)) drop-shadow(0 0 8px color-mix(in srgb, var(--dss-color) 42%, transparent)); }
.dss-cell { display: inline-block; width: 3.5px; height: 10px; border-radius: 2px; background: var(--dss-color); box-shadow: 0 0 2px var(--dss-glow), inset 0 0 1px color-mix(in srgb, white 40%, transparent); }
.dss-root[data-wide='false'] .dss-cell:nth-child(n+7) { display: none; }
.dss-root[data-wide='false'] .dss-trigger { padding: 0 4px; }
@keyframes dss-breathe { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
@keyframes dss-alarm { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }
.dss-root[data-state='degraded'] .dss-lamp::before, .dss-root[data-state='maintenance'] .dss-lamp::before { animation: dss-breathe 3.4s ease-in-out infinite; }
.dss-root[data-state='partial_outage'] .dss-lamp::before, .dss-root[data-state='full_outage'] .dss-lamp::before { animation: dss-alarm 1.7s ease-in-out infinite; }
.dss-root[data-state='unknown'] .dss-lamp-core { filter: none; opacity: .5; }
.dss-root[data-state='unknown'] .dss-lamp::before { opacity: .22; }
.dss-root[data-state='unknown'] .dss-lamp::after { opacity: .12; }
@media (prefers-reduced-motion: reduce) { .dss-lamp::before { animation: none !important; } }
.dss-dot { position: relative; flex: none; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--dss-color); box-shadow: 0 0 5px color-mix(in srgb, var(--dss-color) 58%, transparent); }
.dss-dot-sm { width: 6px; height: 6px; box-shadow: 0 0 3px color-mix(in srgb, var(--dss-color) 46%, transparent); }
.dss-card { position: fixed; z-index: 100; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; width: ${CARD_WIDTH}px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); overflow: hidden; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 16px 40px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); font-size: 12px; line-height: 1.45; pointer-events: none; overflow-wrap: anywhere; }
.dss-card::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 72px; background: radial-gradient(130% 100% at 50% 0%, color-mix(in srgb, var(--dss-color) 22%, transparent), transparent 72%); pointer-events: none; }
.dss-card > * { position: relative; }
.dss-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dss-head-title { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; }
.dss-pill { flex: none; display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--dss-color) 40%, transparent); background: color-mix(in srgb, var(--dss-color) 12%, transparent); color: var(--dsw-alias-label-primary); font-size: 11px; white-space: nowrap; }
.dss-summary { color: var(--dsw-alias-label-secondary); }
.dss-section { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dss-section-title { color: var(--dsw-alias-label-secondary); font-size: 11px; letter-spacing: .02em; }
.dss-group { display: flex; flex-direction: column; gap: 2px; }
.dss-group + .dss-group { margin-top: 4px; }
.dss-group-title { color: var(--dsw-alias-label-secondary); font-size: 11px; opacity: .82; }
.dss-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; padding: 1px 0; }
.dss-row-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dss-row-status { flex: none; display: inline-flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
.dss-change { display: flex; flex-direction: column; gap: 2px; }
.dss-change + .dss-change { margin-top: 6px; }
.dss-change-title { font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dss-change-meta { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dss-change-desc { color: var(--dsw-alias-label-secondary); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.dss-change-affects { color: var(--dsw-alias-label-secondary); font-size: 11px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.dss-muted { color: var(--dsw-alias-label-secondary); }
.dss-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dss-foot-source { flex: none; opacity: .8; }
`.trim()

    /**
     * The sidebar-footer lamp: a status dot that reveals the full breakdown on
     * hover or keyboard focus.
     * @param props - owner props (`wide`) plus the injected `t` translator.
     */
    function StatusLight(props) {
      const translate = typeof props.t === 'function' ? props.t : fallbackTranslate
      const wide = props.wide === true
      const [remote, setRemote] = React.useState({ data: null, failed: false })
      const [open, setOpen] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const triggerRef = React.useRef(null)
      const hideTimer = React.useRef(null)

      React.useEffect(() => {
        let disposed = false
        let controller = null
        const load = async () => {
          if (controller !== null) controller.abort()
          controller = new AbortController()
          try {
            const response = await fetch(ENDPOINT, {
              signal: controller.signal,
              headers: { accept: 'application/json' },
              cache: 'no-store',
            })
            if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
            const data = await response.json()
            if (!disposed) setRemote({ data, failed: data === null || data.ok !== true })
          } catch (error) {
            if (disposed) return
            if (error instanceof DOMException && error.name === 'AbortError') return
            setRemote((previous) => ({ data: previous.data, failed: true }))
          }
        }
        void load()
        const timer = setInterval(() => { void load() }, POLL_MS)
        const onVisibility = () => {
          if (document.visibilityState === 'visible') void load()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          disposed = true
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisibility)
          if (controller !== null) controller.abort()
          if (hideTimer.current !== null) {
            clearTimeout(hideTimer.current)
            hideTimer.current = null
          }
        }
      }, [])

      const show = React.useCallback(() => {
        if (hideTimer.current !== null) {
          clearTimeout(hideTimer.current)
          hideTimer.current = null
        }
        const element = triggerRef.current
        if (element === null) return
        const rect = element.getBoundingClientRect()
        const maxLeft = Math.max(8, window.innerWidth - CARD_WIDTH - 12)
        setAnchor({
          left: Math.min(Math.max(8, rect.right + 10), maxLeft),
          bottom: Math.max(12, window.innerHeight - rect.bottom),
        })
        setOpen(true)
      }, [])

      const hideSoon = React.useCallback(() => {
        if (hideTimer.current !== null) clearTimeout(hideTimer.current)
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null
          setOpen(false)
        }, 120)
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        const close = () => setOpen(false)
        window.addEventListener('resize', close)
        window.addEventListener('scroll', close, true)
        return () => {
          window.removeEventListener('resize', close)
          window.removeEventListener('scroll', close, true)
        }
      }, [open])

      const data = remote.data
      const loading = data === null && !remote.failed
      const overall = data !== null && typeof data.overall === 'string' ? data.overall : 'unknown'
      const feedProblem = remote.failed || (data !== null && (data.stale === true || data.error !== null))
      const overallLabel = label(translate, `overall.${overall}`, overall)
      const shortLabel = label(translate, `short.${overall}`, overallLabel)

      const groups = data !== null && Array.isArray(data.groups) ? data.groups : []
      const changes = data !== null && Array.isArray(data.changes) ? data.changes : []
      const fetchedAt = data === null ? null : data.fetchedAt
      const updatedText = formatTime(fetchedAt)

      const renderRow = (component) => {
        const status = normalizeStatus(component.status)
        return h('span', { className: 'dss-row', key: component.id },
          h('span', {
            className: 'dss-row-name',
            title: typeof component.description === 'string' && component.description !== '' ? component.description : component.name,
          }, component.name),
          h('span', { className: 'dss-row-status', style: colorStyle(status) },
            h('span', { className: 'dss-dot dss-dot-sm', 'aria-hidden': 'true' }),
            label(translate, `status.${status}`, status)))
      }

      const renderGroup = (group, index) => h('span', { className: 'dss-group', key: group.id === null || group.id === undefined ? `g${String(index)}` : group.id },
        typeof group.name === 'string' && group.name !== '' ? h('span', { className: 'dss-group-title' }, group.name) : null,
        (Array.isArray(group.components) ? group.components : []).map(renderRow))

      const renderChange = (change, index) => {
        const affects = Array.isArray(change.affects) ? change.affects : []
        const changeStatus = typeof change.status === 'string' && CHANGE_STATUSES.indexOf(change.status) >= 0
          ? label(translate, `change.status.${change.status}`, change.status)
          : (typeof change.status === 'string' ? change.status : '')
        const when = formatTime(change.updatedAt === null || change.updatedAt === undefined ? change.startAt : change.updatedAt)
        const meta = [changeStatus, when].filter((part) => part !== '').join(' · ')
        const description = typeof change.description === 'string' ? condense(change.description, 220) : ''
        const names = affects.map((affected) => affected.name).filter((name) => typeof name === 'string' && name !== '').join(', ')
        return h('span', { className: 'dss-change', key: typeof change.id === 'string' && change.id !== '' ? change.id : `c${String(index)}` },
          h('span', { className: 'dss-change-title' }, change.title),
          meta === '' ? null : h('span', { className: 'dss-change-meta' }, meta),
          description === '' ? null : h('span', { className: 'dss-change-desc' }, description),
          names === '' ? null : h('span', { className: 'dss-change-affects' }, translate('affects', { names })))
      }

      const card = open && anchor !== null
        ? h('span', {
            className: 'dss-card',
            role: 'tooltip',
            style: { left: `${String(anchor.left)}px`, bottom: `${String(anchor.bottom)}px` },
          },
          h('span', { className: 'dss-head' },
            h('span', { className: 'dss-head-title' },
              h('span', { className: 'dss-dot', 'aria-hidden': 'true' }),
              translate('title')),
            h('span', { className: 'dss-pill' }, shortLabel)),
          h('span', { className: 'dss-summary' }, loading ? translate('loading') : overallLabel),
          groups.length === 0 ? null : h('span', { className: 'dss-section' },
            h('span', { className: 'dss-section-title' }, translate('section.components')),
            groups.map(renderGroup)),
          h('span', { className: 'dss-section' },
            h('span', { className: 'dss-section-title' }, translate('section.incidents')),
            changes.length === 0
              ? h('span', { className: 'dss-muted' }, translate('incidents.none'))
              : changes.map(renderChange)),
          h('span', { className: 'dss-foot' },
            h('span', { className: 'dss-foot-time' },
              feedProblem
                ? translate('refreshFailed')
                : (updatedText === '' ? '' : translate('updated', { time: updatedText }))),
            h('span', { className: 'dss-foot-source' }, 'status.deepseek.com')))
        : null

      return h('span', {
        className: 'dss-root',
        'data-wide': wide ? 'true' : 'false',
        'data-state': overall,
        'data-open': open ? 'true' : undefined,
        style: colorStyle(overall),
      },
      h('style', { key: 'style' }, CSS),
      h('span', {
        ref: triggerRef,
        className: 'dss-trigger',
        role: 'button',
        tabIndex: 0,
        'aria-expanded': open,
        'aria-label': `${translate('title')} · ${overallLabel}`,
        onMouseEnter: show,
        onMouseLeave: hideSoon,
        onFocus: show,
        onBlur: hideSoon,
      },
      h('span', { className: 'dss-lamp', 'aria-hidden': 'true' },
        h('span', { className: 'dss-lamp-core' },
          LAMP_CELLS.map((index) => h('span', { className: 'dss-cell', key: index })))),
      wide ? h('span', { className: 'dss-caption' }, shortLabel) : null),
      card)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        instanceSeq += 1
        const suffix = instanceSeq === 1 ? '' : `-${String(instanceSeq)}`
        fallbackTranslate = ctx.locale.bind(NAMESPACE)
        ctx.effect(() => ctx.locale.register(NAMESPACE, 'en', EN), 'deepseek-status: en dictionary')
        ctx.effect(() => ctx.locale.register(NAMESPACE, 'zh', ZH), 'deepseek-status: zh dictionary')
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: `deepseek-status${suffix}`,
          order: 10,
          label: () => fallbackTranslate('title'),
          locale: NAMESPACE,
        }, StatusLight))
      },
    }
  },
})
