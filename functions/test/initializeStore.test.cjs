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

  const initResult = await initializeStore.run(
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
    },
    context,
  )
  assert.strictEqual(initResult.ok, true, 'Expected initializeStore to succeed')
  assert.ok(initResult.storeId, 'Expected initializeStore to return a storeId')

  const storeDoc = currentDefaultDb.getDoc(`stores/${initResult.storeId}`)
  assert.ok(storeDoc, 'Expected store document to be created')
  assert.strictEqual(storeDoc.ownerId, 'new-owner-uid')
  assert.strictEqual(storeDoc.status, 'Active')
  assert.strictEqual(storeDoc.contractStatus, 'Active')
  assert.strictEqual(storeDoc.workspaceSlug, initResult.storeId)
  assert.strictEqual(storeDoc.ownerEmail, 'fresh.owner@example.com')
  assert.strictEqual(storeDoc.ownerName, 'Fresh Owner')
  assert.strictEqual(storeDoc.displayName, 'Fresh Retail')
  assert.strictEqual(storeDoc.businessName, 'Fresh Retail')
  assert.strictEqual(storeDoc.country, 'United States')
  assert.strictEqual(storeDoc.town, 'Portland')
  assert.ok(storeDoc.updatedAt, 'Expected updatedAt to be set')
  assert.ok(storeDoc.createdAt, 'Expected createdAt to be set on new store')
  assert.ok(storeDoc.contractStart, 'Expected contractStart to be set on new store')
  assert.ok(storeDoc.contractEnd, 'Expected contractEnd to be set on new store')
  assert.ok(storeDoc.billing, 'Expected billing info to be stored')
  assert.strictEqual(storeDoc.billing.planId, 'starter')
  assert.strictEqual(storeDoc.billing.status, 'trial')
  assert.strictEqual(storeDoc.billing.provider, 'paystack')
  assert.ok(storeDoc.billing.trialEndsAt, 'Expected trialEndsAt to be set on billing info')

  const defaultMemberDoc = currentDefaultDb.getDoc('teamMembers/new-owner-uid')
  assert.ok(defaultMemberDoc, 'Expected default database team member document to be created')
  assert.strictEqual(defaultMemberDoc.name, 'Fresh Owner')
  assert.strictEqual(defaultMemberDoc.companyName, 'Fresh Retail')
  assert.strictEqual(defaultMemberDoc.phone, '+1 (555) 000-0000')
  assert.strictEqual(defaultMemberDoc.firstSignupEmail, 'fresh.owner@example.com')
  assert.strictEqual(defaultMemberDoc.country, 'United States')
  assert.strictEqual(defaultMemberDoc.town, 'Portland')
  assert.strictEqual(defaultMemberDoc.signupRole, 'team-member')
  assert.strictEqual(defaultMemberDoc.workspaceSlug, initResult.storeId)

  const workspaceDoc = currentDefaultDb.getDoc(`workspaces/${initResult.storeId}`)
  assert.ok(workspaceDoc, 'Expected workspace document to be created')
  assert.strictEqual(workspaceDoc.slug, initResult.storeId)
  assert.strictEqual(workspaceDoc.storeId, initResult.storeId)
  assert.strictEqual(workspaceDoc.planId, 'starter')
  assert.strictEqual(workspaceDoc.status, 'active')
  assert.strictEqual(workspaceDoc.contractStatus, 'active')
  assert.strictEqual(workspaceDoc.paymentStatus, 'trial')
  assert.strictEqual(workspaceDoc.ownerEmail, 'fresh.owner@example.com')
  assert.strictEqual(workspaceDoc.ownerPhone, '+1 (555) 000-0000')
  assert.strictEqual(workspaceDoc.ownerName, 'Fresh Owner')
  assert.strictEqual(workspaceDoc.company, 'Fresh Retail')
  assert.strictEqual(workspaceDoc.displayName, 'Fresh Retail')
  assert.strictEqual(workspaceDoc.firstSignupEmail, 'fresh.owner@example.com')
  assert.ok(workspaceDoc.contractStart, 'Expected workspace contractStart to be set')
  assert.ok(workspaceDoc.contractEnd, 'Expected workspace contractEnd to be set')

  const initialContractStart = storeDoc.contractStart?._millis ?? null
  const initialContractEnd = storeDoc.contractEnd?._millis ?? null
  const initialTrialEndsAt = storeDoc.billing.trialEndsAt?._millis ?? null
  const initialWorkspaceContractEnd = workspaceDoc.contractEnd?._millis ?? null

  const resolveResult = await resolveStoreAccess.run({}, context)
  assert.strictEqual(resolveResult.ok, true, 'Expected resolveStoreAccess to succeed')
  assert.strictEqual(resolveResult.storeId, initResult.storeId)

  const rerunResult = await initializeStore.run({}, context)
  assert.strictEqual(rerunResult.ok, true, 'Expected initializeStore to remain idempotent')

  const updatedStoreDoc = currentDefaultDb.getDoc(`stores/${initResult.storeId}`)
  assert.ok(updatedStoreDoc, 'Expected store document to persist after rerun')
  assert.strictEqual(updatedStoreDoc.contractStart._millis, initialContractStart)
  assert.strictEqual(updatedStoreDoc.contractEnd._millis, initialContractEnd)
  assert.strictEqual(updatedStoreDoc.billing.trialEndsAt._millis, initialTrialEndsAt)

  const updatedWorkspaceDoc = currentDefaultDb.getDoc(`workspaces/${initResult.storeId}`)
  assert.ok(updatedWorkspaceDoc, 'Expected workspace document to persist after rerun')
  assert.strictEqual(updatedWorkspaceDoc.contractEnd._millis, initialWorkspaceContractEnd)
}

async function runInitializeStoreRejectsInvalidPlanTest() {
  currentDefaultDb = new MockFirestore()

  const { initializeStore } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'plan-owner',
      token: { email: 'plan.owner@example.com' },
    },
  }

  let error
  try {
    await initializeStore.run({ planId: 'not-a-real-plan' }, context)
  } catch (err) {
    error = err
  }

  assert.ok(error, 'Expected initializeStore to reject an invalid planId')
  assert.strictEqual(error.code, 'invalid-argument')
}

async function runInitializeStorePreservesExistingContractWindowTest() {
  const initialContractStart = MockTimestamp.fromMillis(Date.parse('2024-02-01T00:00:00.000Z'))
  const initialContractEnd = MockTimestamp.fromMillis(Date.parse('2024-03-01T00:00:00.000Z'))
  const initialTrialEndsAt = MockTimestamp.fromMillis(Date.parse('2024-03-01T00:00:00.000Z'))

  currentDefaultDb = new MockFirestore({
    'stores/existing-store': {
      ownerId: 'existing-owner-uid',
      status: 'Paused',
      contractStatus: 'Paused',
      contractStart: initialContractStart,
      contractEnd: initialContractEnd,
      billing: {
        planId: 'pro',
        status: 'active',
        provider: 'paystack',
        trialEndsAt: initialTrialEndsAt,
      },
    },
    'workspaces/existing-store': {
      slug: 'existing-store',
      storeId: 'existing-store',
      planId: 'pro',
      status: 'paused',
      contractStatus: 'paused',
      paymentStatus: 'active',
      contractStart: initialContractStart,
      contractEnd: initialContractEnd,
    },
    'teamMembers/existing-owner-uid': {
      uid: 'existing-owner-uid',
      storeId: 'existing-store',
      role: 'owner',
      email: 'existing.owner@example.com',
    },
  })

  const { initializeStore } = loadFunctionsModule()
  const context = {
    auth: {
      uid: 'existing-owner-uid',
      token: { email: 'existing.owner@example.com', phone_number: '+15551230000' },
    },
  }

  const result = await initializeStore.run({ planId: 'enterprise' }, context)
  assert.strictEqual(result.ok, true, 'Expected initializeStore to succeed for existing workspace')
  assert.strictEqual(result.storeId, 'existing-store')

  const storeDoc = currentDefaultDb.getDoc('stores/existing-store')
  assert.ok(storeDoc, 'Expected existing store document to remain')
  assert.strictEqual(storeDoc.contractStart._millis, initialContractStart._millis)
  assert.strictEqual(storeDoc.contractEnd._millis, initialContractEnd._millis)
  assert.strictEqual(storeDoc.billing.trialEndsAt._millis, initialTrialEndsAt._millis)
  assert.strictEqual(storeDoc.billing.planId, 'enterprise')
  assert.strictEqual(storeDoc.status, 'Paused')
  assert.strictEqual(storeDoc.contractStatus, 'Paused')
  assert.strictEqual(storeDoc.workspaceSlug, 'existing-store')

  const workspaceDoc = currentDefaultDb.getDoc('workspaces/existing-store')
  assert.ok(workspaceDoc, 'Expected existing workspace document to remain')
  assert.strictEqual(workspaceDoc.planId, 'enterprise')
  assert.strictEqual(workspaceDoc.contractStart._millis, initialContractStart._millis)
  assert.strictEqual(workspaceDoc.contractEnd._millis, initialContractEnd._millis)
  assert.strictEqual(workspaceDoc.paymentStatus, 'active')
  assert.strictEqual(workspaceDoc.status, 'paused')
  assert.strictEqual(workspaceDoc.contractStatus, 'paused')

  const memberDoc = currentDefaultDb.getDoc('teamMembers/existing-owner-uid')
  assert.ok(memberDoc, 'Expected roster member to persist')
  assert.strictEqual(memberDoc.workspaceSlug, 'existing-store')
  assert.strictEqual(memberDoc.storeId, 'existing-store')
}

async function run() {
  await runInitializeStoreCreatesWorkspaceTest()
  await runInitializeStoreRejectsInvalidPlanTest()
  await runInitializeStorePreservesExistingContractWindowTest()
}

run()
  .then(() => {
    console.log('initializeStore tests passed')
  })
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
