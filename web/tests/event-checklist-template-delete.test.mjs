import assert from 'node:assert/strict'
import fs from 'node:fs'

const manager = fs.readFileSync('src/components/EventChecklistTemplateManager.tsx', 'utf8')

assert.match(manager, /deleteDoc\(doc\(templatesRef, selectedTemplate\.id\)\)/)
assert.match(manager, /Existing event checklists were left unchanged/)

console.log('Reusable event checklist template deletion checks passed.')
