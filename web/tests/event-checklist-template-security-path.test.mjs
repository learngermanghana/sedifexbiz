import assert from 'node:assert/strict'
import fs from 'node:fs'

const manager = fs.readFileSync('src/components/EventChecklistTemplateManager.tsx', 'utf8')
const rules = fs.readFileSync('../firestore.rules', 'utf8')

assert.match(manager, /'stores', storeId, 'events', '__templates', 'checklists'/)
assert.match(rules, /match \/stores\/\{storeId\}\/events\/\{eventId\}\/\{eventCollection\}\/\{document=\*\*\}/)
assert.match(rules, /allow read, create, update, delete: if hasStoreAccess\(storeId\)/)

console.log('Reusable event checklist template security-path checks passed.')
