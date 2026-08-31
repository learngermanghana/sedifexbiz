import assert from 'node:assert/strict'
import fs from 'node:fs'
const manager = fs.readFileSync('src/components/EventChecklistTemplateManager.tsx', 'utf8')
assert.match(manager, /sortOrder: index \+ 1/)
assert.match(manager, /sortOrder: index \+ chunkIndex \+ 1/)
console.log('Reusable event checklist template order checks passed.')
