const assert = require('assert')
const Module = require('module')
const { MockFirestore, MockTimestamp } = require('./helpers/mockFirestore')

let currentDb
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'firebase-admin') {
    const apps = []
    const firestore = () => currentDb
    firestore.FieldValue = { serverTimestamp: () => ({ __mockServerTimestamp: true }) }
    firestore.Timestamp = MockTimestamp
    return {
      initializeApp: () => { const app = { name: 'mock-app' }; apps[0] = app; return app },
      app: () => apps[0] || null,
      apps,
      firestore,
      auth: () => ({}),
    }
  }
  if (request === 'firebase-admin/firestore') return { getFirestore: () => currentDb }
  return originalLoad(request, parent, isMain)
}

async function run() {
  currentDb = new MockFirestore({
    'teamMembers/owner-1': { uid: 'owner-1', storeId: 'store-1', role: 'owner' },
    'teamMembers/staff-1': { uid: 'staff-1', storeId: 'store-1', role: 'staff' },
    'products/product-1': { storeId: 'store-1', stockCount: 7 },
    'sales/sale-1': {
      storeId: 'store-1',
      status: 'completed',
      total: 50,
      items: [
        { productId: 'product-1', qty: 2, type: 'product' },
        { productId: null, qty: 1, type: 'service', isService: true },
      ],
    },
  })

  delete require.cache[require.resolve('../lib/index.js')]
  const { voidSale } = require('../lib/index.js')
  const ownerContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } }

  const result = await voidSale.run({ storeId: 'store-1', saleId: 'sale-1', reason: 'Wrong quantity entered' }, ownerContext)
  assert.deepStrictEqual(result, { ok: true, saleId: 'sale-1', status: 'voided' })
  assert.strictEqual(currentDb.getDoc('products/product-1').stockCount, 9)
  assert.strictEqual(currentDb.getDoc('sales/sale-1').status, 'voided')
  assert.strictEqual(currentDb.getDoc('sales/sale-1').voidReason, 'Wrong quantity entered')

  const reversals = currentDb.listCollection('ledger')
  assert.strictEqual(reversals.length, 1)
  assert.strictEqual(reversals[0].data.type, 'sale_void')
  assert.strictEqual(reversals[0].data.qtyChange, 2)
  assert.strictEqual(currentDb.listCollection('activity').length, 1)

  await assert.rejects(
    () => voidSale.run({ storeId: 'store-1', saleId: 'sale-1', reason: 'Try twice' }, ownerContext),
    error => error.code === 'already-exists',
  )
  assert.strictEqual(currentDb.getDoc('products/product-1').stockCount, 9, 'a repeated void must not restore stock twice')

  currentDb.setRaw('sales/sale-2', { storeId: 'store-1', status: 'completed', items: [] })
  await assert.rejects(
    () => voidSale.run(
      { storeId: 'store-1', saleId: 'sale-2', reason: 'Staff correction attempt' },
      { auth: { uid: 'staff-1', token: { email: 'staff@example.com' } } },
    ),
    error => error.code === 'permission-denied',
  )
  assert.strictEqual(currentDb.getDoc('sales/sale-2').status, 'completed')

  console.log('voidSale tests passed')
}

run()
  .catch(error => { console.error(error); process.exitCode = 1 })
  .finally(() => { Module._load = originalLoad })
