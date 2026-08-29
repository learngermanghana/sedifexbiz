import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'
import { isPaidIntegrationOrder } from './integrationPaymentStatus'

type PlainRecord = Record<string, unknown>

function clean(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function asRecord(value: unknown): PlainRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as PlainRecord : {}
}

function firstText(values: unknown[], max = 500) {
  for (const value of values) {
    const candidate = clean(value, max)
    if (candidate) return candidate
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizePhone(value: unknown) {
  const raw = clean(value, 80)
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (raw.startsWith('+')) return `+${digits}`
  if (raw.startsWith('00')) return `+${digits.replace(/^00/, '')}`
  if (raw.startsWith('0')) return `+233${digits.replace(/^0/, '')}`
  if (digits.startsWith('233')) return `+${digits}`
  return `+${digits}`
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
}

async function findStoreCustomer(storeId: string, phone: string, email: string) {
  const customers = defaultDb.collection('stores').doc(storeId).collection('customers')
  if (phone) {
    const byPhone = await customers.where('phone', '==', phone).limit(1).get()
    if (!byPhone.empty) return byPhone.docs[0].ref
  }
  if (email) {
    const byEmail = await customers.where('email', '==', email).limit(1).get()
    if (!byEmail.empty) return byEmail.docs[0].ref
  }
  return null
}

function getDeferredBookingIntent(data: PlainRecord) {
  const metadata = asRecord(data.lastPaymentMetadata ?? data.metadata)
  const intent = asRecord(metadata.bookingIntent ?? metadata.booking_intent)
  const explicitlyDeferred = metadata.deferBookingUntilPaid === true
    || metadata.defer_booking_until_paid === true

  return explicitlyDeferred && Object.keys(intent).length ? { metadata, intent } : null
}

export const materializePaidIntegrationBooking = functions.firestore
  .document('integrationOrders/{orderId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null

    const data = change.after.data() as PlainRecord
    if (!isPaidIntegrationOrder(data)) return null
    if (clean(data.bookingMaterializedId ?? data.booking_materialized_id, 220)) return null
    if (clean(data.bookingId ?? data.booking_id, 220)) return null

    const deferred = getDeferredBookingIntent(data)
    if (!deferred) return null

    const { metadata, intent } = deferred
    const storeId = firstText([data.storeId, data.merchantId, metadata.storeId, metadata.merchantId], 180)
    if (!storeId) return null

    const orderCustomer = asRecord(data.customer)
    const intentCustomer = asRecord(intent.customer)
    const name = firstText([intentCustomer.name, intent.customerName, orderCustomer.name, data.customerName, metadata.customerName], 220)
    const email = firstText([intentCustomer.email, intent.customerEmail, orderCustomer.email, data.customerEmail, metadata.customerEmail], 220).toLowerCase()
    const phone = normalizePhone(firstText([intentCustomer.phone, intent.customerPhone, orderCustomer.phone, data.customerPhone, metadata.customerPhone], 80))
    const reference = firstText([data.reference, data.paymentReference, data.payment_reference, context.params.orderId], 220)
    const now = admin.firestore.FieldValue.serverTimestamp()

    let customerRef: FirebaseFirestore.DocumentReference | null = null
    if (name || email || phone) {
      customerRef = await findStoreCustomer(storeId, phone, email)
      if (!customerRef) {
        const customerKey = phone.replace(/\D/g, '') || slug(email) || slug(name) || slug(reference)
        customerRef = defaultDb.collection('stores').doc(storeId).collection('customers').doc(`paid_${customerKey}`)
      }
      const customerSnap = await customerRef.get()
      await customerRef.set({
        name: name || null,
        phone: phone || null,
        email: email || null,
        source: 'paid_integration_booking',
        paymentReference: reference,
        updatedAt: now,
        createdAt: customerSnap.exists ? customerSnap.get('createdAt') || now : now,
      }, { merge: true })
    }

    const items = Array.isArray(data.items) ? data.items : []
    const firstItem = asRecord(items[0])
    const serviceId = firstText([
      intent.serviceId,
      intent.service_id,
      firstItem.serviceId,
      firstItem.service_id,
      firstItem.item_id,
      firstItem.itemId,
      firstItem.id,
    ], 220)
    const serviceName = firstText([
      intent.serviceName,
      intent.service_name,
      firstItem.serviceName,
      firstItem.service_name,
      firstItem.name,
      data.serviceName,
      data.itemName,
    ], 240)
    const bookingDate = firstText([intent.bookingDate, intent.booking_date], 80)
    const bookingTime = firstText([intent.bookingTime, intent.booking_time], 80)
    const quantity = Math.max(1, Math.floor(numberValue(intent.quantity, numberValue(firstItem.quantity ?? firstItem.qty, 1))))
    const paymentAmount = numberValue(data.amountPaid ?? data.amount_paid ?? data.confirmedAmount ?? data.amount ?? intent.paymentAmount, 0)
    const sourceChannel = firstText([intent.sourceChannel, data.sourceChannel, data.source_channel, metadata.sourceChannel], 120) || 'client_website'
    const sourceLabel = firstText([intent.sourceLabel, data.sourceLabel, data.source_label, metadata.sourceLabel], 180) || 'Client website'
    const attributes = asRecord(intent.attributes)
    const orderId = clean(context.params.orderId, 180)
    const bookingId = `paid_${slug(orderId || reference)}`
    const bookingRef = defaultDb.collection('stores').doc(storeId).collection('integrationBookings').doc(bookingId)
    const rootBookingRef = defaultDb.collection('integrationBookings').doc(bookingId)
    const existingBooking = await bookingRef.get()

    const bookingRecord: PlainRecord = {
      bookingId,
      booking_id: bookingId,
      reference: `IB-${bookingId.slice(-8).toUpperCase()}`,
      storeId,
      customerId: customerRef?.id ?? null,
      serviceId: serviceId || null,
      serviceName: serviceName || null,
      customer: { name: name || null, phone: phone || null, email: email || null },
      quantity,
      notes: firstText([intent.notes, intent.message], 2000) || null,
      bookingDate: bookingDate || null,
      bookingTime: bookingTime || null,
      branchLocationId: firstText([intent.branchLocationId, intent.branch_location_id], 220) || null,
      branchLocationName: firstText([intent.branchLocationName, intent.branch_location_name], 240) || null,
      paymentMethod: 'paystack_checkout',
      paymentAmount,
      amountPaid: paymentAmount,
      paymentStatus: 'paid',
      payment_status: 'paid',
      paymentConfirmed: true,
      payment_confirmed: true,
      paymentReference: reference,
      payment_reference: reference,
      paymentConfirmedAt: data.paymentConfirmedAt ?? now,
      attributes,
      bookingStatus: 'confirmed',
      booking_status: 'confirmed',
      status: 'confirmed',
      orderStatus: 'booking_confirmed',
      order_status: 'booking_confirmed',
      syncStatus: 'pending',
      sync_status: 'pending',
      syncReason: 'confirmed_paid',
      syncRequestedAt: now,
      confirmedAt: now,
      source: 'integration',
      sourceChannel,
      source_channel: sourceChannel,
      sourceLabel,
      channel: 'BuySedifex',
      recordType: 'service_booking',
      createdAt: existingBooking.exists ? existingBooking.get('createdAt') || now : now,
      updatedAt: now,
    }

    const batch = defaultDb.batch()
    batch.set(bookingRef, bookingRecord, { merge: true })
    batch.set(rootBookingRef, bookingRecord, { merge: true })

    const orderUpdate = {
      bookingId,
      booking_id: bookingId,
      bookingMaterializedId: bookingId,
      booking_materialized_id: bookingId,
      bookingMaterializedAt: now,
      bookingStatus: 'confirmed',
      orderStatus: 'booking_confirmed',
      updatedAt: now,
    }
    batch.set(change.after.ref, orderUpdate, { merge: true })
    batch.set(defaultDb.collection('stores').doc(storeId).collection('integrationOrders').doc(orderId), orderUpdate, { merge: true })
    if (reference && reference !== orderId) {
      batch.set(defaultDb.collection('stores').doc(storeId).collection('integrationOrders').doc(reference), orderUpdate, { merge: true })
    }
    await batch.commit()

    functions.logger.info('Materialized paid integration booking', {
      storeId,
      reference,
      bookingId,
      customerId: customerRef?.id ?? null,
    })

    return null
  })
