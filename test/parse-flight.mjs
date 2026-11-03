// Flight-payload extraction: the status page ships its live data inside the
// served HTML as a Next.js app-router flight payload.
import { extractInitialData, normalizeInitialData } from '../index.js'

/** Wrap one flight line into a page shaped like the status page HTML. */
function pageWithFlight(line) {
  return `<!doctype html><html><body><script>self.__next_f.push([1,${JSON.stringify(line)}])</script></body></html>`
}

const initialData = {
  page: {
    components: [
      { component_id: 'pro', name: 'DeepSeek Pro API', description: 'pro availability', order_id: 1 },
      { component_id: 'chat', section_id: 'core', name: 'Chat', description: 'chat availability', order_id: 1 },
    ],
    sections: [{ section_id: 'core', name: 'Chat Service', description: 'core', order_id: 5 }],
  },
  active_changes: [],
}

const html = pageWithFlight(`3a:["$","$L40",null,{"pageId":1,"initialData":${JSON.stringify(initialData)}}]`)
const extracted = extractInitialData(html)
if (extracted === null) throw new Error('extractInitialData returned null for a valid page')
if (extracted.page.components.length !== 2) throw new Error('component catalog was not extracted')
if (extracted.active_changes.length !== 0) throw new Error('active changes were not extracted')

const snapshot = normalizeInitialData(extracted)
if (snapshot.overall !== 'operational') throw new Error(`expected operational, got ${snapshot.overall}`)
if (snapshot.groups.length !== 2) throw new Error(`expected 2 groups, got ${snapshot.groups.length}`)

// Text that is not a flight payload, a truncated page, and empty input must all read as "no data".
for (const candidate of ['<html><body>nothing</body></html>', '', pageWithFlight('3a:["$","$L40",null,{"initialData":{"page":')]) {
  if (extractInitialData(candidate) !== null) throw new Error('extractInitialData accepted an unparseable page')
}

// Braces, brackets and escaped quotes inside strings must not end the slice early.
const awkward = { page: { components: [{ component_id: 'x', name: 'a { b } [ c ] " d', order_id: 1 }], sections: [] }, active_changes: [] }
const awkwardHtml = pageWithFlight(`1:{"initialData":${JSON.stringify(awkward)}}`)
const awkwardResult = extractInitialData(awkwardHtml)
if (awkwardResult === null) throw new Error('brace matching broke on punctuation inside a string')
if (awkwardResult.page.components[0].name !== 'a { b } [ c ] " d') throw new Error('string content was mangled')

console.log('parse-flight: OK (extraction, junk input, punctuation inside strings)')
