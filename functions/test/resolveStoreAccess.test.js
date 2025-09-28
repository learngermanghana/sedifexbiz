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
      contractStart: '2024-01-15',
      contract_end: '2024-12-31',
      payment_status: 'Paid',
      amount_paid: '$1,234.56',
      company: 'Example Company',
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

  const expectedContractStart = Date.parse('2024-01-15T00:00:00.000Z')
  const expectedContractEnd = Date.parse('2024-12-31T00:00:00.000Z')

  const rosterDoc = currentRosterDb.getDoc('teamMembers/user-1')
  assert.ok(rosterDoc)
  assert.strictEqual(rosterDoc.storeId, 'store-001')

  const storeDoc = currentDefaultDb.getDoc('stores/store-001')
  assert.ok(storeDoc)
  assert.strictEqual(storeDoc.status, 'Active')
  assert.strictEqual(storeDoc.contractStart._millis, expectedContractStart)
  assert.strictEqual(storeDoc.contractEnd._millis, expectedContractEnd)
  assert.strictEqual(storeDoc.paymentStatus, 'Paid')
  assert.strictEqual(storeDoc.amountPaid, 1234.56)
  assert.strictEqual(storeDoc.company, 'Example Company')

  assert.strictEqual(result.store.data.contractStart, expectedContractStart)
  assert.strictEqual(result.store.data.contractEnd, expectedContractEnd)
  assert.strictEqual(result.store.data.paymentStatus, 'Paid')
  assert.strictEqual(result.store.data.amountPaid, 1234.56)
  assert.strictEqual(result.store.data.company, 'Example Company')
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
