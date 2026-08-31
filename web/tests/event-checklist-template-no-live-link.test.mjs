import assert from 'node:assert/strict'
import fs from 'node:fs'

const docs = fs.readFileSync('../docs/reusable-event-checklist-templates.md', 'utf8')
assert.match(docs, /independent blueprint/)
assert.match(docs, /never live-links existing event tasks/)
console.log('Reusable event checklist template independence checks passed.')
