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

function loadOnAuthCreateModule() {
  apps.length = 0
  delete require.cache[require.resolve('../lib/firestore.js')]
  delete require.cache[require.resolve('../lib/workspaces.js')]
  delete require.cache[require.resolve('../lib/onAuthCreate.js')]
  return require('../lib/onAuthCreate.js')
}

async function runCreatesWorkspaceWithGeneratedSlugTest() {
  currentDefaultDb = new MockFirestore()

  const { onAuthCreate } = loadOnAuthCreateModule()

  await onAuthCreate.run({
    uid: 'user-123',
    displayName: 'Owner Example',
    email: 'owner@example.com',
    phoneNumber: '+15555550100',
  })

  const workspaceDoc = currentDefaultDb.getDoc('workspaces/owner-example')
  assert.ok(workspaceDoc, 'Expected workspace document to be created')
  assert.strictEqual(workspaceDoc.slug, 'owner-example')
  assert.strictEqual(workspaceDoc.storeId, 'user-123')
  assert.strictEqual(workspaceDoc.ownerId, 'user-123')
  assert.strictEqual(workspaceDoc.ownerEmail, 'owner@example.com')
  assert.strictEqual(workspaceDoc.status, 'active')
  assert.ok(workspaceDoc.createdAt, 'Expected createdAt to be set')

  const storeDoc = currentDefaultDb.getDoc('stores/user-123')
  assert.ok(storeDoc, 'Expected store document to be created')
  assert.strictEqual(storeDoc.workspaceSlug, 'owner-example')

  const memberDoc = currentDefaultDb.getDoc('teamMembers/user-123')
  assert.ok(memberDoc, 'Expected team member document to be created')
  assert.strictEqual(memberDoc.workspaceSlug, 'owner-example')
}

async function runGeneratesUniqueSlugWhenTakenTest() {
  currentDefaultDb = new MockFirestore({
    'workspaces/owner-example': {
      slug: 'owner-example',
      storeId: 'existing-store',
      ownerId: 'existing-owner',
    },
    'workspaces/user-456': {
      slug: 'user-456',
      storeId: 'another-store',
      ownerId: 'another-owner',
    },
  })

  const { onAuthCreate } = loadOnAuthCreateModule()

  await onAuthCreate.run({
    uid: 'user-456',
    displayName: 'Owner Example',
    email: 'owner-example@example.com',
  })

  const workspaceDoc = currentDefaultDb.getDoc('workspaces/owner-example-2')
  assert.ok(workspaceDoc, 'Expected fallback workspace slug to be created')
  assert.strictEqual(workspaceDoc.slug, 'owner-example-2')
  assert.strictEqual(workspaceDoc.storeId, 'user-456')
  assert.strictEqual(workspaceDoc.ownerEmail, 'owner-example@example.com')

  const storeDoc = currentDefaultDb.getDoc('stores/user-456')
  assert.ok(storeDoc, 'Expected store document for new user')
  assert.strictEqual(storeDoc.workspaceSlug, 'owner-example-2')
}

async function run() {
  await runCreatesWorkspaceWithGeneratedSlugTest()
  await runGeneratesUniqueSlugWhenTakenTest()
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
