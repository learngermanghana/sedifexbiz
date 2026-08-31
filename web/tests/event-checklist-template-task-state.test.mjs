import assert from 'node:assert/strict'
import fs from 'node:fs'

const manager = fs.readFileSync('src/components/EventChecklistTemplateManager.tsx', 'utf8')

assert.match(manager, /status: 'todo'/)
assert.match(manager, /nextCompletedCount = applyMode === 'replace' \? 0/)
assert.match(manager, /progress: nextProgress/)

console.log('Reusable event checklist template task-state checks passed.')
