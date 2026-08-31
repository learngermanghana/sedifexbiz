import assert from 'node:assert/strict'
import fs from 'node:fs'

const manager = fs.readFileSync('src/components/EventChecklistTemplateManager.tsx', 'utf8')

for (const field of ['name', 'eventType', 'taskCount', 'items', 'sourceEventId', 'sourceEventTitle', 'usageCount']) {
  assert.match(manager, new RegExp(`${field}:`))
}
for (const field of ['title', 'category', 'defaultOwner', 'dueOffsetDays', 'priority', 'notes', 'sortOrder']) {
  assert.match(manager, new RegExp(`${field}:`))
}

console.log('Reusable event checklist template storage-shape checks passed.')
