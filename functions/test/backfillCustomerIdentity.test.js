const assert = require('node:assert/strict')
const { buildCustomerIndex, parseArgs, resolveCustomerId } = require('../scripts/backfillCustomerIdentity')

const index = buildCustomerIndex([
  { id: 'customer-a', data: { email: 'OWNER@example.com', phone: '+233 20 000 0001' } },
  { id: 'customer-b', data: { email: 'other@example.com', phone: '+233 20 000 0002' } },
  { id: 'customer-c', data: { email: 'shared@example.com' } },
  { id: 'customer-d', data: { email: 'shared@example.com' } },
])

assert.deepEqual(resolveCustomerId({ customerId: 'customer-a' }, index), { customerId: 'customer-a', strategy: 'existing' })
assert.deepEqual(resolveCustomerId({ customerEmail: 'owner@example.com' }, index), { customerId: 'customer-a', strategy: 'email' })
assert.deepEqual(resolveCustomerId({ customer: { phone: '020 000 0002' } }, index), { customerId: 'customer-b', strategy: 'phone' })
assert.deepEqual(resolveCustomerId({ email: 'shared@example.com' }, index), { customerId: '', strategy: 'ambiguous' })
assert.deepEqual(resolveCustomerId({ email: 'missing@example.com' }, index), { customerId: '', strategy: 'unmatched' })
assert.deepEqual(parseArgs(['--store-id=store-1', '--page-size=999', '--max-pages=2']), {
  storeId: 'store-1', apply: false, pageSize: 400, maxPages: 2, collection: '', startAfter: '',
})
assert.deepEqual(parseArgs(['--store-id=store-1', '--apply', '--collection=sales', '--start-after=sale-123']), {
  storeId: 'store-1', apply: true, pageSize: 250, maxPages: Number.POSITIVE_INFINITY, collection: 'sales', startAfter: 'sale-123',
})

console.log('customer identity backfill tests passed')
