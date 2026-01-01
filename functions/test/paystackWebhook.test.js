const assert = require('assert')
const crypto = require('crypto')
const Module = require('module')
const { MockFirestore } = require('./helpers/mockFirestore')

let currentDefaultDb
const apps = []
const originalLoad = Module._load

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'firebase-admin') {
    const firestore = () => currentDefaultDb
    firestore.FieldValue = {
      serverTimestamp: () => ({ __mockServerTimestamp: true }),
    }

    return {
      initializeApp: () => {
        const app = { name: 'mock-app' }
        apps[0] = app
        return app
      },
      app: () => apps[0] || null,
      apps,
      firestore,
    }
  }

  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, message) {
        super(message)
        this.code = code
      }
    }

    return {
      https: {
        onCall: fn => {
          const handler = (...args) => fn(...args)
          handler.run = fn
          return handler
        },
        onRequest: fn => {
          const handler = (req, res) => fn(req, res)
          handler.run = fn
          return handler
        },
        HttpsError,
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    }
  }

  if (request === 'firebase-functions/params') {
    return {
      defineString: name => ({
        value: () => process.env[name] || '',
      }),
    }
  }

  return originalLoad(request, parent, isMain)
}

function loadPaystackModule() {
  delete require.cache[require.resolve('../lib/firestore.js')]
  delete require.cache[require.resolve('../lib/paystack.js')]
  return require('../lib/paystack.js')
}

function makeSignedRequest(body, secret) {
  const rawBody = Buffer.from(JSON.stringify(body))
  const signature = crypto
    .createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex')

  const resState = { statusCode: 0, body: null }
  const res = {
    status(code) {
      resState.statusCode = code
      return {
        send(payload) {
          resState.body = payload
        },
      }
    },
    send(payload) {
      resState.statusCode = resState.statusCode || 200
      resState.body = payload
    },
  }

  const req = {
    method: 'POST',
    body,
    rawBody,
    get: header => (header?.toLowerCase() === 'x-paystack-signature' ? signature : ''),
  }

  return { req, res, resState }
}

async function runChargeSuccessTest() {
  currentDefaultDb = new MockFirestore()
  process.env.PAYSTACK_SECRET_KEY = 'test_secret'

  const { paystackWebhook } = loadPaystackModule()

  const body = {
    event: 'charge.success',
    data: {
      reference: 'ref_123',
      amount: 150000,
      currency: 'NGN',
      paid_at: '2024-05-01T00:00:00Z',
      channel: 'pos',
      fees: 5000,
      metadata: {
        storeId: 'store-123',
        plan: 'starter',
        channel: 'pos',
        posTerminalId: 'POS-9',
      },
      customer: { email: 'user@example.com' },
    },
  }

  const { req, res, resState } = makeSignedRequest(body, process.env.PAYSTACK_SECRET_KEY)
  await paystackWebhook(req, res)

  assert.strictEqual(resState.statusCode, 200)
  assert.strictEqual(resState.body, 'ok')

  const subscription = currentDefaultDb.getDoc('subscriptions/store-123')
  assert.ok(subscription, 'Expected subscription document to be created')
  assert.strictEqual(subscription.status, 'active')
  assert.strictEqual(subscription.plan, 'starter')
  assert.strictEqual(subscription.reference, 'ref_123')
  assert.strictEqual(subscription.amount, 1500)
  assert.strictEqual(subscription.fees, 50)
  assert.strictEqual(subscription.posChannel, 'pos')
  assert.strictEqual(subscription.channel, 'pos')
  assert.deepStrictEqual(subscription.metadata, body.data.metadata)

  const events = currentDefaultDb.listCollection('subscriptions/store-123/events')
  assert.strictEqual(events.length, 1, 'Expected one audit event for charge.success')
  assert.strictEqual(events[0].data.event, 'charge.success')
  assert.deepStrictEqual(events[0].data.data, body.data)
}

async function runChargeFailedTest() {
  currentDefaultDb = new MockFirestore()
  process.env.PAYSTACK_SECRET_KEY = 'test_secret'

  const { paystackWebhook } = loadPaystackModule()

  const body = {
    event: 'charge.failed',
    data: {
      reference: 'ref_failed',
      amount: 50000,
      currency: 'NGN',
      paid_at: '2024-05-02T00:00:00Z',
      channel: 'card',
      fees: 1000,
      metadata: {
        storeId: 'store-456',
        plan: 'pro',
      },
      customer: { email: 'fail@example.com' },
    },
  }

  const { req, res, resState } = makeSignedRequest(body, process.env.PAYSTACK_SECRET_KEY)
  await paystackWebhook(req, res)

  assert.strictEqual(resState.statusCode, 200)
  assert.strictEqual(resState.body, 'ok')

  const subscription = currentDefaultDb.getDoc('subscriptions/store-456')
  assert.ok(subscription, 'Expected subscription document to be created')
  assert.strictEqual(subscription.status, 'failed')
  assert.strictEqual(subscription.plan, 'pro')
  assert.strictEqual(subscription.reference, 'ref_failed')
  assert.strictEqual(subscription.fees, 10)
  assert.strictEqual(subscription.channel, 'card')

  const events = currentDefaultDb.listCollection('subscriptions/store-456/events')
  assert.strictEqual(events.length, 1, 'Expected one audit event for charge.failed')
  assert.strictEqual(events[0].data.event, 'charge.failed')
  assert.deepStrictEqual(events[0].data.data, body.data)
}

async function run() {
  await runChargeSuccessTest()
  await runChargeFailedTest()
}

run()
  .then(() => {
    console.log('paystackWebhook tests passed')
  })
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
