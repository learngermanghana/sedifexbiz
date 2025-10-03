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

  const { resolveStoreAccess } = require('../lib/functions/src/index.js')

  await adapter.upsertTeamMember({
    uid: 'user-1',
    storeId: 'store-123',
    role: 'owner',
    email: 'owner@example.com',
  })

  const success = await resolveStoreAccess.run({}, { auth: { uid: 'user-1', token: {} } })
  assert.deepStrictEqual(success, { ok: true, storeId: 'store-123', role: 'owner' })

  const missing = await resolveStoreAccess.run({}, { auth: { uid: 'user-2', token: {} } })
  assert.deepStrictEqual(missing, { ok: false, error: 'NO_MEMBERSHIP' })

  restoreAdmin()
  console.log('resolveStoreAccess tests passed')
}

run().catch(err => {
  console.error(err)
  process.exitCode = 1
})
