const assert = require('assert')
const Module = require('module')
const { MockFirestore, MockTimestamp } = require('./helpers/mockFirestore.cjs')

let currentDefaultDb
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

async function runInitializeStoreCreatesWorkspaceTest() {
  currentDefaultDb = new MockFirestore()

  const { initializeStore, resolveStoreAccess } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'new-owner-uid',
      token: { email: 'fresh.owner@example.com', phone_number: '+15550000000' },
    },
  }

  const fixedNow = Date.parse('2024-01-01T00:00:00.000Z')
  const realDateNow = Date.now

  let initResult
  try {
    Date.now = () => fixedNow
    initResult = await initializeStore.run(
      {
        contact: {
          phone: ' +1 (555) 000-0000 ',
          firstSignupEmail: 'Fresh.Owner@Example.com',
          ownerName: ' Fresh Owner ',
          businessName: ' Fresh Retail ',
          country: '  United States ',
          town: '  Portland ',
          signupRole: 'team-member',
        },
        planId: 'pro',
      },
      context,
    )
  } finally {
    Date.now = realDateNow
  }
  assert.strictEqual(initResult.ok, true, 'Expected initializeStore to succeed')
  assert.ok(initResult.storeId, 'Expected initializeStore to return a storeId')

  const storeDoc = currentDefaultDb.getDoc(`stores/${initResult.storeId}`)
  assert.ok(storeDoc, 'Expected store document to be created')
  assert.strictEqual(storeDoc.ownerId, 'new-owner-uid')
  assert.strictEqual(storeDoc.status, 'Active')
  assert.strictEqual(storeDoc.contractStatus, 'Active')
  assert.strictEqual(storeDoc.ownerEmail, 'fresh.owner@example.com')
  assert.strictEqual(storeDoc.ownerName, 'Fresh Owner')
  assert.strictEqual(storeDoc.displayName, 'Fresh Retail')
  assert.strictEqual(storeDoc.businessName, 'Fresh Retail')
  assert.strictEqual(storeDoc.country, 'United States')
  assert.strictEqual(storeDoc.town, 'Portland')
  assert.strictEqual(storeDoc.planId, 'pro')
  assert.strictEqual(storeDoc.plan, 'Pro')
  assert.strictEqual(storeDoc.billingPlan, 'Pro')
  assert.strictEqual(storeDoc.paymentStatus, 'trial')
  assert.strictEqual(storeDoc.billing.planId, 'pro')
  assert.strictEqual(storeDoc.billing.plan, 'Pro')
  assert.strictEqual(storeDoc.billing.interval, 'monthly')
  const dayInMs = 24 * 60 * 60 * 1000
  const expectedContractEnd = fixedNow + 30 * dayInMs
  const expectedTrialEnd = fixedNow + 14 * dayInMs
  assert.strictEqual(storeDoc.contractStart._millis, fixedNow)
  assert.strictEqual(storeDoc.contractEnd._millis, expectedContractEnd)
  assert.strictEqual(storeDoc.contract.status, 'active')
  assert.strictEqual(storeDoc.contract.interval, 'monthly')
  assert.strictEqual(storeDoc.contract.planId, 'pro')
  assert.strictEqual(storeDoc.contract.plan, 'Pro')
  assert.strictEqual(storeDoc.billing.trialEndsAt._millis, expectedTrialEnd)
  assert.ok(storeDoc.updatedAt, 'Expected updatedAt to be set')
  assert.ok(storeDoc.createdAt, 'Expected createdAt to be set on new store')

  const defaultMemberDoc = currentDefaultDb.getDoc('teamMembers/new-owner-uid')
  assert.ok(defaultMemberDoc, 'Expected default database team member document to be created')
  assert.strictEqual(defaultMemberDoc.name, 'Fresh Owner')
  assert.strictEqual(defaultMemberDoc.companyName, 'Fresh Retail')
  assert.strictEqual(defaultMemberDoc.phone, '+1 (555) 000-0000')
  assert.strictEqual(defaultMemberDoc.firstSignupEmail, 'fresh.owner@example.com')
  assert.strictEqual(defaultMemberDoc.country, 'United States')
  assert.strictEqual(defaultMemberDoc.town, 'Portland')
  assert.strictEqual(defaultMemberDoc.signupRole, 'team-member')

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
