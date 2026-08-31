import assert from 'node:assert/strict'
import fs from 'node:fs'

const manager = fs.readFileSync('src/components/EventChecklistTemplateManager.tsx', 'utf8')
const workspace = fs.readFileSync('src/components/EventOperationsWorkspace.tsx', 'utf8')
const rules = fs.readFileSync('../firestore.rules', 'utf8')
const docs = fs.readFileSync('../docs/reusable-event-checklist-templates.md', 'utf8')

// Store-scoped storage stays inside the existing Event Planning security boundary.
assert.match(manager, /'stores', storeId, 'events', '__templates', 'checklists'/)
assert.match(rules, /match \/stores\/\{storeId\}\/events\/\{eventId\}\/\{eventCollection\}\/\{document=\*\*\}/)
assert.match(rules, /allow read, create, update, delete: if hasStoreAccess\(storeId\)/)

// Saving a template preserves reusable planning fields and converts dates to offsets.
for (const field of ['name', 'eventType', 'taskCount', 'items', 'sourceEventId', 'sourceEventTitle', 'usageCount']) {
  assert.match(manager, new RegExp(`${field}:`))
}
for (const field of ['title', 'category', 'defaultOwner', 'dueOffsetDays', 'priority', 'notes', 'sortOrder']) {
  assert.match(manager, new RegExp(`${field}:`))
}
assert.match(manager, /taskOffsetDays\(eventDate, task\.dueDate\)/)
assert.match(manager, /dateFromOffset\(eventDate, item\.dueOffsetDays\)/)
assert.match(manager, /defaultOwner: task\.owner\.trim\(\)/)
assert.match(manager, /owner: item\.defaultOwner/)

// Applying a template copies tasks independently and never carries completion state.
assert.match(manager, /templateId: template\.id/)
assert.match(manager, /templateName: template\.name/)
assert.match(manager, /status: 'todo'/)
assert.doesNotMatch(manager, /status: task\.status/)
assert.match(manager, /nextCompletedCount = applyMode === 'replace' \? 0/)
assert.match(manager, /progress: nextProgress/)
assert.match(manager, /sortOrder: index \+ chunkIndex \+ 1/)

// Merge skips normalized duplicate titles; replace explicitly deletes current tasks.
assert.match(manager, /existingTitles = new Set\(tasks\.map\(task => normalizeTitle\(task\.title\)\)\)/)
assert.match(manager, /selectedTemplate\.items\.filter\(item => !existingTitles\.has\(normalizeTitle\(item\.title\)\)\)/)
assert.match(manager, /commitDeleteChunks/)
assert.match(manager, /commitAddChunks/)
assert.match(manager, /Add missing tasks/)
assert.match(manager, /Replace current checklist/)
assert.match(manager, /Duplicate task names were skipped/)

// Template deletion does not mutate any event that already received copied tasks.
assert.match(manager, /deleteDoc\(doc\(templatesRef, selectedTemplate\.id\)\)/)
assert.match(manager, /Existing event checklists were left unchanged/)
assert.match(docs, /independent blueprint/)
assert.match(docs, /never live-links existing event tasks/)

// The manager is mounted directly in the live Checklist tab.
assert.match(workspace, /import EventChecklistTemplateManager from '\.\/EventChecklistTemplateManager'/)
assert.match(workspace, /<EventChecklistTemplateManager/)
assert.match(workspace, /eventType=\{meta\.eventType\}/)
assert.match(workspace, /eventDate=\{meta\.eventDate\}/)
assert.match(workspace, /tasks=\{tasks\}/)
assert.match(workspace, /onApplied=\{refreshChecklistTasks\}/)
assert.match(manager, /Save current as template/)
assert.match(manager, /Use template/)
assert.match(manager, /Delete template/)

console.log('Reusable event checklist template regression checks passed.')
