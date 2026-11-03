// Snapshot normalization: component status derivation, grouping, incident data
// and the RSS fallback, all without touching the network.
import { normalizeInitialData, normalizeRss } from '../index.js'

/** Build one `initialData` prop with the given changes. */
function initialData(changes) {
  return {
    page: {
      components: [
        { component_id: 'pro', name: 'DeepSeek Pro API', description: 'pro', order_id: 1 },
        { component_id: 'chat', section_id: 'core', name: 'Chat', description: 'chat', order_id: 1 },
      ],
      sections: [{ section_id: 'core', name: 'Chat Service', order_id: 5 }],
    },
    active_changes: changes,
  }
}

const incident = {
  change_id: 42,
  type: 'incident',
  title: 'Partial outage',
  description: 'investigating the cause',
  status: 'monitoring',
  start_at_seconds: 1793696296,
  affected_components: [{ component_id: 'pro', name: 'DeepSeek Pro API', status: 'degraded' }],
  updates: [
    { at_seconds: 1793696296, status: 'investigating', description: 'looking into it' },
    { at_seconds: 1793696815, status: 'monitoring', description: 'fix deployed' },
  ],
}

const degraded = normalizeInitialData(initialData([incident]))
if (degraded.overall !== 'degraded') throw new Error(`degraded: overall ${degraded.overall}`)
if (degraded.counts.degraded !== 1 || degraded.counts.operational !== 1) throw new Error(`degraded: counts ${JSON.stringify(degraded.counts)}`)
if (degraded.groups[0].name !== null) throw new Error('ungrouped components must come first as a null-named group')
if (degraded.groups[1].name !== 'Chat Service') throw new Error('section grouping lost the section name')
if (degraded.changes[0].updatedAt !== 1793696815000) throw new Error('latest update timestamp was not converted from seconds')
if (degraded.changes[0].startAt !== 1793696296000) throw new Error('start timestamp was not converted from seconds')
if (degraded.changes[0].affects[0].status !== 'degraded') throw new Error('affected component status was lost')

// Worse states win, and one component's escalation cannot be downgraded by another change.
const escalated = normalizeInitialData(initialData([
  incident,
  {
    change_id: 43,
    type: 'incident',
    title: 'Full outage',
    status: 'identified',
    affected_components: [{ component_id: 'pro', name: 'DeepSeek Pro API', status: 'full_outage' }],
    updates: [],
  },
  {
    change_id: 44,
    type: 'incident',
    title: 'Noise',
    status: 'monitoring',
    affected_components: [{ component_id: 'pro', name: 'DeepSeek Pro API', status: 'operational' }],
    updates: [],
  },
]))
if (escalated.overall !== 'full_outage') throw new Error(`escalated: overall ${escalated.overall}`)

// Maintenance-only windows read as maintenance, not as an outage.
const maintenance = normalizeInitialData({
  page: { components: [], sections: [] },
  active_changes: [{ change_id: 45, type: 'maintenance', title: 'Upgrade', status: 'in_progress', affected_components: [], updates: [] }],
})
if (maintenance.overall !== 'maintenance') throw new Error(`maintenance: overall ${maintenance.overall}`)

// An incident with no component detail still has to read as degraded.
const vague = normalizeInitialData({
  page: { components: [], sections: [] },
  active_changes: [{ change_id: 46, type: 'incident', title: 'Issue', status: 'investigating', updates: [] }],
})
if (vague.overall !== 'degraded') throw new Error(`vague: overall ${vague.overall}`)

// Empty input is operational, not a crash.
const empty = normalizeInitialData({})
if (empty.overall !== 'operational' || empty.groups.length !== 0) throw new Error('empty payload was not normalized')

// RSS fallback: an unresolved incident yields degraded plus the affected names.
const rss = `<?xml version="1.0"?><rss><channel><item>
  <title>DeepSeek API degraded</title>
  <description>&lt;p&gt;&lt;strong&gt;Status:&lt;/strong&gt; monitoring&lt;/p&gt;&lt;p&gt;fix deployed&lt;/p&gt;&lt;p&gt;&lt;strong&gt;Affected components:&lt;/strong&gt; DeepSeek Pro API, Chat&lt;/p&gt;</description>
</item></channel></rss>`
const fallback = normalizeRss(rss)
if (fallback === null) throw new Error('RSS fallback returned null')
if (fallback.overall !== 'degraded') throw new Error(`rss: overall ${fallback.overall}`)
if (fallback.counts.degraded !== 2) throw new Error(`rss: counts ${JSON.stringify(fallback.counts)}`)
if (fallback.changes[0].status !== 'monitoring') throw new Error('rss: change status was not parsed')

// A resolved incident reads as operational; junk reads as no data.
const resolved = normalizeRss(rss.replace('monitoring', 'resolved'))
if (resolved === null || resolved.overall !== 'operational') throw new Error('resolved RSS incident must read operational')
if (normalizeRss('not xml') !== null) throw new Error('normalizeRss accepted junk')

console.log('normalize: OK (severity, groups, timestamps, maintenance, RSS fallback, junk)')
