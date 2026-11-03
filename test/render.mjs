// Client-half render smoke test: loads the browser module with a stub loader and
// a tiny hook runtime, then renders the lamp and the hover card without a DOM.
import assert from 'node:assert/strict'

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 800,
  __ModuleLoader__: {
    load(spec) {
      globalThis.__loaded = spec
    },
  },
}

// ---- a minimal React stand-in -----------------------------------------------
const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
}
let hooks = []
let hookIndex = 0
ReactStub.useState = (initial) => {
  const value = hooks[hookIndex] ?? initial
  hookIndex += 1
  return [value, () => {}]
}
ReactStub.useEffect = () => undefined
ReactStub.useCallback = (fn) => fn
ReactStub.useRef = () => ({
  current: { getBoundingClientRect: () => ({ right: 240, bottom: 760, top: 732, left: 200 }) },
})

await import('../client.js')

const spec = globalThis.__loaded
assert.ok(spec !== undefined, 'client module must register a loader factory')
assert.equal(spec.id, '@local/dsh-deepseek-status')

// ---- fake plugin context -----------------------------------------------------
const dicts = new Map()
const registrations = []
const injected = []

const ctx = {
  locale: {
    register(namespace, locale, dict) {
      if (!dicts.has(namespace)) dicts.set(namespace, new Map())
      dicts.get(namespace).set(locale, dict)
      return () => {}
    },
    bind() {
      return translate('en')
    },
  },
  effect(run) {
    run()
    return () => {}
  },
  slots: {
    inject(key, callback) {
      injected.push(key)
      callback()
      return () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
}

function dictFor(locale) {
  const entry = dicts.get('deepseek-status') ?? new Map()
  return entry.get(locale) ?? entry.get('en') ?? {}
}
function translate(locale) {
  return (key, params) => {
    const template = dictFor(locale)[key]
    if (template === undefined) return key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined ? whole : String(params[name])))
  }
}

const client = spec.factory((name) => {
  assert.equal(name, 'react')
  return ReactStub
})
assert.equal(typeof client.apply, 'function')
client.apply(ctx)

assert.deepEqual(injected, ['sidebar.footer.action'], 'the lamp must be injected into the sidebar footer seat')
assert.equal(registrations.length, 1)
assert.equal(registrations[0].options.id, 'deepseek-status')
assert.equal(registrations[0].options.locale, 'deepseek-status')
assert.deepEqual([...dicts.get('deepseek-status').keys()], ['en', 'zh'], 'both dictionaries must register')

const component = registrations[0].component
if (typeof component !== 'function') throw new Error('registration did not receive a component')

// ---- render helpers ----------------------------------------------------------
function render(hookValues, props) {
  hooks = hookValues
  hookIndex = 0
  return component({ t: translate('zh'), ...props })
}

function text(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object' && typeof node !== 'string') return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) text(child, out)
    return out
  }
  for (const child of node.children ?? []) text(child, out)
  return out
}

function nodes(node, token, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) nodes(child, token, out)
    return out
  }
  const className = node.props?.className
  if (typeof className === 'string' && className.split(' ').includes(token)) out.push(node)
  for (const child of node.children ?? []) nodes(child, token, out)
  return out
}

// ---- fixtures ----------------------------------------------------------------
const snapshot = {
  ok: true,
  overall: 'degraded',
  fetchedAt: 1793700000000,
  stale: false,
  error: null,
  groups: [
    {
      id: null,
      name: null,
      components: [
        { id: 'a', name: 'DeepSeek V4 Pro API', description: 'pro availability', status: 'degraded' },
        { id: 'b', name: 'Search API', description: 'search availability', status: 'operational' },
      ],
    },
    {
      id: 'core',
      name: 'Chat Service',
      components: [{ id: 'c', name: 'Chat', description: 'chat availability', status: 'degraded' }],
    },
  ],
  changes: [{
    id: '7202016104287',
    type: 'incident',
    title: 'DeepSeek Web/API Partially Unavailable',
    status: 'monitoring',
    description: 'A fix has been implemented and the results are being monitored.',
    startAt: 1793696296000,
    updatedAt: 1793696815000,
    affects: [{ id: 'a', name: 'DeepSeek V4 Pro API', status: 'degraded' }],
  }],
}

const operational = { ...snapshot, overall: 'operational', changes: [], groups: snapshot.groups.map((group) => ({
  ...group,
  components: group.components.map((member) => ({ ...member, status: 'operational' })),
})) }

// ---- the lamp -----------------------------------------------------------------
const closed = render([{ data: snapshot, failed: false }, false, null], { wide: false })
assert.equal(closed.props['data-state'], 'degraded')
assert.equal(closed.props['data-wide'], 'false')
assert.equal(closed.props.style['--dss-color'], 'var(--dsw-alias-state-warn-primary)', 'the lamp itself must carry the state color')
assert.equal(nodes(closed, 'dss-cell').length, 10, 'the lamp renders ten lit segments')

// Regression guard: every state must reach the lamp, not only the hover card.
for (const [name, state, expectedColor] of [
  ['operational', { data: operational, failed: false }, 'var(--dsw-alias-state-success-primary)'],
  ['degraded', { data: snapshot, failed: false }, 'var(--dsw-alias-state-warn-primary)'],
  ['unknown', { data: null, failed: true }, 'var(--dsw-alias-state-idle-primary)'],
]) {
  const tree = render([state, false, null], { wide: true })
  assert.equal(tree.props.style['--dss-color'], expectedColor, `lamp color for ${name}`)
}

// The lamp is the only always-visible status cue: no status text in either sidebar state.
for (const wideSidebar of [true, false]) {
  const tree = render([{ data: snapshot, failed: false }, false, null], { wide: wideSidebar })
  assert.equal(nodes(tree, 'dss-caption').length, 0, `caption must not render (wide=${String(wideSidebar)})`)
  const statusText = text(tree).filter((line) => line === '性能下降' || line === 'Degraded')
  assert.deepEqual(statusText, [], `status text must stay out of the sidebar (wide=${String(wideSidebar)})`)
  assert.equal(nodes(tree, 'dss-lamp').length, 1, 'the lamp must render')
}

// ---- the hover card -----------------------------------------------------------
const opened = render([{ data: snapshot, failed: false }, true, { left: 250, bottom: 40 }], { wide: true })
const lines = text(opened)
const joined = lines.join(' | ')
assert.ok(lines.includes('DeepSeek 服务状态'), 'card title is missing')
assert.ok(joined.includes('性能下降'), 'overall state is missing')
assert.ok(joined.includes('服务组件'), 'component section is missing')
assert.ok(joined.includes('Chat Service'), 'component group name is missing')
assert.ok(joined.includes('DeepSeek V4 Pro API'), 'component row is missing')
assert.ok(joined.includes('进行中的事件'), 'incident section is missing')
assert.ok(joined.includes('监控中'), 'incident status is missing')
assert.ok(joined.includes('影响：DeepSeek V4 Pro API'), 'affected components are missing')
assert.ok(joined.includes('更新于'), 'update time is missing')
assert.ok(joined.includes('status.deepseek.com'), 'source footer is missing')
assert.equal(nodes(opened, 'dss-card').length, 1)

// A failed feed keeps the card usable and says so.
const failedLines = text(render([{ data: null, failed: true }, true, { left: 250, bottom: 40 }], { wide: true })).join(' | ')
assert.ok(failedLines.includes('状态暂不可用'), 'unknown state is missing')
assert.ok(failedLines.includes('无法获取实时状态'), 'feed failure is not surfaced')
assert.ok(failedLines.includes('暂无进行中的事件'), 'empty incident list is missing')

console.log('render: OK (lamp colors, rail/wide variants, card contents, failure state)')
