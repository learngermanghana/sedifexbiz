import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'
import { upsertStoreCustomerIdentity } from './customerUpsert'

type RecordMap = Record<string, unknown>
type FirestoreChange = functions.Change<FirebaseFirestore.DocumentSnapshot>

function clean(value: unknown, max = 500) {
  if (typeof value === 'string') return value.trim().slice(0, max)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = clean(value)
    if (text) return text
  }
  return ''
}

function contactFromData(data: RecordMap) {
  const customer = record(data.customer)
  const metadata = record(data.metadata)
  const registrationData = record(data.data)
  const apprentice = record(registrationData.apprentice)

  return {
    name: firstText(
      customer.name,
      data.customerName,
      data.clientName,
      data.fullName,
      data.name,
      registrationData.studentName,
      registrationData.fullName,
      registrationData.customerName,
      registrationData.name,
      apprentice.full_name,
      metadata.customerName,
    ),
    phone: firstText(
      customer.phone,
      data.customerPhone,
      data.clientPhone,
      data.phone,
      registrationData.studentPhone,
      registrationData.customerPhone,
      registrationData.phone,
      apprentice.contact,
      metadata.customerPhone,
    ),
    email: firstText(
      customer.email,
      data.customerEmail,
      data.clientEmail,
      data.email,
      registrationData.studentEmail,
      registrationData.customerEmail,
      registrationData.email,
      apprentice.email,
      metadata.customerEmail,
    ),
  }
}

async function canonicalCustomerExists(storeId: string, customerId: string) {
  if (!customerId) return false
  try {
    const snapshot = await defaultDb.collection('customers').doc(customerId).get()
    return snapshot.exists && clean(snapshot.get('storeId'), 180) === storeId
  } catch (error) {
    functions.logger.warn('Canonical customer lookup failed', { storeId, customerId, error })
    return false
  }
}

async function resolveCustomerId(input: {
  storeId: string
  data: RecordMap
  sourceChannel: string
  sourceTag: string
  identityKey: string
  preferredCustomerId?: string
}) {
  const existingCandidate = firstText(
    input.preferredCustomerId,
    input.data.customerId,
    input.data.customer_id,
    record(input.data.customer).customerId,
    record(input.data.customer).id,
  )

  if (existingCandidate && await canonicalCustomerExists(input.storeId, existingCandidate)) {
    return { customerId: existingCandidate, created: false }
  }

  const customer = contactFromData(input.data)
  return upsertStoreCustomerIdentity({
    storeId: input.storeId,
    customer,
    sourceChannel: input.sourceChannel,
    sourceTag: input.sourceTag,
    identityKey: input.identityKey,
  })
}

async function linkDocument(change: FirestoreChange, input: {
  storeId: string
  sourceChannel: string
  sourceTag: string
  identityKey: string
  preferredCustomerId?: string
}) {
  if (!change.after.exists) return null
  const data = change.after.data() as RecordMap
  const resolved = await resolveCustomerId({ ...input, data })
  if (!resolved?.customerId) return null

  const currentCustomerId = clean(data.customerId, 240)
  const currentSnakeCustomerId = clean(data.customer_id, 240)
  if (currentCustomerId === resolved.customerId && currentSnakeCustomerId === resolved.customerId) return null

  await change.after.ref.set({
    customerId: resolved.customerId,
    customer_id: resolved.customerId,
    customerIdentity: {
      customerId: resolved.customerId,
      source: input.sourceChannel,
      strategy: 'canonical_customer_v1',
      linkedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  }, { merge: true })

  functions.logger.info('Linked module record to canonical customer', {
    path: change.after.ref.path,
    storeId: input.storeId,
    customerId: resolved.customerId,
    source: input.sourceChannel,
    createdCustomer: resolved.created,
  })
  return null
}

async function registrationCustomerId(registrationId: string) {
  if (!registrationId) return ''
  for (const collectionName of ['studentRegistrations', 'student_registrations']) {
    try {
      const registration = await defaultDb.collection(collectionName).doc(registrationId).get()
      if (registration.exists) {
        const customerId = firstText(registration.get('customerId'), registration.get('customer_id'))
        if (customerId) return customerId
      }
    } catch (error) {
      functions.logger.warn('Student registration customer inheritance lookup failed', {
        registrationId,
        collectionName,
        error,
      })
    }
  }
  return ''
}

export const syncStoreBookingCustomerIdentity = functions.firestore
  .document('stores/{storeId}/integrationBookings/{bookingId}')
  .onWrite((change, context) => linkDocument(change, {
    storeId: clean(context.params.storeId, 180),
    sourceChannel: 'booking',
    sourceTag: 'booking',
    identityKey: `booking-${clean(context.params.bookingId, 220)}`,
  }))

export const syncRootBookingCustomerIdentity = functions.firestore
  .document('integrationBookings/{bookingId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null
    const data = change.after.data() as RecordMap
    const storeId = firstText(data.storeId, data.merchantId)
    if (!storeId) return null
    return linkDocument(change, {
      storeId,
      sourceChannel: 'booking',
      sourceTag: 'booking',
      identityKey: `booking-${clean(context.params.bookingId, 220)}`,
    })
  })

export const syncInvoiceCustomerIdentity = functions.firestore
  .document('stores/{storeId}/invoices/{invoiceId}')
  .onWrite((change, context) => linkDocument(change, {
    storeId: clean(context.params.storeId, 180),
    sourceChannel: 'invoice',
    sourceTag: 'invoice',
    identityKey: `invoice-${clean(context.params.invoiceId, 220)}`,
  }))

export const syncReceiptCustomerIdentity = functions.firestore
  .document('stores/{storeId}/receipts/{receiptId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null
    const data = change.after.data() as RecordMap
    const storeId = clean(context.params.storeId, 180)
    const invoiceId = clean(data.invoiceId, 220)
    let preferredCustomerId = ''

    if (storeId && invoiceId) {
      try {
        const invoiceRef = defaultDb.collection('stores').doc(storeId).collection('invoices').doc(invoiceId)
        const invoice = await invoiceRef.get()
        if (invoice.exists) {
          const invoiceData = invoice.data() as RecordMap
          const invoiceCustomer = await resolveCustomerId({
            storeId,
            data: invoiceData,
            sourceChannel: 'invoice',
            sourceTag: 'invoice',
            identityKey: `invoice-${invoiceId}`,
          })
          if (invoiceCustomer?.customerId) {
            preferredCustomerId = invoiceCustomer.customerId
            const invoiceCustomerId = clean(invoiceData.customerId, 240)
            const invoiceSnakeCustomerId = clean(invoiceData.customer_id, 240)
            if (invoiceCustomerId !== preferredCustomerId || invoiceSnakeCustomerId !== preferredCustomerId) {
              await invoiceRef.set({
                customerId: preferredCustomerId,
                customer_id: preferredCustomerId,
                customerIdentity: {
                  customerId: preferredCustomerId,
                  source: 'invoice',
                  strategy: 'canonical_customer_v1',
                  linkedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
              }, { merge: true })
            }
          }
        }
      } catch (error) {
        functions.logger.warn('Receipt customer inheritance lookup failed', { storeId, invoiceId, error })
      }
    }

    return linkDocument(change, {
      storeId,
      sourceChannel: 'receipt',
      sourceTag: 'payment',
      identityKey: invoiceId ? `invoice-${invoiceId}` : `receipt-${clean(context.params.receiptId, 220)}`,
      preferredCustomerId,
    })
  })

// Dashboard/manual admissions use camelCase. Keep this trigger for those records.
export const syncStudentRegistrationCustomerIdentity = functions.firestore
  .document('studentRegistrations/{registrationId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null
    const data = change.after.data() as RecordMap
    const storeId = clean(data.storeId, 180)
    if (!storeId) return null
    return linkDocument(change, {
      storeId,
      sourceChannel: 'student_registration',
      sourceTag: 'student',
      identityKey: `student-registration-${clean(context.params.registrationId, 220)}`,
    })
  })

// Website and integration admissions use the deployed snake_case collection.
export const syncExternalStudentRegistrationCustomerIdentity = functions.firestore
  .document('student_registrations/{registrationId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null
    const data = change.after.data() as RecordMap
    const storeId = clean(data.storeId, 180)
    if (!storeId) return null
    return linkDocument(change, {
      storeId,
      sourceChannel: 'student_registration',
      sourceTag: 'student',
      identityKey: `student-registration-${clean(context.params.registrationId, 220)}`,
    })
  })

// The integration API also mirrors registrations under the store. Canonicalize
// that copy so any store-scoped readers see the same CRM identity immediately.
export const syncStoreStudentRegistrationCustomerIdentity = functions.firestore
  .document('stores/{storeId}/student_registrations/{registrationId}')
  .onWrite((change, context) => linkDocument(change, {
    storeId: clean(context.params.storeId, 180),
    sourceChannel: 'student_registration',
    sourceTag: 'student',
    identityKey: `student-registration-${clean(context.params.registrationId, 220)}`,
  }))

export const syncStudentCustomerIdentity = functions.firestore
  .document('students/{studentId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null
    const data = change.after.data() as RecordMap
    const storeId = clean(data.storeId, 180)
    if (!storeId) return null

    const registrationId = clean(data.studentRegistrationId, 220)
    const preferredCustomerId = await registrationCustomerId(registrationId)

    return linkDocument(change, {
      storeId,
      sourceChannel: 'student',
      sourceTag: 'student',
      identityKey: `student-${clean(context.params.studentId, 220)}`,
      preferredCustomerId,
    })
  })

export const syncStoreOrderCustomerIdentity = functions.firestore
  .document('stores/{storeId}/integrationOrders/{orderId}')
  .onWrite((change, context) => linkDocument(change, {
    storeId: clean(context.params.storeId, 180),
    sourceChannel: 'integration_order',
    sourceTag: 'order',
    identityKey: `order-${clean(context.params.orderId, 220)}`,
  }))

export const syncSaleCustomerIdentity = functions.firestore
  .document('sales/{saleId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null
    const data = change.after.data() as RecordMap
    const storeId = clean(data.storeId, 180)
    if (!storeId) return null
    return linkDocument(change, {
      storeId,
      sourceChannel: 'pos_sale',
      sourceTag: 'pos',
      identityKey: `sale-${clean(context.params.saleId, 220)}`,
    })
  })