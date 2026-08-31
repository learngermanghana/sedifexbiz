import assert from 'node:assert/strict'
import fs from 'node:fs'

const manager = fs.readFileSync('src/components/EventChecklistTemplateManager.tsx', 'utf8')

assert.match(manager, /defaultOwner: task\.owner\.trim\(\)/)
assert.match(manager, /owner: item\.defaultOwner/)

console.log('Reusable event checklist template owner checks passed.')
