import assert from 'node:assert/strict'
import fs from 'node:fs'

const manager = fs.readFileSync('src/components/EventChecklistTemplateManager.tsx', 'utf8')

assert.match(manager, /templateId: template\.id/)
assert.match(manager, /templateName: template\.name/)
assert.match(manager, /status: 'todo'/)
assert.doesNotMatch(manager, /status: task\.status/)
assert.match(manager, /Duplicate task names were skipped/)
assert.match(manager, /Existing events will not be changed/)

console.log('Reusable event checklist copy-semantics checks passed.')
