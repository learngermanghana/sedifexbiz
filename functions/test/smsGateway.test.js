const assert = require('node:assert/strict')

const { validateHubtelSendResponse } = require('../lib/smsGateway')

assert.deepEqual(
  validateHubtelSendResponse({ Status: 0, MessageId: 'hubtel-123' }),
  { messageId: 'hubtel-123', raw: { Status: 0, MessageId: 'hubtel-123' } },
)

assert.equal(
  validateHubtelSendResponse({ ResponseCode: '0000', Data: 'ignored', data: { messageId: 'hubtel-456' } }).messageId,
  'hubtel-456',
)

assert.throws(
  () => validateHubtelSendResponse({ Status: 1, Message: 'Invalid sender' }),
  /did not confirm SMS acceptance: Invalid sender/,
)

assert.throws(
  () => validateHubtelSendResponse({ Status: 0 }),
  /did not confirm SMS acceptance/,
)

console.log('smsGateway tests passed')
