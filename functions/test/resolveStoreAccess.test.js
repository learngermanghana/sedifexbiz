const assert = require('assert')
const Module = require('module')
const path = require('path')
const { MockFirestore, MockTimestamp } = require('./helpers/mockFirestore')

let currentDefaultDb
let currentRosterDb
let sheetRowMock
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

  if (request === './googleSheets' || request.endsWith(`${path.sep}googleSheets`)) {
    return {
      fetchClientRowByEmail: async () => sheetRowMock,
      getDefaultSpreadsheetId: () => 'sheet-123',
    }
  }

  return originalLoad(request, parent, isMain)
}

function loadFunctionsModule() {
  apps.length = 0
  delete require.cache[require.resolve('../lib/firestore.js')]
  delete require.cache[require.resolve('../lib/googleSheets.js')]
  delete require.cache[require.resolve('../lib/index.js')]
  return require('../lib/index.js')
}

async function runActiveStatusTest() {
  currentDefaultDb = new MockFirestore()
  currentRosterDb = new MockFirestore()
  sheetRowMock = {
    spreadsheetId: 'sheet-123',
    headers: [],
    normalizedHeaders: [],
    values: [],
    record: {
      store_id: 'store-001',
      store_status: 'Active',
      role: 'Owner',
      member_email: 'owner@example.com',
      member_name: 'Owner One',
    },
  }

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'user-1',
      token: { email: 'owner@example.com' },
    },
  }

  const result = await resolveStoreAccess.run({}, context)

  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.storeId, 'store-001')
  assert.strictEqual(result.role, 'owner')

  const rosterDoc = currentRosterDb.getDoc('teamMembers/user-1')
  assert.ok(rosterDoc)
  assert.strictEqual(rosterDoc.storeId, 'store-001')

  const storeDoc = currentDefaultDb.getDoc('stores/store-001')
  assert.ok(storeDoc)
  assert.strictEqual(storeDoc.status, 'Active')
}

async function runInactiveStatusTest() {
  currentDefaultDb = new MockFirestore()
  currentRosterDb = new MockFirestore()
  sheetRowMock = {
    spreadsheetId: 'sheet-123',
    headers: [],
    normalizedHeaders: [],
    values: [],
    record: {
      store_id: 'store-002',
      status: 'Contract Terminated',
      member_email: 'owner@example.com',
    },
  }

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'user-2',
      token: { email: 'owner@example.com' },
    },
  }

  let error
  try {
    await resolveStoreAccess.run({}, context)
  } catch (err) {
    error = err
  }

  assert.ok(error, 'Expected inactive contract to throw')
  assert.strictEqual(error.code, 'permission-denied')
  assert.match(
    error.message,
    /workspace contract is not active/i,
    'Expected inactive status rejection message',
  )
}

async function run() {
  await runActiveStatusTest()
  await runInactiveStatusTest()
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
