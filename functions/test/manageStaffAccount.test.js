const assert = require('assert')
const path = require('path')
const { installFirebaseAdminStub } = require('./helpers/setupFirebaseAdmin')

async function run() {
  const restoreAdmin = installFirebaseAdminStub()
  process.env.PERSISTENCE_DRIVER = 'memory'

  delete require.cache[path.resolve(__dirname, '../lib/functions/src/persistence.js')]
  delete require.cache[path.resolve(__dirname, '../lib/functions/src/index.js')]

  const persistence = require('../lib/functions/src/persistence.js')
  const adapter = persistence.createMemoryPersistence()
  persistence.setPersistenceAdapter(adapter)

  const { manageStaffAccount } = require('../lib/functions/src/index.js')

  await adapter.upsertTeamMember({
    uid: 'owner-1',
    storeId: 'store-123',
    role: 'owner',
    email: 'owner@example.com',
  })

  const context = { auth: { uid: 'owner-1', token: { role: 'owner', activeStoreId: 'store-123' } } }

  const response = await manageStaffAccount.run(
    {
      storeId: 'store-123',
      email: 'staff@example.com',
      role: 'staff',
      password: 'temporaryPassword123',
    },
    context,
  )

  assert.strictEqual(response.ok, true)
  assert.strictEqual(response.storeId, 'store-123')
  assert.strictEqual(response.role, 'staff')

  const staff = await adapter.getTeamMember(response.uid)
  assert.ok(staff, 'Expected staff membership to be created')
  assert.strictEqual(staff?.storeId, 'store-123')
  assert.strictEqual(staff?.role, 'staff')

  restoreAdmin()
  console.log('manageStaffAccount tests passed')
}

run().catch(err => {
  console.error(err)
  process.exitCode = 1
})
