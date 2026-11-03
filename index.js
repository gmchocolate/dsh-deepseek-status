/**
 * Host half of the DeepSeek service-status light.
 *
 * Polls https://status.deepseek.com/ on a timer, derives one normalized
 * snapshot (overall status, component statuses, active incidents) and serves
 * it as same-origin JSON at `/plugins/deepseek-status.json`, so the browser
 * half never has to deal with the status site's CORS policy or its
 * server-rendered payload format.
 *
 * The status page is a Next.js app-router page whose live data arrives inside
 * the flight payload of the served HTML (`self.__next_f.push([1, "..."])`).
 * The interesting slice is the `initialData` prop of the status component:
 * the component catalog plus the list of active changes, whose
 * `affected_components[].status` carries each component's current state.
 *
 * @module @local/dsh-deepseek-status
 */

/** Public status page the snapshot is derived from. */
const STATUS_PAGE_URL = 'https://status.deepseek.com/'
/** Incident/update feed used only when the page payload cannot be parsed. */
const HISTORY_RSS_URL = 'https://status.deepseek.com/history.rss'
/** Same-origin JSON route the browser half reads. */
const ROUTE_PATH = '/plugins/deepseek-status.json'
/** Upstream refresh period; the browser half polls slower than this. */
const REFRESH_MS = 90_000
/** Hard ceiling for one upstream request. */
const FETCH_TIMEOUT_MS = 20_000
/** Largest HTML body accepted from upstream. */
const MAX_BODY_BYTES = 4 * 1024 * 1024
/** Change statuses that mean "still ongoing". */
const ACTIVE_CHANGE_STATUSES = new Set(['investigating', 'identified', 'monitoring'])
/** Ordered severity; the highest value is the worst observed state. */
const SEVERITY = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, full_outage: 4 }
const STATUS_NAMES = ['operational', 'maintenance', 'degraded', 'partial_outage', 'full_outage']

/** Services required before the route and the poller can mount. */
export const inject = ['webServer']

/**
 * Mount the poller and the snapshot route.
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx) {
  const state = { snapshot: null, fetchedAt: 0, error: null, inflight: null }

  /** Refresh once; concurrent callers share the in-flight request. */
  const refresh = () => {
    if (state.inflight !== null) return state.inflight
    const run = (async () => {
      try {
        const snapshot = await readUpstream()
        state.snapshot = snapshot
        state.fetchedAt = Date.now()
        state.error = null
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error)
      } finally {
        state.inflight = null
      }
    })()
    state.inflight = run
    return run
  }

  /** Build the current response body from cache. */
  const payload = () => {
    const stale = state.snapshot !== null && Date.now() - state.fetchedAt > REFRESH_MS * 3
    return {
      ok: state.snapshot !== null,
      source: STATUS_PAGE_URL,
      fetchedAt: state.snapshot === null ? null : state.fetchedAt,
      refreshSeconds: Math.round(REFRESH_MS / 1000),
      stale,
      error: state.error,
      overall: state.snapshot === null ? 'unknown' : state.snapshot.overall,
      counts: state.snapshot === null ? emptyCounts() : state.snapshot.counts,
      groups: state.snapshot === null ? [] : state.snapshot.groups,
      changes: state.snapshot === null ? [] : state.snapshot.changes,
    }
  }

  /** Serve the cached snapshot, waiting for the first fetch at most once. */
  const handler = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    if (state.snapshot === null) await refresh()
    const body = JSON.stringify(payload())
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      'cache-control': 'no-store',
    })
    if (req.method === 'HEAD') res.end()
    else res.end(body)
  }

  ctx.effect(() => {
    void refresh()
    const timer = setInterval(() => {
      void refresh()
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, 'deepseek-status: upstream poller')

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler }),
    'deepseek-status: snapshot route',
  )
}

/** Zeroed per-status counters. */
function emptyCounts() {
  return { operational: 0, maintenance: 0, degraded: 0, partial_outage: 0, full_outage: 0 }
}

/**
 * Fetch the status page and normalize it, falling back to the RSS feed.
 * @returns normalized snapshot.
 */
async function readUpstream() {
  const html = await fetchText(STATUS_PAGE_URL)
  const initialData = extractInitialData(html)
  if (initialData !== null) return normalizeInitialData(initialData)
  const xml = await fetchText(HISTORY_RSS_URL)
  const fallback = normalizeRss(xml)
  if (fallback !== null) return fallback
  throw new Error('status page payload did not contain component status data')
}

/**
 * Fetch one URL as text with a bounded response size.
 * @param url - absolute URL.
 * @returns response body.
 */
async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: url === HISTORY_RSS_URL
        ? 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8'
        : 'text/html, application/xhtml+xml;q=0.9, */*;q=0.8',
      'user-agent': 'dsh-deepseek-status/0.1 (+status.deepseek.com)',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`${url} responded ${response.status}`)
  const body = await response.text()
  if (body.length > MAX_BODY_BYTES) throw new Error(`${url} exceeded the accepted body size`)
  return body
}

/**
 * Read one balanced JSON array/object starting at `start`.
 * @param text - source text.
 * @param start - index of the opening bracket.
 * @returns raw slice and its exclusive end, or null when unterminated.
 */
function readJsonSlice(text, start) {
  const open = text[start]
  if (open !== '{' && open !== '[') return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 0) return { raw: text.slice(start, i + 1), end: i + 1 }
    }
  }
  return null
}

/**
 * Concatenate the decoded flight-payload strings of a Next.js page.
 * @param html - served HTML document.
 * @returns the joined flight text.
 */
function collectFlightText(html) {
  const marker = 'self.__next_f.push('
  let text = ''
  let cursor = 0
  for (let guard = 0; guard < 8192; guard += 1) {
    const at = html.indexOf(marker, cursor)
    if (at < 0) break
    const argStart = at + marker.length
    const slice = readJsonSlice(html, argStart)
    if (slice === null) {
      cursor = argStart
      continue
    }
    cursor = slice.end
    try {
      const push = JSON.parse(slice.raw)
      if (Array.isArray(push) && typeof push[1] === 'string') text += push[1]
    } catch {
      /* a non-JSON argument is not flight data; keep scanning */
    }
  }
  return text
}

/**
 * Extract the status component's `initialData` prop from a status page.
 * @param html - served HTML document.
 * @returns the parsed prop, or null when absent/unparseable.
 */
export function extractInitialData(html) {
  const flight = collectFlightText(html)
  if (flight === '') return null
  const needle = '"initialData":'
  const at = flight.indexOf(needle)
  if (at < 0) return null
  const brace = flight.indexOf('{', at + needle.length)
  if (brace < 0) return null
  const slice = readJsonSlice(flight, brace)
  if (slice === null) return null
  try {
    return JSON.parse(slice.raw)
  } catch {
    return null
  }
}

/**
 * Turn `initialData` into the normalized snapshot shape.
 * @param data - parsed `initialData` prop.
 * @returns normalized snapshot.
 */
export function normalizeInitialData(data) {
  const page = isObject(data.page) ? data.page : {}
  const rawSections = Array.isArray(page.sections) ? page.sections : []
  const sections = rawSections
    .map((section) => ({
      id: asText(section.section_id),
      name: asText(section.name),
      order: asNumber(section.order_id),
    }))
    .filter((section) => section.id !== '')
    .sort((left, right) => left.order - right.order)
  const sectionNames = new Map(sections.map((section) => [section.id, section.name]))

  const rawComponents = Array.isArray(page.components) ? page.components : []
  const components = rawComponents
    .map((component) => {
      const sectionId = component.section_id === undefined || component.section_id === null
        ? null
        : asText(component.section_id)
      return {
        id: asText(component.component_id),
        name: asText(component.name),
        description: asText(component.description),
        sectionId,
        sectionName: sectionId === null ? null : (sectionNames.get(sectionId) ?? null),
        order: asNumber(component.order_id),
        status: 'operational',
      }
    })
    .filter((component) => component.id !== '')
  const componentsById = new Map(components.map((component) => [component.id, component]))

  const rawChanges = Array.isArray(data.active_changes) ? data.active_changes : []
  const changes = rawChanges
    .map((change) => {
      const rawAffected = Array.isArray(change.affected_components) ? change.affected_components : []
      const affects = rawAffected.map((affected) => {
        const id = asText(affected.component_id)
        const status = typeof affected.status === 'string' ? affected.status : null
        const target = componentsById.get(id)
        if (target !== undefined && status !== null && severityOf(status) > severityOf(target.status)) {
          target.status = status
        }
        return {
          id,
          name: asText(affected.name) || (target === undefined ? '' : target.name),
          status,
        }
      })
      const rawUpdates = Array.isArray(change.updates) ? change.updates : []
      const updates = rawUpdates
        .map((update) => ({
          at: secondsToMs(update.at_seconds),
          status: asText(update.status),
          description: asText(update.description),
        }))
        .sort((left, right) => (left.at ?? 0) - (right.at ?? 0))
      const latest = updates.length === 0 ? null : updates[updates.length - 1]
      return {
        id: change.change_id === undefined ? '' : asText(change.change_id),
        type: change.type === 'maintenance' ? 'maintenance' : 'incident',
        title: asText(change.title),
        status: asText(change.status),
        description: asText(change.description),
        startAt: secondsToMs(change.start_at_seconds),
        updatedAt: latest === null ? null : latest.at,
        latestUpdate: latest,
        affects,
      }
    })
    .filter((change) => change.title !== '' || change.affects.length > 0)

  const counts = emptyCounts()
  for (const component of components) {
    const status = severityOf(component.status) === 0 ? 'operational' : component.status
    if (counts[status] !== undefined) counts[status] += 1
    else counts.operational += 1
  }

  let overall = 'operational'
  if (components.length === 0) {
    if (changes.some((change) => change.type === 'incident' && ACTIVE_CHANGE_STATUSES.has(change.status))) overall = 'degraded'
    else if (changes.length > 0) overall = 'maintenance'
  } else {
    let worst = 0
    for (const component of components) worst = Math.max(worst, severityOf(component.status))
    overall = STATUS_NAMES[worst]
  }

  const groups = []
  const rootComponents = components.filter((component) => component.sectionId === null)
  if (rootComponents.length > 0) groups.push({ id: null, name: null, components: rootComponents })
  for (const section of sections) {
    const members = components.filter((component) => component.sectionId === section.id)
    if (members.length > 0) groups.push({ id: section.id, name: section.name, components: members })
  }

  return { overall, counts, groups, changes }
}

/**
 * Turn the incident RSS feed into a coarse snapshot (fallback path).
 * @param xml - RSS document.
 * @returns normalized snapshot, or null when the feed is unreadable.
 */
export function normalizeRss(xml) {
  const item = /<item\b[^>]*>([\s\S]*?)<\/item>/i.exec(xml)
  if (item === null) return null
  const body = item[1]
  const title = decodeEntities(tagText(body, 'title') ?? '').trim()
  if (title === '') return null
  const description = decodeEntities(tagText(body, 'description') ?? '')
  const statusMatch = /Status:\s*(?:<\/strong>)?\s*([a-z_]+)/i.exec(description)
  const status = statusMatch === null ? 'unknown' : statusMatch[1].toLowerCase()
  const active = ACTIVE_CHANGE_STATUSES.has(status)
  const affectsMatch = /Affected components:\s*(?:<\/strong>)?\s*([^<\n]*)/i.exec(description)
  const names = affectsMatch === null
    ? []
    : affectsMatch[1].split(',').map((name) => name.trim()).filter((name) => name !== '')
  const components = names.map((name, index) => ({
    id: `rss-${String(index)}`,
    name,
    description: '',
    sectionId: null,
    sectionName: null,
    order: index,
    status: active ? 'degraded' : 'operational',
  }))
  const counts = emptyCounts()
  for (const component of components) counts[component.status] += 1
  return {
    overall: active ? 'degraded' : 'operational',
    counts,
    groups: components.length === 0 ? [] : [{ id: null, name: null, components }],
    changes: active
      ? [{
          id: '',
          type: 'incident',
          title,
          status,
          description: stripTags(description),
          startAt: null,
          updatedAt: null,
          latestUpdate: null,
          affects: components.map((component) => ({ id: component.id, name: component.name, status: component.status })),
        }]
      : [],
  }
}

/** Map a status string to its severity; unknown states read as operational. */
function severityOf(status) {
  const value = SEVERITY[status]
  return value === undefined ? 0 : value
}

/** Convert an epoch-seconds field to milliseconds. */
function secondsToMs(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value * 1000 : null
}

/** Read a numeric field defensively. */
function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Read a string field defensively. */
function asText(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/** Narrow to a non-null object. */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read the first `<tag>` text of an XML fragment. */
function tagText(xml, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  return match === null ? null : match[1]
}

/** Decode the XML/HTML entities the feed emits. */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex) => safeCodePoint(parseInt(hex, 16), whole))
    .replace(/&#(\d+);/g, (whole, decimal) => safeCodePoint(Number(decimal), whole))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** Convert one code point, keeping the source text when it is invalid. */
function safeCodePoint(value, fallback) {
  try {
    return String.fromCodePoint(value)
  } catch {
    return fallback
  }
}

/** Drop every tag from a fragment. */
function stripTags(text) {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}
