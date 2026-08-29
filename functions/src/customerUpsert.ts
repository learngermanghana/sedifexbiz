import { createHash } from 'node:crypto'
import { admin, defaultDb } from './firestore'

export type CheckoutCustomerInput = {
  storeId: string
  customer: {
    name?: string | null
    email?: string | null
    phone?: string | null
  }
  reference?: string | null
  sourceChannel?: string | null
  sourceLabel?: string | null
  paymentMethod?: string | null
  paymentStatus?: string | null
  orderStatus?: string | null
  amount?: number | null
  currency?: string | null
  itemName?: string | null
}

export type EventPlanningCustomerInput = {
  storeId: string
  eventId: string
  eventCode?: string | null
  eventTitle?: string | null
  eventDate?: string | null
  customer: {
    name?: string | null
    email?: string | null
    phone?: string | null
  }
}

export type StoreCustomerIdentityInput = {
  storeId: string
  customer: {
    name?: string | null
    email?: string | null
    phone?: string | null
  }
  sourceChannel?: string | null
  sourceTag?: string | null
  identityKey?: string | null
}

function clean(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeEmail(value: unknown) {
  const email = clean(value, 220).toLowerCase()
  if (!email) return ''
  if (/^quickpay-[a-z0-9-]+@sedifex\.com$/i.test(email)) return ''
  return email
}

function normalizePhone(value: unknown) {
  const raw = clean(value, 80)
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (raw.trim().startsWith('+')) return `+${digits}`
  if (raw.trim().startsWith('00')) return `+${digits.replace(/^00/, '')}`
  if (raw.trim().startsWith('0')) return `+233${digits.replace(/^0/, '')}`
  if (digits.startsWith('233')) return `+${digits}`
  return `+${digits}`
}

function phoneKey(value: string) {
  return normalizePhone(value).replace(/\D/g, '')
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}

function identityHash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)
}

async function findExistingCustomer(storeId: string, normalizedPhone: string, normalizedEmail: string) {
  const collection = defaultDb.collection('customers')
  const phone = phoneKey(normalizedPhone)
  const email = normalizedEmail.toLowerCase()

  const queries: Array<() => Promise<FirebaseFirestore.QuerySnapshot>> = []
  if (phone) queries.push(() => collection.where('storeId', '==', storeId).where('phoneKey', '==', phone).limit(1).get())
  if (email) queries.push(() => collection.where('storeId', '==', storeId).where('emailKey', '==', email).limit(1).get())
  if (normalizedPhone) queries.push(() => collection.where('storeId', '==', storeId).where('phone', '==', normalizedPhone).limit(1).get())
  if (email) queries.push(() => collection.where('storeId', '==', storeId).where('email', '==', email).limit(1).get())

  for (const runQuery of queries) {
    try {
      const snapshot = await runQuery()
      if (!snapshot.empty) return snapshot.docs[0].ref
    } catch (error) {
      console.warn('[customer-upsert] Customer lookup query failed; falling back if needed', error)
    }
  }

  return null
}

async function applyIdentityFields(
  patch: Record<string, unknown>,
  existingRef: FirebaseFirestore.DocumentReference | null,
  input: { name: string; email: string; phone: string },
) {
  if (!existingRef) {
    if (input.name) {
      patch.name = input.name
      patch.displayName = input.name
    }
    if (input.phone) {
      patch.phone = input.phone
      patch.phoneKey = phoneKey(input.phone)
    }
    if (input.email) {
      patch.email = input.email
      patch.emailKey = input.email.toLowerCase()
    }
    return
  }

  const snapshot = await existingRef.get()
  const existingName = clean(snapshot.get('name'), 220)
  const existingDisplayName = clean(snapshot.get('displayName'), 220)
  const existingPhone = normalizePhone(snapshot.get('phone'))
  const existingEmail = normalizeEmail(snapshot.get('email'))

  // Automatic module linkage must never rename or replace established CRM
  // identity data. This is especially important for public registration flows
  // and shared parent/guardian contact details. Only fill fields that are blank.
  if (!existingName && !existingDisplayName && input.name) {
    patch.name = input.name
    patch.displayName = input.name
  } else {
    if (!existingName && existingDisplayName) patch.name = existingDisplayName
    if (!existingDisplayName && existingName) patch.displayName = existingName
  }

  if (existingPhone) {
    patch.phoneKey = phoneKey(existingPhone)
  } else if (input.phone) {
    patch.phone = input.phone
    patch.phoneKey = phoneKey(input.phone)
  }

  if (existingEmail) {
    patch.emailKey = existingEmail.toLowerCase()
  } else if (input.email) {
    patch.email = input.email
    patch.emailKey = input.email.toLowerCase()
  }
}

export async function upsertStoreCustomerIdentity(input: StoreCustomerIdentityInput) {
  const storeId = clean(input.storeId, 180)
  if (!storeId) return null

  const name = clean(input.customer.name, 220)
  const email = normalizeEmail(input.customer.email)
  const phone = normalizePhone(input.customer.phone)
  const keyPhone = phoneKey(phone)
  const keyEmail = email.toLowerCase()
  if (!name && !email && !phone) return null

  const existingRef = await findExistingCustomer(storeId, phone, email)
  const sourceChannel = clean(input.sourceChannel, 80) || 'crm_identity_sync'
  const sourceTag = clean(input.sourceTag, 80) || sourceChannel.replace(/_/g, '-')
  const fallbackIdentity = clean(input.identityKey, 220) || name || `${sourceChannel}-${Date.now()}`
  const contactKey = keyPhone
    ? `phone-${keyPhone}`
    : keyEmail
      ? `email-${identityHash(keyEmail)}`
      : `record-${slug(fallbackIdentity)}`
  const customerRef = existingRef || defaultDb.collection('customers').doc(`${storeId}_${contactKey}`)
  const now = admin.firestore.FieldValue.serverTimestamp()

  const patch: Record<string, unknown> = {
    storeId,
    updatedAt: now,
    lastActivityAt: now,
    tags: admin.firestore.FieldValue.arrayUnion(sourceTag, 'auto-captured'),
    sources: admin.firestore.FieldValue.arrayUnion(sourceChannel),
  }

  if (!existingRef) {
    patch.createdAt = now
    patch.customerSource = sourceChannel
  }
  await applyIdentityFields(patch, existingRef, { name, email, phone })

  await customerRef.set(patch, { merge: true })
  return { customerId: customerRef.id, created: !existingRef }
}

export async function upsertStoreCustomerFromCheckout(input: CheckoutCustomerInput) {
  const storeId = clean(input.storeId, 180)
  if (!storeId) return null

  const name = clean(input.customer.name, 220)
  const email = normalizeEmail(input.customer.email)
  const phone = normalizePhone(input.customer.phone)
  const keyPhone = phoneKey(phone)
  const keyEmail = email.toLowerCase()

  if (!name && !email && !phone) return null

  const existingRef = await findExistingCustomer(storeId, phone, email)
  const contactKey = keyPhone ? `phone-${keyPhone}` : keyEmail ? `email-${identityHash(keyEmail)}` : `name-${slug(name)}`
  const customerRef = existingRef || defaultDb.collection('customers').doc(`${storeId}_${contactKey}`)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const amount = typeof input.amount === 'number' && Number.isFinite(input.amount) ? input.amount : null

  const patch: Record<string, unknown> = {
    storeId,
    updatedAt: now,
    lastActivityAt: now,
    lastQuickPayAt: now,
    lastQuickPayReference: clean(input.reference, 220) || null,
    lastQuickPaySource: clean(input.sourceChannel, 80) || 'quick_pay',
    lastQuickPayPaymentMethod: clean(input.paymentMethod, 80) || null,
    lastQuickPayPaymentStatus: clean(input.paymentStatus, 80) || null,
    lastQuickPayOrderStatus: clean(input.orderStatus, 80) || null,
    lastQuickPayItemName: clean(input.itemName, 260) || null,
    lastQuickPayAmount: amount,
    lastQuickPayCurrency: clean(input.currency, 20) || 'GHS',
    tags: admin.firestore.FieldValue.arrayUnion('quick-pay', 'auto-captured'),
    sources: admin.firestore.FieldValue.arrayUnion(clean(input.sourceChannel, 80) || 'quick_pay'),
    customerSource: 'quick_pay',
    autoCapturedFromQuickPay: true,
  }

  if (!existingRef) patch.createdAt = now
  await applyIdentityFields(patch, existingRef, { name, email, phone })

  await customerRef.set(patch, { merge: true })
  return { customerId: customerRef.id, created: !existingRef }
}

export async function upsertStoreCustomerFromEvent(input: EventPlanningCustomerInput) {
  const storeId = clean(input.storeId, 180)
  const eventId = clean(input.eventId, 220)
  if (!storeId || !eventId) return null

  const name = clean(input.customer.name, 220)
  const email = normalizeEmail(input.customer.email)
  const phone = normalizePhone(input.customer.phone)
  const keyPhone = phoneKey(phone)
  const keyEmail = email.toLowerCase()

  if (!name && !email && !phone) return null

  const existingRef = await findExistingCustomer(storeId, phone, email)
  // Phone/email remain the stable dedupe keys. When neither exists, the event
  // document ID becomes the stable identity so two people with the same name
  // cannot overwrite the same Customer record.
  const contactKey = keyPhone ? `phone-${keyPhone}` : keyEmail ? `email-${identityHash(keyEmail)}` : `event-${eventId}`
  const customerRef = existingRef || defaultDb.collection('customers').doc(`${storeId}_${contactKey}`)
  const now = admin.firestore.FieldValue.serverTimestamp()

  const patch: Record<string, unknown> = {
    storeId,
    updatedAt: now,
    lastActivityAt: now,
    lastEventPlanningAt: now,
    lastEventId: eventId,
    lastEventCode: clean(input.eventCode, 100) || null,
    lastEventTitle: clean(input.eventTitle, 260) || null,
    lastEventDate: clean(input.eventDate, 40) || null,
    tags: admin.firestore.FieldValue.arrayUnion('event-planning', 'auto-captured'),
    sources: admin.firestore.FieldValue.arrayUnion('event_planning'),
    autoCapturedFromEventPlanning: true,
  }

  if (!existingRef) {
    patch.createdAt = now
    patch.customerSource = 'event_planning'
  }
  await applyIdentityFields(patch, existingRef, { name, email, phone })

  await customerRef.set(patch, { merge: true })
  return { customerId: customerRef.id, created: !existingRef }
}