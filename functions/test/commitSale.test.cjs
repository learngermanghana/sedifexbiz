const assert = require('assert')
const Module = require('module')
const { MockFirestore, MockTimestamp } = require('./helpers/mockFirestore.cjs')

let currentDb
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'firebase-admin') {
    const apps = []
    const firestore = () => currentDb
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
      getFirestore: () => currentDb,
    }
  }
  return originalLoad(request, parent, isMain)
}

async function run() {
  currentDb = new MockFirestore({
    'workspaces/demo-store': { storeId: 'branch-1' },
    'workspaces/demo-store/products/prod-1': {
      stockCount: 5,
      storeId: 'branch-1',
      workspaceId: 'demo-store',
    },
  })

  delete require.cache[require.resolve('../lib/index.js')]
  const { commitSale } = require('../lib/index.js')

  const context = {
    auth: {
      uid: 'cashier-1',
      token: { role: 'staff' },
    },
  }

  const payload = {
    branchId: 'branch-1',
    workspaceId: 'demo-store',
    cashierId: 'cashier-1',
    saleId: 'sale-123',
    totals: { total: 100, taxTotal: 10 },
    payment: { method: 'cash' },
    customer: { name: 'Alice' },
    items: [{ productId: 'prod-1', name: 'Widget', qty: 1, price: 100, taxRate: 0.1 }],
  }

  const result = await commitSale.run(payload, context)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(result.saleId, 'sale-123')

  const saleDoc = currentDb.getDoc('workspaces/demo-store/sales/sale-123')
  assert.ok(saleDoc)
  assert.strictEqual(saleDoc.branchId, 'branch-1')
  assert.strictEqual(saleDoc.workspaceId, 'demo-store')

  const saleItems = currentDb.listCollection('workspaces/demo-store/saleItems')
  assert.strictEqual(saleItems.length, 1)
  assert.strictEqual(saleItems[0].data.saleId, 'sale-123')

  const productDoc = currentDb.getDoc('workspaces/demo-store/products/prod-1')
  assert.strictEqual(productDoc.stockCount, 4)

  let error
  try {
    await commitSale.run(payload, context)
  } catch (err) {
    error = err
  }

  assert.ok(error, 'Expected duplicate sale to throw')
  assert.strictEqual(error.code, 'already-exists')

  const ledgerEntries = currentDb.listCollection('workspaces/demo-store/ledger')
  assert.strictEqual(ledgerEntries.length, 1)
  assert.strictEqual(ledgerEntries[0].data.refId, 'sale-123')

  currentDb = new MockFirestore({
    'workspaces/workspace-xyz': { storeId: 'store-xyz', slug: 'lagos-roastery', workspaceSlug: 'lagos-roastery' },
    'workspaces/workspace-xyz/products/prod-1': {
      stockCount: 3,
      storeId: 'store-xyz',
      workspaceId: 'workspace-xyz',
    },
  })

  delete require.cache[require.resolve('../lib/index.js')]
  const { commitSale: commitSaleWithSlug } = require('../lib/index.js')

  const slugPayload = {
    branchId: 'lagos-roastery',
    workspaceId: 'lagos-roastery',
    cashierId: 'cashier-1',
    saleId: 'sale-slug',
    totals: { total: 50, taxTotal: 0 },
    payment: { method: 'cash' },
    items: [{ productId: 'prod-1', name: 'Widget', qty: 1, price: 50, taxRate: 0 }],
  }

  const slugResult = await commitSaleWithSlug.run(slugPayload, context)
  assert.strictEqual(slugResult.ok, true)
  assert.strictEqual(slugResult.saleId, 'sale-slug')

  const resolvedSale = currentDb.getDoc('workspaces/workspace-xyz/sales/sale-slug')
  assert.ok(resolvedSale, 'Expected sale to resolve via slug/workspaceSlug fields')
  assert.strictEqual(resolvedSale.workspaceId, 'workspace-xyz')

  const missingSale = currentDb.getDoc('workspaces/lagos-roastery/sales/sale-slug')
  assert.strictEqual(missingSale, undefined, 'Sale should not be written under slug as document ID')

  const slugLedgerEntries = currentDb.listCollection('workspaces/workspace-xyz/ledger')
  assert.strictEqual(slugLedgerEntries.length, 1)
  assert.strictEqual(slugLedgerEntries[0].data.refId, 'sale-slug')

  const updatedProduct = currentDb.getDoc('workspaces/workspace-xyz/products/prod-1')
  assert.strictEqual(updatedProduct.stockCount, 2)

  console.log('commitSale tests passed')
}

run()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    Module._load = originalLoad
  })
