const assert = require('node:assert/strict')
const {
  changedEventFields,
  getEventAuditAction,
  isAuditMetadataOnlyUpdate,
} = require('../lib/eventAuditCore')

assert.equal(getEventAuditAction(null, { title: 'Wedding' }), 'created')
assert.equal(getEventAuditAction({ title: 'Wedding' }, { title: 'Wedding' }), 'updated')
assert.equal(getEventAuditAction({ title: 'Wedding' }, null), 'deleted')
assert.equal(getEventAuditAction(null, null), null)

assert.deepEqual(
  changedEventFields(
    { title: 'Wedding', status: 'planning', progress: 20 },
    { title: 'Wedding', status: 'confirmed', progress: 80 },
  ),
  ['progress', 'status'],
)

assert.equal(
  isAuditMetadataOnlyUpdate(
    { title: 'Wedding', updatedBy: null, auditUpdatedAt: null },
    { title: 'Wedding', updatedBy: 'user-1', auditUpdatedAt: 'timestamp' },
  ),
  true,
)

assert.equal(
  isAuditMetadataOnlyUpdate(
    { title: 'Wedding', updatedBy: 'user-1' },
    { title: 'Reception', updatedBy: 'user-1' },
  ),
  false,
)

console.log('eventAudit tests passed')
