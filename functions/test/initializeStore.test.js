const assert = require('assert')
const Module = require('module')
const { MockFirestore, MockTimestamp } = require('./helpers/mockFirestore')

let currentDefaultDb
let currentRosterDb
const apps = []

const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'firebase-admin') {
    const firestore = () => currentDefaultDb
    firestore.FieldValue = {
      serverTimestamp: () => ({ __mockServerTimestamp: true }),
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
        getUser: async () => null,
        setCustomUserClaims: async () => {},
        getUserByEmail: async () => {
          const err = new Error('not found')
          err.code = 'auth/user-not-found'
          throw err
        },
        updateUser: async () => {},
        createUser: async () => ({ uid: 'new-user' }),
      }),
    }
  }

  if (request === 'firebase-admin/firestore') {
    return {
      getFirestore: (_app, name) => (name === 'roster' ? currentRosterDb : currentDefaultDb),
    }
  }

  return originalLoad(request, parent, isMain)
}

function loadFunctionsModule() {
  apps.length = 0
  delete require.cache[require.resolve('../lib/firestore.js')]
  delete require.cache[require.resolve('../lib/index.js')]
  return require('../lib/index.js')
}

async function runInitializeStoreCreatesWorkspaceTest() {
  currentDefaultDb = new MockFirestore()
  currentRosterDb = new MockFirestore()

  const { initializeStore, resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'new-owner-uid',
      token: { email: 'fresh.owner@example.com', phone_number: '+15550000000' },
    },
  }

  const initResult = await initializeStore.run({}, context)
  assert.strictEqual(initResult.ok, true, 'Expected initializeStore to succeed')
  assert.ok(initResult.storeId, 'Expected initializeStore to return a storeId')

  const storeDoc = currentDefaultDb.getDoc(`stores/${initResult.storeId}`)
  assert.ok(storeDoc, 'Expected store document to be created')
  assert.strictEqual(storeDoc.ownerId, 'new-owner-uid')
  assert.strictEqual(storeDoc.status, 'Active')
  assert.strictEqual(storeDoc.contractStatus, 'Active')
  assert.ok(storeDoc.updatedAt, 'Expected updatedAt to be set')
  assert.ok(storeDoc.createdAt, 'Expected createdAt to be set on new store')

  const resolveResult = await resolveStoreAccess.run({}, context)
  assert.strictEqual(resolveResult.ok, true, 'Expected resolveStoreAccess to succeed')
  assert.strictEqual(resolveResult.storeId, initResult.storeId)
}

async function run() {
  await runInitializeStoreCreatesWorkspaceTest()
}

run()
  .then(() => {
    console.log('initializeStore tests passed')
  })
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
