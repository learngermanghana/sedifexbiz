const assert = require('assert')
const Module = require('module')
const { MockFirestore, MockTimestamp } = require('./helpers/mockFirestore')

let currentDefaultDb
const apps = []

const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'firebase-admin') {
    const firestore = () => currentDefaultDb
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
      getFirestore: () => currentDefaultDb,
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

async function runSuccessTest() {
  currentDefaultDb = new MockFirestore({
    'teamMembers/user-1': { storeId: 'store-123', role: 'owner' },
  })

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'user-1',
      token: {},
    },
  }

  const result = await resolveStoreAccess.run({}, context)

  assert.deepStrictEqual(result, { ok: true, storeId: 'store-123', role: 'owner' })
}

async function runMissingMembershipTest() {
  currentDefaultDb = new MockFirestore()

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'user-2',
      token: {},
    },
  }

  const result = await resolveStoreAccess.run({}, context)

  assert.deepStrictEqual(result, { ok: false, error: 'NO_MEMBERSHIP' })
}

async function runInvalidMembershipTest() {
  currentDefaultDb = new MockFirestore({
    'teamMembers/user-3': { storeId: '', role: 'viewer' },
  })

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'user-3',
      token: {},
    },
  }

  const result = await resolveStoreAccess.run({}, context)

  assert.deepStrictEqual(result, { ok: false, error: 'NO_MEMBERSHIP' })
}

async function run() {
  await runSuccessTest()
  await runMissingMembershipTest()
  await runInvalidMembershipTest()
  console.log('resolveStoreAccess tests passed')
}

run()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    Module._load = originalLoad
  })
