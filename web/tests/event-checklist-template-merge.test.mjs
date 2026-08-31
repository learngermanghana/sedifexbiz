import assert from 'node:assert/strict'
import fs from 'node:fs'

const manager = fs.readFileSync('src/components/EventChecklistTemplateManager.tsx', 'utf8')

assert.match(manager, /existingTitles = new Set\(tasks\.map\(task => normalizeTitle\(task\.title\)\)\)/)
assert.match(manager, /selectedTemplate\.items\.filter\(item => !existingTitles\.has\(normalizeTitle\(item\.title\)\)\)/)
assert.match(manager, /applyMode === 'replace'/)
assert.match(manager, /commitDeleteChunks/)
assert.match(manager, /commitAddChunks/)

console.log('Reusable event checklist template merge checks passed.')
