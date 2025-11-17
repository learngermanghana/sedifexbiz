const assert = require('assert')
const Module = require('module')
const { MockFirestore, MockTimestamp } = require('./helpers/mockFirestore.cjs')

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
      getFirestore: (_app, databaseId) =>
        databaseId === 'roster' ? currentRosterDb || currentDefaultDb : currentDefaultDb,
    }
  }

  return originalLoad(request, parent, isMain)
}

function loadFunctionsModule() {
  apps.length = 0
  delete require.cache[require.resolve('../lib/firestore.js')]
  delete require.cache[require.resolve('../lib/workspaces.js')]
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
  currentRosterDb = currentDefaultDb

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
    assert.strictEqual(result.teamMember.data.workspaceSlug, 'store-001')

    const rosterDoc = currentDefaultDb.getDoc('teamMembers/user-1')
    assert.ok(rosterDoc)
    assert.strictEqual(rosterDoc.storeId, 'store-001')
    assert.strictEqual(rosterDoc.email, 'owner@example.com')
    assert.strictEqual(rosterDoc.workspaceSlug, 'store-001')

    const rosterEmailDoc = currentDefaultDb.getDoc('teamMembers/owner@example.com')
    assert.ok(rosterEmailDoc)
    assert.strictEqual(rosterEmailDoc.uid, 'user-1')
    assert.strictEqual(rosterEmailDoc.workspaceSlug, 'store-001')

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
    'teamMembers/owner@example.com': {
      email: 'owner@example.com',
      storeId: 'store-002',
      role: 'Owner',
    },
  })
  currentRosterDb = currentDefaultDb

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

async function runStoreOwnerFallbackTest() {
  currentDefaultDb = new MockFirestore({
    'stores/owner-123': { status: 'Active', ownerId: 'legacy-store' },
    'teamMembers/owner@example.com': {
      email: 'owner@example.com',
      storeId: 'legacy-store',
      role: 'Owner',
    },
  })
  currentRosterDb = currentDefaultDb

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'user-5',
      token: { email: 'owner@example.com' },
    },
  }

  const result = await resolveStoreAccess.run({ storeId: 'legacy-store' }, context)

  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.storeId, 'legacy-store')
  assert.strictEqual(result.role, 'owner')
  assert.strictEqual(result.store.id, 'owner-123')

  const rosterDoc = currentDefaultDb.getDoc('teamMembers/user-5')
  assert.ok(rosterDoc)
  assert.strictEqual(rosterDoc.storeId, 'legacy-store')

  const storeDoc = currentDefaultDb.getDoc('stores/owner-123')
  assert.ok(storeDoc)
  assert.strictEqual(storeDoc.ownerId, 'legacy-store')
}

async function runStoreIdMismatchTest() {
  currentDefaultDb = new MockFirestore({
    'stores/store-777': { status: 'Active' },
    'teamMembers/owner@example.com': {
      email: 'owner@example.com',
      storeId: 'store-777',
      role: 'Owner',
    },
  })
  currentRosterDb = currentDefaultDb

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
    'teamMembers/owner@example.com': {
      email: 'owner@example.com',
      role: 'Owner',
    },
  })
  currentRosterDb = currentDefaultDb

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
      'We could not confirm the workspace assigned to your Sedifex account. Reach out to your Sedifex administrator.',
    )
}

async function runManagedStaffAccessTest() {
  currentDefaultDb = new MockFirestore({
    'stores/store-003': { status: 'Active' },
  })
  currentRosterDb = currentDefaultDb

  const { manageStaffAccount, resolveStoreAccess } = loadFunctionsModule()

  const ownerContext = {
    auth: {
      uid: 'owner-1',
      token: { role: 'owner' },
    },
  }

  const manageResult = await manageStaffAccount.run(
    { storeId: 'store-003', email: 'staff@example.com', role: 'staff', password: 'password123' },
    ownerContext,
  )

  assert.strictEqual(manageResult.ok, true)
  assert.strictEqual(manageResult.uid, 'new-user')

  const rosterByUid = currentDefaultDb.getDoc('teamMembers/new-user')
  assert.ok(rosterByUid)
  assert.strictEqual(rosterByUid.storeId, 'store-003')
  assert.strictEqual(rosterByUid.role, 'staff')
  assert.strictEqual(rosterByUid.email, 'staff@example.com')

  const rosterByEmail = currentDefaultDb.getDoc('teamMembers/staff@example.com')
  assert.ok(rosterByEmail)
  assert.strictEqual(rosterByEmail.storeId, 'store-003')
  assert.strictEqual(rosterByEmail.role, 'staff')
  assert.strictEqual(rosterByEmail.uid, 'new-user')

  currentDefaultDb.setRaw('teamMembers/staff@example.com', undefined)

  const context = {
    auth: {
      uid: 'new-user',
      token: { email: 'staff@example.com' },
    },
  }

  const result = await resolveStoreAccess.run({ storeId: 'store-003' }, context)

  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.storeId, 'store-003')
  assert.strictEqual(result.role, 'staff')

  const restoredEmailDoc = currentDefaultDb.getDoc('teamMembers/staff@example.com')
  assert.ok(restoredEmailDoc)
  assert.strictEqual(restoredEmailDoc.uid, 'new-user')
}

async function runMissingEmailTokenTest() {
  currentDefaultDb = new MockFirestore({
    'stores/store-010': { status: 'Active' },
    'teamMembers/user-10': {
      storeId: 'store-010',
      role: 'staff',
      email: 'staffless@example.com',
      invitedBy: 'owner-9',
    },
  })
  currentRosterDb = currentDefaultDb

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'user-10',
      token: {},
    },
  }

  const result = await resolveStoreAccess.run({}, context)

  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.storeId, 'store-010')
  assert.strictEqual(result.role, 'staff')

  const rosterDoc = currentDefaultDb.getDoc('teamMembers/user-10')
  assert.ok(rosterDoc)
  assert.strictEqual(rosterDoc.storeId, 'store-010')
  assert.strictEqual(rosterDoc.role, 'staff')
  assert.strictEqual(rosterDoc.invitedBy, 'owner-9')
  assert.strictEqual(rosterDoc.email, 'staffless@example.com')
}

async function runNestedSerializationTest() {
  const contractStart = Date.parse('2024-04-01T00:00:00.000Z')
  const contractEnd = Date.parse('2025-04-01T00:00:00.000Z')

  currentDefaultDb = new MockFirestore({
    'stores/store-nested': {
      status: 'Active',
      profile: {
        contract: {
          start: MockTimestamp.fromMillis(contractStart),
          end: MockTimestamp.fromMillis(contractEnd),
        },
        reminders: [
          {
            sentAt: MockTimestamp.fromMillis(contractStart),
          },
        ],
      },
    },
    'teamMembers/nested-owner@example.com': {
      email: 'nested-owner@example.com',
      storeId: 'store-nested',
      role: 'Owner',
    },
  })
  currentRosterDb = currentDefaultDb

  const { resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'nested-user',
      token: { email: 'nested-owner@example.com' },
    },
  }

  const result = await resolveStoreAccess.run({ storeId: 'store-nested' }, context)

  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.storeId, 'store-nested')
  assert.strictEqual(result.role, 'owner')
  assert.ok(result.store)
  assert.strictEqual(result.store.data.profile.contract.start, contractStart)
  assert.strictEqual(result.store.data.profile.contract.end, contractEnd)
  assert.strictEqual(result.store.data.profile.reminders[0].sentAt, contractStart)
}

async function run() {
  await runActiveStatusTest()
  await runInactiveStatusTest()
  await runStoreOwnerFallbackTest()
  await runStoreIdMismatchTest()
  await runMissingStoreIdTest()
  await runManagedStaffAccessTest()
  await runMissingEmailTokenTest()
  await runNestedSerializationTest()
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
