import assert from 'node:assert/strict'
import fs from 'node:fs'

const manager = fs.readFileSync('src/components/EventChecklistTemplateManager.tsx', 'utf8')
const workspace = fs.readFileSync('src/components/EventOperationsWorkspace.tsx', 'utf8')

assert.match(manager, /'stores', storeId, 'events', '__templates', 'checklists'/)
assert.match(manager, /dueOffsetDays/)
assert.match(manager, /taskOffsetDays\(eventDate, task\.dueDate\)/)
assert.match(manager, /dateFromOffset\(eventDate, item\.dueOffsetDays\)/)
assert.match(manager, /status: 'todo'/)
assert.match(manager, /normalizeTitle\(task\.title\)/)
assert.match(manager, /Add missing tasks/)
assert.match(manager, /Replace current checklist/)
assert.match(manager, /checklistTaskCount: nextTaskCount/)
assert.match(manager, /checklistCompletedCount: nextCompletedCount/)
assert.match(manager, /Existing events will not be changed/)

assert.match(workspace, /import EventChecklistTemplateManager from '\.\/EventChecklistTemplateManager'/)
assert.match(workspace, /<EventChecklistTemplateManager/)
assert.match(workspace, /eventType=\{meta\.eventType\}/)
assert.match(workspace, /eventDate=\{meta\.eventDate\}/)
assert.match(workspace, /tasks=\{tasks\}/)
assert.match(workspace, /onApplied=\{refreshChecklistTasks\}/)

console.log('Reusable event checklist template regression checks passed.')
