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
  delete require.cache[require.resolve('../lib/index.js')]
  return require('../lib/index.js')
}

async function runHandleUserCreateMergesRosterDataTest() {
  const existingCreatedAt = MockTimestamp.fromMillis(Date.parse('2024-05-01T12:00:00.000Z'))

  currentDefaultDb = new MockFirestore({
    'teamMembers/staff@example.com': {
      storeId: ' store-123 ',
      role: 'Staff',
      invitedBy: 'owner-1',
      firstSignupEmail: 'staff@example.com',
      name: 'Staff Sample',
      companyName: 'Sample Co',
      status: 'Active',
      contractStatus: 'Active',
      createdAt: existingCreatedAt,
    },
  })

  const { handleUserCreate } = loadFunctionsModule()

  await handleUserCreate.run({
    uid: 'staff-uid',
    email: 'Staff@example.com',
    phoneNumber: '+15555550123',
  })

  const rosterDoc = currentDefaultDb.getDoc('teamMembers/staff-uid')
  assert.ok(rosterDoc, 'Expected roster member document to be created')
  assert.strictEqual(rosterDoc.storeId, 'store-123')
  assert.strictEqual(rosterDoc.role, 'staff')
  assert.strictEqual(rosterDoc.invitedBy, 'owner-1')
  assert.strictEqual(rosterDoc.firstSignupEmail, 'staff@example.com')
  assert.strictEqual(rosterDoc.name, 'Staff Sample')
  assert.strictEqual(rosterDoc.companyName, 'Sample Co')
  assert.strictEqual(rosterDoc.status, 'Active')
  assert.strictEqual(rosterDoc.contractStatus, 'Active')
  assert.strictEqual(rosterDoc.email, 'Staff@example.com')
  assert.strictEqual(rosterDoc.phone, '+15555550123')
  assert.ok(rosterDoc.updatedAt, 'Expected updatedAt to be set')
  assert.ok(rosterDoc.createdAt, 'Expected createdAt to be set')

  const rosterEmailDoc = currentDefaultDb.getDoc('teamMembers/staff@example.com')
  assert.ok(rosterEmailDoc, 'Expected roster email document to remain')
  assert.strictEqual(rosterEmailDoc.uid, 'staff-uid')
  assert.strictEqual(rosterEmailDoc.storeId, 'store-123')
  assert.strictEqual(rosterEmailDoc.role, 'staff')
  assert.strictEqual(rosterEmailDoc.invitedBy, 'owner-1')
  assert.strictEqual(rosterEmailDoc.firstSignupEmail, 'staff@example.com')
  assert.strictEqual(rosterEmailDoc.createdAt._millis, existingCreatedAt._millis)
}

async function runHandleUserCreateSeedsDefaultStoreTest() {
  currentDefaultDb = new MockFirestore()

  const { handleUserCreate } = loadFunctionsModule()

  await handleUserCreate.run({
    uid: 'new-owner',
    email: 'Owner@example.com',
    phoneNumber: '+15555550111',
  })

  const rosterDoc = currentDefaultDb.getDoc('teamMembers/new-owner')
  assert.ok(rosterDoc, 'Expected roster member document to be created')
  assert.strictEqual(rosterDoc.storeId, 'new-owner')
  assert.strictEqual(rosterDoc.role, 'owner')
  assert.strictEqual(rosterDoc.email, 'Owner@example.com')
  assert.strictEqual(rosterDoc.phone, '+15555550111')

  const storeDoc = currentDefaultDb.getDoc('stores/new-owner')
  assert.ok(storeDoc, 'Expected default store to be created')
  assert.strictEqual(storeDoc.ownerId, 'new-owner')
  assert.strictEqual(storeDoc.ownerEmail, 'Owner@example.com')
  assert.strictEqual(storeDoc.status, 'Active')
  assert.strictEqual(storeDoc.contractStatus, 'Active')
  assert.deepStrictEqual(storeDoc.inventorySummary, {
    trackedSkus: 0,
    lowStockSkus: 0,
    incomingShipments: 0,
  })
  assert.ok(storeDoc.createdAt, 'Expected createdAt to be set')
  assert.ok(storeDoc.updatedAt, 'Expected updatedAt to be set')
}

async function run() {
  await runHandleUserCreateMergesRosterDataTest()
  await runHandleUserCreateSeedsDefaultStoreTest()
  console.log('handleUserCreate tests passed')
}

run()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    Module._load = originalLoad
  })
