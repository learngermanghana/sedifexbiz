const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const alerts = fs.readFileSync(path.join(root, 'src', 'bookingSmsStoreAlerts.ts'), 'utf8')
const index = fs.readFileSync(path.join(root, 'src', 'index.ts'), 'utf8')

assert.match(alerts, /title: `\$\{label\} SMS accepted by Hubtel`/)
assert.match(alerts, /status: providerAccepted \? 'accepted'/)
assert.match(alerts, /kind: providerAccepted \? 'accepted'/)
assert.match(alerts, /providerDeliveryStatus: 'accepted'/)
assert.match(alerts, /deliveryConfirmed: false/)
assert.match(alerts, /providerMessageId: first\(\[data\.providerMessageId\], 180\)/)
assert.doesNotMatch(alerts, /title: `\$\{label\} SMS sent`/)
assert.doesNotMatch(index, /normalizeBookingSmsDeliveryStatus/)

console.log('booking SMS store alert status regression checks passed')
