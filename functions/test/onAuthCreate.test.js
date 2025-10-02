const assert = require('assert')
const Module = require('module')
const { MockFirestore, MockTimestamp } = require('./helpers/mockFirestore')

let currentRosterDb
const apps = []

const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'firebase-admin') {
    const firestore = () => currentRosterDb
    firestore.FieldValue = {
      serverTimestamp: () => MockTimestamp.now(),
      increment: amount => ({ __mockIncrement: amount }),
    }
    firestore.Timestamp = MockTimestamp

    return {
      initializeApp: () => {
        const app = { name: 'mock-app' }
        apps[0] = app
        return app
      },
      app: () => apps[0] || null,
      apps,
      firestore,
      auth: () => ({
        getUser: async () => ({ customClaims: undefined }),
        getUserByEmail: async () => {
          const err = new Error('not found')
          err.code = 'auth/user-not-found'
          throw err
        },
        updateUser: async () => {},
        createUser: async () => ({ uid: 'new-user' }),
        setCustomUserClaims: async () => {},
      }),
    }
  }

  if (request === 'firebase-admin/firestore') {
    return {
      getFirestore: () => currentRosterDb,
    }
  }

  return originalLoad(request, parent, isMain)
}

function loadOnAuthCreate() {
  apps.length = 0
  delete require.cache[require.resolve('../lib/firestore.js')]
  delete require.cache[require.resolve('../lib/onAuthCreate.js')]
  return require('../lib/onAuthCreate.js')
}

async function runCreatesMembershipTest() {
  currentRosterDb = new MockFirestore()
  const { onAuthCreate } = loadOnAuthCreate()

  const user = {
    uid: 'owner-1234',
    email: 'owner@example.com',
    phoneNumber: '+15555550123',
  }

  await onAuthCreate.run(user, {})

  const record = currentRosterDb.getDoc('teamMembers/owner-1234')
  assert.strictEqual(record.uid, 'owner-1234')
  assert.strictEqual(record.storeId, 'owner-1234')
  assert.strictEqual(record.role, 'owner')
  assert.strictEqual(record.email, 'owner@example.com')
  assert.strictEqual(record.phone, '+15555550123')
  assert(record.createdAt)
  assert(record.updatedAt)
}

async function runPreservesExistingMetadataTest() {
  currentRosterDb = new MockFirestore({
    'teamMembers/staff-1': {
      storeId: 'store-xyz',
      role: 'staff',
      name: 'Invited Staff',
    },
  })
  const { onAuthCreate } = loadOnAuthCreate()

  const user = {
    uid: 'staff-1',
    email: 'staff@example.com',
  }

  await onAuthCreate.run(user, {})

  const record = currentRosterDb.getDoc('teamMembers/staff-1')
  assert.strictEqual(record.storeId, 'store-xyz')
  assert.strictEqual(record.role, 'staff')
  assert.strictEqual(record.email, 'staff@example.com')
  assert.strictEqual(record.name, 'Invited Staff')
}

async function run() {
  await runCreatesMembershipTest()
  await runPreservesExistingMetadataTest()
  console.log('onAuthCreate tests passed')
}

run()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    Module._load = originalLoad
  })
