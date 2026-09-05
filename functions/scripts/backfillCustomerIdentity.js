const admin = require('firebase-admin')

const ROOT_COLLECTIONS = ['sales', 'integrationBookings', 'integrationOrders', 'students']
const STORE_COLLECTIONS = ['integrationBookings', 'integrationOrders', 'invoices', 'receipts', 'events']

function text(value) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function firstText(...values) {
  for (const value of values) {
    const result = text(value)
    if (result) return result
  }
  return ''
}

function normalizePhone(value) {
  let digits = text(value).replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 10 && digits.startsWith('0')) digits = `233${digits.slice(1)}`
  return digits
}

function contactFromData(data) {
  const customer = record(data.customer)
  const metadata = record(data.metadata)
  const registration = record(data.data)
  const apprentice = record(registration.apprentice)
  return {
    email: firstText(customer.email, data.customerEmail, data.clientEmail, data.email, registration.studentEmail, registration.customerEmail, registration.email, apprentice.email, metadata.customerEmail).toLowerCase(),
    phone: normalizePhone(firstText(customer.phone, data.customerPhone, data.clientPhone, data.phone, registration.studentPhone, registration.customerPhone, registration.phone, apprentice.contact, metadata.customerPhone)),
  }
}

function addToIndex(index, key, customerId) {
  if (!key) return
  const ids = index.get(key) || new Set()
  ids.add(customerId)
  index.set(key, ids)
}

function buildCustomerIndex(customers) {
  const ids = new Set()
  const emails = new Map()
  const phones = new Map()
  for (const customer of customers) {
    ids.add(customer.id)
    const data = customer.data
    addToIndex(emails, text(data.email).toLowerCase(), customer.id)
    addToIndex(phones, normalizePhone(data.phone), customer.id)
  }
  return { ids, emails, phones }
}

function resolveCustomerId(data, index) {
  const nested = record(data.customer)
  const existing = firstText(data.customerId, data.customer_id, nested.customerId, nested.id)
  if (existing && index.ids.has(existing)) return { customerId: existing, strategy: 'existing' }

  const contact = contactFromData(data)
  const emailMatches = contact.email ? index.emails.get(contact.email) || new Set() : new Set()
  const phoneMatches = contact.phone ? index.phones.get(contact.phone) || new Set() : new Set()
  const candidates = new Set([...emailMatches, ...phoneMatches])
  if (candidates.size !== 1) return { customerId: '', strategy: candidates.size ? 'ambiguous' : 'unmatched' }

  const customerId = [...candidates][0]
  if (emailMatches.size && phoneMatches.size && (!emailMatches.has(customerId) || !phoneMatches.has(customerId))) {
    return { customerId: '', strategy: 'ambiguous' }
  }
  return { customerId, strategy: emailMatches.size && phoneMatches.size ? 'email_phone' : emailMatches.size ? 'email' : 'phone' }
}

function parseArgs(argv) {
  const values = new Map()
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const [key, ...rest] = arg.slice(2).split('=')
    values.set(key, rest.length ? rest.join('=') : 'true')
  }
  const pageSize = Math.min(Math.max(Number(values.get('page-size')) || 250, 25), 400)
  return {
    storeId: text(values.get('store-id')),
    apply: values.get('apply') === 'true',
    pageSize,
    maxPages: Math.max(Number(values.get('max-pages')) || Number.POSITIVE_INFINITY, 1),
    collection: text(values.get('collection')),
    startAfter: text(values.get('start-after')),
  }
}

async function processCollection({ db, ref, queryForPage, index, options, label }) {
  const totals = { scanned: 0, linked: 0, alreadyLinked: 0, unmatched: 0, ambiguous: 0, nextCursor: '', complete: false }
  let cursor = options.collection === label ? options.startAfter || null : null
  let page = 0
  while (page < options.maxPages) {
    const snapshot = await queryForPage(ref, cursor, options.pageSize).get()
    if (snapshot.empty) {
      totals.complete = true
      totals.nextCursor = ''
      break
    }
    const batch = db.batch()
    let writes = 0
    for (const document of snapshot.docs) {
      totals.scanned += 1
      const data = document.data() || {}
      const resolved = resolveCustomerId(data, index)
      if (!resolved.customerId) {
        totals[resolved.strategy] += 1
        continue
      }
      if (text(data.customerId) === resolved.customerId && text(data.customer_id) === resolved.customerId) {
        totals.alreadyLinked += 1
        continue
      }
      totals.linked += 1
      if (options.apply) {
        batch.set(document.ref, {
          customerId: resolved.customerId,
          customer_id: resolved.customerId,
          customerIdentity: {
            customerId: resolved.customerId,
            source: 'customer_identity_backfill',
            strategy: resolved.strategy,
            linkedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        }, { merge: true })
        writes += 1
      }
    }
    if (writes) await batch.commit()
    cursor = snapshot.docs[snapshot.docs.length - 1].id
    totals.nextCursor = cursor
    page += 1
    console.log(`${options.apply ? 'Applied' : 'Dry-run'} ${label} page ${page}; cursor=${cursor}`)
    if (snapshot.size < options.pageSize) {
      totals.complete = true
      totals.nextCursor = ''
      break
    }
  }
  if (!totals.complete && totals.nextCursor) {
    console.log(`Resume ${label} with --collection=${JSON.stringify(label)} --start-after=${JSON.stringify(totals.nextCursor)}`)
  }
  return totals
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (!options.storeId) throw new Error('Usage: npm run backfill-customer-identity -- --store-id=STORE_ID [--apply] [--page-size=250] [--max-pages=N] [--collection=COLLECTION] [--start-after=DOC_ID]')
  if (options.startAfter && !options.collection) throw new Error('--start-after requires --collection so the cursor is applied to the correct collection.')
  if (!admin.apps.length) admin.initializeApp()
  const db = admin.firestore()
  const customersSnapshot = await db.collection('customers').where('storeId', '==', options.storeId).get()
  const index = buildCustomerIndex(customersSnapshot.docs.map(document => ({ id: document.id, data: document.data() || {} })))
  console.log(`${options.apply ? 'APPLY' : 'DRY RUN'}: loaded ${index.ids.size} customers for ${options.storeId}`)

  const results = {}
  const rootQuery = (ref, cursor, pageSize) => {
    let query = ref.where('storeId', '==', options.storeId).orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize)
    if (cursor) query = query.startAfter(cursor)
    return query
  }
  const storeQuery = (ref, cursor, pageSize) => {
    let query = ref.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize)
    if (cursor) query = query.startAfter(cursor)
    return query
  }

  const targets = [
    ...ROOT_COLLECTIONS.map(name => ({ name, label: name, ref: db.collection(name), queryForPage: rootQuery })),
    ...STORE_COLLECTIONS.map(name => ({ name, label: `stores/${options.storeId}/${name}`, ref: db.collection('stores').doc(options.storeId).collection(name), queryForPage: storeQuery })),
  ]
  const selectedTargets = options.collection
    ? targets.filter(target => target.label === options.collection || target.name === options.collection)
    : targets
  if (!selectedTargets.length) {
    throw new Error(`Unknown --collection=${options.collection}. Use one of: ${targets.map(target => target.label).join(', ')}`)
  }
  if (options.startAfter && selectedTargets.length !== 1) {
    throw new Error('--start-after must resolve to exactly one collection. Use the full stores/STORE_ID/... label for store subcollections when needed.')
  }

  for (const target of selectedTargets) {
    const scopedOptions = { ...options, collection: target.label }
    results[target.label] = await processCollection({ db, ref: target.ref, queryForPage: target.queryForPage, index, options: scopedOptions, label: target.label })
  }
  console.log(JSON.stringify({ storeId: options.storeId, applied: options.apply, results }, null, 2))
}

if (require.main === module) {
  run().catch(error => {
    console.error('Customer identity backfill failed:', error)
    process.exitCode = 1
  })
}

module.exports = { buildCustomerIndex, contactFromData, parseArgs, resolveCustomerId, run }
