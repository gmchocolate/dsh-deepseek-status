// Optional live smoke test: fetches the real status page and reports what the
// parser makes of it. Network failure is a skip, not a test failure, so this is
// not part of `npm test`.
import { extractInitialData, normalizeInitialData } from '../index.js'

const response = await fetch('https://status.deepseek.com/', {
  headers: { accept: 'text/html, application/xhtml+xml;q=0.9, */*;q=0.8' },
  signal: AbortSignal.timeout(20_000),
}).catch((error) => {
  console.log(`live: skipped (${error.message})`)
  process.exit(0)
})

if (!response.ok) {
  console.log(`live: skipped (HTTP ${response.status})`)
  process.exit(0)
}

const html = await response.text()
const initialData = extractInitialData(html)
if (initialData === null) {
  console.error('live: FAILED — the page no longer carries a parseable initialData payload')
  process.exit(1)
}

const snapshot = normalizeInitialData(initialData)
console.log(`live: overall=${snapshot.overall}`)
console.log(`live: counts=${JSON.stringify(snapshot.counts)}`)
for (const group of snapshot.groups) {
  console.log(`  ${group.name ?? '(ungrouped)'}`)
  for (const member of group.components) console.log(`    ${member.status.padEnd(14)} ${member.name}`)
}
for (const change of snapshot.changes) console.log(`  ${change.type}/${change.status}: ${change.title}`)
