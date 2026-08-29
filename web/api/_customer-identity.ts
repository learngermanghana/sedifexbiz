import { createHash } from 'node:crypto'
import { FieldValue, type DocumentReference, type Firestore, type QuerySnapshot } from 'firebase-admin/firestore'

type CanonicalCustomerInput = {
  storeId: string
  name?: string | null
  email?: string | null
  phone?: string | null
  sourceChannel?: string | null
  sourceTag?: string | null
  identityKey?: string | null
}

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeEmail(value: unknown) {
  return text(value, 220).toLowerCase()
}

function normalizePhone(value: unknown) {
  const raw = text(value, 80)
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (raw.startsWith('+')) return `+${digits}`
  if (raw.startsWith('00')) return `+${digits.replace(/^00/, '')}`
  if (raw.startsWith('0')) return `+233${digits.replace(/^0/, '')}`
  if (digits.startsWith('233')) return `+${digits}`
  return `+${digits}`
}

function phoneKey(value: unknown) {
  return normalizePhone(value).replace(/\D/g, '')
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}

function identityHash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)
}

async function findExistingCustomer(
  firestore: Firestore,
  storeId: string,
  normalizedPhone: string,
  normalizedEmail: string,
): Promise<DocumentReference | null> {
  const customers = firestore.collection('customers')
  const keyPhone = phoneKey(normalizedPhone)
  const keyEmail = normalizedEmail.toLowerCase()

  const queries: Array<() => Promise<QuerySnapshot>> = []
  if (keyPhone) queries.push(() => customers.where('storeId', '==', storeId).where('phoneKey', '==', keyPhone).limit(1).get())
  if (keyEmail) queries.push(() => customers.where('storeId', '==', storeId).where('emailKey', '==', keyEmail).limit(1).get())
  if (normalizedPhone) queries.push(() => customers.where('storeId', '==', storeId).where('phone', '==', normalizedPhone).limit(1).get())
  if (keyEmail) queries.push(() => customers.where('storeId', '==', storeId).where('email', '==', keyEmail).limit(1).get())

  for (const run of queries) {
    try {
      const snapshot = await run()
      if (!snapshot.empty) return snapshot.docs[0].ref
    } catch (error) {
      console.warn('[customer-identity] Indexed customer lookup failed', error)
    }
  }

  // Older intake-created customers may not have phoneKey/emailKey. Scan the
  // workspace only as a final compatibility fallback before creating a profile.
  try {
    const snapshot = await customers.where('storeId', '==', storeId).limit(500).get()
    for (const customerDoc of snapshot.docs) {
      const data = customerDoc.data()
      if (keyEmail && normalizeEmail(data.email) === keyEmail) return customerDoc.ref
      if (keyPhone && phoneKey(data.phone) === keyPhone) return customerDoc.ref
    }
  } catch (error) {
    console.warn('[customer-identity] Compatibility customer scan failed', error)
  }

  return null
}

export async function upsertCanonicalCustomer(firestore: Firestore, input: CanonicalCustomerInput) {
  const storeId = text(input.storeId, 180)
  const name = text(input.name, 220)
  const email = normalizeEmail(input.email)
  const phone = normalizePhone(input.phone)
  const keyPhone = phoneKey(phone)
  const keyEmail = email.toLowerCase()
  if (!storeId || (!name && !email && !phone)) return null

  const existingRef = await findExistingCustomer(firestore, storeId, phone, email)
  const sourceChannel = text(input.sourceChannel, 80) || 'student_registration'
  const sourceTag = text(input.sourceTag, 80) || 'student'
  const fallbackIdentity = text(input.identityKey, 220) || name || `${sourceChannel}-${Date.now()}`
  const contactKey = keyPhone
    ? `phone-${keyPhone}`
    : keyEmail
      ? `email-${identityHash(keyEmail)}`
      : `record-${slug(fallbackIdentity)}`
  const customerRef = existingRef || firestore.collection('customers').doc(`${storeId}_${contactKey}`)
  const now = FieldValue.serverTimestamp()

  const patch: Record<string, unknown> = {
    storeId,
    updatedAt: now,
    lastActivityAt: now,
    tags: FieldValue.arrayUnion(sourceTag, 'auto-captured'),
    sources: FieldValue.arrayUnion(sourceChannel),
  }

  if (!existingRef) {
    patch.createdAt = now
    patch.customerSource = sourceChannel
    if (name) {
      patch.name = name
      patch.displayName = name
    }
    if (phone) {
      patch.phone = phone
      patch.phoneKey = keyPhone
    }
    if (email) {
      patch.email = email
      patch.emailKey = keyEmail
    }
  } else {
    const snapshot = await existingRef.get()
    const existingName = text(snapshot.get('name'), 220)
    const existingDisplayName = text(snapshot.get('displayName'), 220)
    const existingPhone = normalizePhone(snapshot.get('phone'))
    const existingEmail = normalizeEmail(snapshot.get('email'))

    // Public registration can link to an established CRM profile, but it must
    // not be able to rename that profile or replace verified contact data.
    // Only fill identity fields that are genuinely blank.
    if (!existingName && !existingDisplayName && name) {
      patch.name = name
      patch.displayName = name
    } else {
      if (!existingName && existingDisplayName) patch.name = existingDisplayName
      if (!existingDisplayName && existingName) patch.displayName = existingName
    }

    if (existingPhone) {
      patch.phoneKey = phoneKey(existingPhone)
    } else if (phone) {
      patch.phone = phone
      patch.phoneKey = keyPhone
    }

    if (existingEmail) {
      patch.emailKey = existingEmail.toLowerCase()
    } else if (email) {
      patch.email = email
      patch.emailKey = keyEmail
    }
  }

  await customerRef.set(patch, { merge: true })
  return { customerId: customerRef.id, created: !existingRef }
}