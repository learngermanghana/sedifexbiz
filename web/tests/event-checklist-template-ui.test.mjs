import assert from 'node:assert/strict'
import fs from 'node:fs'

const manager = fs.readFileSync('src/components/EventChecklistTemplateManager.tsx', 'utf8')

assert.match(manager, /Save current as template/)
assert.match(manager, /Use template/)
assert.match(manager, /Delete template/)
assert.match(manager, /Add missing tasks/)
assert.match(manager, /Replace current checklist/)

console.log('Reusable event checklist template UI checks passed.')
