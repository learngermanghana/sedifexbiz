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

async function runActiveStatusTest() {
  const expectedContractStart = Date.parse('2024-01-15T00:00:00.000Z')
  const expectedContractEnd = Date.parse('2024-12-31T00:00:00.000Z')

  currentDefaultDb = new MockFirestore({
    'stores/store-001': {
      status: 'Active',
      contractStart: MockTimestamp.fromMillis(expectedContractStart),
      contractEnd: MockTimestamp.fromMillis(expectedContractEnd),
      paymentStatus: 'Paid',
      amountPaid: 1234.56,
      company: 'Example Company',
      seedProducts: [
        { id: 'store-001-widget', name: 'Widget', price: 100, stockCount: 5 },
      ],
      seedCustomers: [
        { id: 'store-001-alice', name: 'Alice', email: 'alice@example.com' },
      ],
    },
  })
  currentRosterDb = new MockFirestore({
    'teamMembers/owner@example.com': {
      email: 'owner@example.com',
      storeId: 'store-001',
      role: 'Owner',
      name: 'Owner One',
      phone: '+15555550100',
      firstSignupEmail: 'owner@example.com',
      invitedBy: 'admin-user',
    },
  })

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'user-1',
      token: { email: 'owner@example.com' },
    },
  }

  const result = await resolveStoreAccess.run({ storeId: 'store-001' }, context)

  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.storeId, 'store-001')
  assert.strictEqual(result.role, 'owner')
  assert.ok(!('spreadsheetId' in result))

  const rosterDoc = currentRosterDb.getDoc('teamMembers/user-1')
  assert.ok(rosterDoc)
  assert.strictEqual(rosterDoc.storeId, 'store-001')
  assert.strictEqual(rosterDoc.email, 'owner@example.com')

  const rosterEmailDoc = currentRosterDb.getDoc('teamMembers/owner@example.com')
  assert.ok(rosterEmailDoc)
  assert.strictEqual(rosterEmailDoc.uid, 'user-1')

  const storeDoc = currentDefaultDb.getDoc('stores/store-001')
  assert.ok(storeDoc)
  assert.strictEqual(storeDoc.status, 'Active')
  assert.strictEqual(storeDoc.contractStart._millis, expectedContractStart)
  assert.strictEqual(storeDoc.contractEnd._millis, expectedContractEnd)
  assert.strictEqual(storeDoc.paymentStatus, 'Paid')
  assert.strictEqual(storeDoc.amountPaid, 1234.56)
  assert.strictEqual(storeDoc.company, 'Example Company')

  const productDoc = currentDefaultDb.getDoc('products/store-001-widget')
  assert.ok(productDoc)
  assert.strictEqual(productDoc.storeId, 'store-001')
  assert.strictEqual(productDoc.name, 'Widget')

  const customerDoc = currentDefaultDb.getDoc('customers/store-001-alice')
  assert.ok(customerDoc)
  assert.strictEqual(customerDoc.storeId, 'store-001')
  assert.strictEqual(customerDoc.name, 'Alice')

  assert.strictEqual(result.store.data.contractStart, expectedContractStart)
  assert.strictEqual(result.store.data.contractEnd, expectedContractEnd)
  assert.strictEqual(result.store.data.paymentStatus, 'Paid')
  assert.strictEqual(result.store.data.amountPaid, 1234.56)
  assert.strictEqual(result.store.data.company, 'Example Company')
  assert.strictEqual(result.products.length, 1)
  assert.strictEqual(result.products[0].id, 'store-001-widget')
  assert.strictEqual(result.customers.length, 1)
  assert.strictEqual(result.customers[0].id, 'store-001-alice')
}

async function runInactiveStatusTest() {
  currentDefaultDb = new MockFirestore({
    'stores/store-002': {
      status: 'Contract Terminated',
    },
  })
  currentRosterDb = new MockFirestore({
    'teamMembers/owner@example.com': {
      email: 'owner@example.com',
      storeId: 'store-002',
      role: 'Owner',
    },
  })

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'user-2',
      token: { email: 'owner@example.com' },
    },
  }

  let error
  try {
    await resolveStoreAccess.run({ storeId: 'store-002' }, context)
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

async function runStoreIdMismatchTest() {
  currentDefaultDb = new MockFirestore({
    'stores/store-777': { status: 'Active' },
  })
  currentRosterDb = new MockFirestore({
    'teamMembers/owner@example.com': {
      email: 'owner@example.com',
      storeId: 'store-777',
      role: 'Owner',
    },
  })

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'user-3',
      token: { email: 'owner@example.com' },
    },
  }

  let error
  try {
    await resolveStoreAccess.run({ storeId: 'store-abc' }, context)
  } catch (err) {
    error = err
  }

  assert.ok(error, 'Expected mismatch to throw')
  assert.strictEqual(error.code, 'permission-denied')
  assert.strictEqual(
    error.message,
    'Your account is assigned to store store-777. Enter the correct store ID to continue.',
  )
}

async function runMissingStoreIdTest() {
  currentDefaultDb = new MockFirestore({
    'stores/store-001': { status: 'Active' },
  })
  currentRosterDb = new MockFirestore({
    'teamMembers/owner@example.com': {
      email: 'owner@example.com',
      role: 'Owner',
    },
  })

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'user-4',
      token: { email: 'owner@example.com' },
    },
  }

  let error
  try {
    await resolveStoreAccess.run({ storeId: 'store-001' }, context)
  } catch (err) {
    error = err
  }

  assert.ok(error, 'Expected missing store ID to throw')
  assert.strictEqual(error.code, 'failed-precondition')
  assert.strictEqual(
    error.message,
    'We could not confirm the store ID assigned to your Sedifex workspace. Reach out to your Sedifex administrator.',
  )
}

async function run() {
  await runActiveStatusTest()
  await runInactiveStatusTest()
  await runStoreIdMismatchTest()
  await runMissingStoreIdTest()
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
