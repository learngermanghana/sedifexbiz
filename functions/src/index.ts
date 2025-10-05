import * as functions from 'firebase-functions'
import { admin, defaultDb, rosterDb } from './firestore'

function serializeError(error: unknown) {
  if (error instanceof functions.https.HttpsError) {
    return {
      message: error.message,
      code: error.code,
      details: error.details,
      stack: error.stack,
    }
  }
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack }
  }
  return error
}

function logCallableError(
  functionName: string,
  error: unknown,
  context: functions.https.CallableContext,
  data: unknown,
) {
  functions.logger.error(`${functionName} callable failed`, {
    error: serializeError(error),
    uid: context.auth?.uid ?? null,
    hasAuth: Boolean(context.auth),
    data,
  })
}

const db = defaultDb

type ContactPayload = {
  phone?: unknown
  firstSignupEmail?: unknown
  ownerName?: unknown
  businessName?: unknown
}

type InitializeStorePayload = {
  contact?: ContactPayload
}

type ManageStaffPayload = {
  storeId?: unknown
  email?: unknown
  role?: unknown
  password?: unknown
}

const VALID_ROLES = new Set(['owner', 'staff'])
const INACTIVE_WORKSPACE_MESSAGE =
  'Your Sedifex workspace contract is not active. Reach out to your Sedifex administrator to restore access.'

function normalizeContactPayload(contact: ContactPayload | undefined) {
  let hasPhone = false
  let hasFirstSignupEmail = false
  let hasOwnerName = false
  let hasBusinessName = false
  let phone: string | null | undefined
  let firstSignupEmail: string | null | undefined
  let ownerName: string | null | undefined
  let businessName: string | null | undefined

  if (contact && typeof contact === 'object') {
    if ('phone' in contact) {
      hasPhone = true
      const raw = contact.phone
      if (raw === null || raw === undefined || raw === '') {
        phone = null
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim()
        phone = trimmed ? trimmed : null
      } else {
        throw new functions.https.HttpsError('invalid-argument', 'Phone must be a string when provided')
      }
    }

    if ('firstSignupEmail' in contact) {
      hasFirstSignupEmail = true
      const raw = contact.firstSignupEmail
      if (raw === null || raw === undefined || raw === '') {
        firstSignupEmail = null
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim().toLowerCase()
        firstSignupEmail = trimmed ? trimmed : null
      } else {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'First signup email must be a string when provided',
        )
      }
    }

    if ('ownerName' in contact) {
      hasOwnerName = true
      const raw = contact.ownerName
      if (raw === null || raw === undefined || raw === '') {
        ownerName = null
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim()
        ownerName = trimmed ? trimmed : null
      } else {
        throw new functions.https.HttpsError('invalid-argument', 'Owner name must be a string when provided')
      }
    }

    if ('businessName' in contact) {
      hasBusinessName = true
      const raw = contact.businessName
      if (raw === null || raw === undefined || raw === '') {
        businessName = null
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim()
        businessName = trimmed ? trimmed : null
      } else {
        throw new functions.https.HttpsError('invalid-argument', 'Business name must be a string when provided')
      }
    }
  }

  return {
    phone,
    hasPhone,
    firstSignupEmail,
    hasFirstSignupEmail,
    ownerName,
    hasOwnerName,
    businessName,
    hasBusinessName,
  }
}

function getRoleFromToken(token: Record<string, unknown> | undefined) {
  const role = typeof token?.role === 'string' ? (token.role as string) : null
  return role && VALID_ROLES.has(role) ? role : null
}

function assertAuthenticated(context: functions.https.CallableContext) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required')
  }
}

function assertOwnerAccess(context: functions.https.CallableContext) {
  assertAuthenticated(context)
  const role = getRoleFromToken(context.auth!.token as Record<string, unknown>)
  if (role !== 'owner') {
    throw new functions.https.HttpsError('permission-denied', 'Owner access required')
  }
}

function assertStaffAccess(context: functions.https.CallableContext) {
  assertAuthenticated(context)
  const role = getRoleFromToken(context.auth!.token as Record<string, unknown>)
  if (!role) {
    throw new functions.https.HttpsError('permission-denied', 'Staff access required')
  }
}

async function updateUserClaims(uid: string, role: string) {
  const userRecord = await admin
    .auth()
    .getUser(uid)
    .catch(() => null)
  const existingClaims = (userRecord?.customClaims ?? {}) as Record<string, unknown>
  const nextClaims: Record<string, unknown> = { ...existingClaims }
  nextClaims.role = role
  delete nextClaims.stores
  delete nextClaims.activeStoreId
  delete nextClaims.storeId
  delete nextClaims.roleByStore
  await admin.auth().setCustomUserClaims(uid, nextClaims)
  return nextClaims
}

function normalizeManageStaffPayload(data: ManageStaffPayload) {
  const storeIdRaw = data.storeId
  const storeId = typeof storeIdRaw === 'string' ? storeIdRaw.trim() : ''
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
  const role = typeof data.role === 'string' ? data.role.trim() : ''
  const passwordRaw = data.password
  let password: string | undefined
  if (passwordRaw === null || passwordRaw === undefined || passwordRaw === '') {
    password = undefined
  } else if (typeof passwordRaw === 'string') {
    password = passwordRaw
  } else {
    throw new functions.https.HttpsError('invalid-argument', 'Password must be a string when provided')
  }

  if (!storeId) throw new functions.https.HttpsError('invalid-argument', 'A storeId is required')
  if (!email) throw new functions.https.HttpsError('invalid-argument', 'A valid email is required')
  if (!role) throw new functions.https.HttpsError('invalid-argument', 'A role is required')
  if (!VALID_ROLES.has(role)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unsupported role requested')
  }

  return { storeId, email, role, password }
}

async function ensureAuthUser(email: string, password?: string) {
  try {
    const record = await admin.auth().getUserByEmail(email)
    if (password) await admin.auth().updateUser(record.uid, { password })
    return { record, created: false }
  } catch (error: any) {
    if (error?.code === 'auth/user-not-found') {
      if (!password) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'A password is required when creating a new staff account',
        )
      }
      const record = await admin.auth().createUser({ email, password, emailVerified: false })
      return { record, created: true }
    }
    throw error
  }
}

type SeededDocument = {
  id: string
  data: admin.firestore.DocumentData
}

function getOptionalString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }
  return null
}

function getOptionalEmail(value: unknown): string | null {
  const candidate = getOptionalString(value)
  return candidate ? candidate.toLowerCase() : null
}

function isInactiveContractStatus(value: string | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean)
  const tokenSet = new Set(tokens)
  const inactiveTokens = [
    'inactive',
    'terminated',
    'termination',
    'cancelled',
    'canceled',
    'suspended',
    'paused',
    'hold',
    'closed',
    'ended',
    'deactivated',
    'disabled',
  ]
  return inactiveTokens.some(token => tokenSet.has(token))
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildSeedId(storeId: string, candidate: string | null, fallback: string): string {
  const normalizedCandidate = candidate ? slugify(candidate) : ''
  if (normalizedCandidate) {
    return normalizedCandidate
  }
  return `${storeId}_${fallback}`
}

function toSeedRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
    )
  }
  return []
}

function mapProductSeeds(records: Record<string, unknown>[], storeId: string): SeededDocument[] {
  return records
    .map((product, index) => {
      const name =
        getOptionalString(
          product.name ?? product.productName ?? product.displayName ?? product.title ?? undefined,
        ) ?? null
      const sku = getOptionalString(product.sku ?? product.code ?? product.productSku ?? undefined)
      const idCandidate =
        getOptionalString(
          product.id ?? product.productId ?? product.identifier ?? product.externalId ?? sku ?? name ?? undefined,
        ) ?? null

      const data: admin.firestore.DocumentData = { storeId }
      for (const [key, value] of Object.entries(product)) {
        if (key === 'id') continue
        data[key] = value
      }

      if (name && !data.name) data.name = name
      if (sku && !data.sku) data.sku = sku
      if (Object.keys(data).length <= 1) return null

      const seedId = buildSeedId(storeId, idCandidate, `product_${index + 1}`)
      return { id: seedId, data }
    })
    .filter((item): item is SeededDocument => item !== null)
}

function mapCustomerSeeds(records: Record<string, unknown>[], storeId: string): SeededDocument[] {
  return records
    .map((customer, index) => {
      const primaryName =
        getOptionalString(
          customer.displayName ??
            customer.display_name ??
            customer.primaryName ??
            customer.primary_name ??
            undefined,
        ) ?? null
      const fallbackName =
        getOptionalString(
          customer.name ?? customer.customerName ?? customer.customer_name ?? customer.displayName ?? undefined,
        ) ?? primaryName
      const email = getOptionalEmail(customer.email ?? customer.contactEmail ?? customer.contact_email ?? undefined)
      const phone = getOptionalString(
        customer.phone ?? customer.phoneNumber ?? customer.phone_number ?? customer.contactPhone ?? undefined,
      )

      if (!primaryName && !fallbackName && !email && !phone) {
        return null
      }

      const identifierCandidate =
        getOptionalString(
          customer.id ??
            customer.customerId ??
            customer.customer_id ??
            customer.identifier ??
            customer.externalId ??
            customer.external_id ??
            email ??
            phone ??
            primaryName ??
            fallbackName ??
            undefined,
        ) ?? null

      const labelFallback = fallbackName ?? primaryName ?? email ?? phone ?? `customer_${index + 1}`

      const data: admin.firestore.DocumentData = { storeId }
      for (const [key, value] of Object.entries(customer)) {
        if (key === 'id') continue
        data[key] = value
      }

      if (primaryName && !data.displayName) data.displayName = primaryName
      if (!data.name) data.name = labelFallback

      const seedId = buildSeedId(storeId, identifierCandidate, `customer_${index + 1}`)
      return { id: seedId, data }
    })
    .filter((item): item is SeededDocument => item !== null)
}

function serializeFirestoreData(data: admin.firestore.DocumentData): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof admin.firestore.Timestamp) {
      result[key] = value.toMillis()
    } else if (value && typeof value === 'object' && '_millis' in value) {
      const millis = (value as { _millis?: unknown })._millis
      result[key] = typeof millis === 'number' ? millis : value
    } else if (Array.isArray(value)) {
      result[key] = value.map(item =>
        item instanceof admin.firestore.Timestamp ? item.toMillis() : item,
      )
    } else {
      result[key] = value
    }
  }
  return result
}

export const handleUserCreate = functions.auth.user().onCreate(async user => {
  const uid = user.uid
  const email = typeof user.email === 'string' ? user.email.toLowerCase() : null
  const memberRef = rosterDb.collection('teamMembers').doc(uid)
  const memberSnap = await memberRef.get()
  const existingData = (memberSnap.data() ?? {}) as admin.firestore.DocumentData
  const timestamp = admin.firestore.FieldValue.serverTimestamp()

  const memberData: admin.firestore.DocumentData = {
    uid,
    email: user.email ?? existingData.email ?? null,
    phone: user.phoneNumber ?? existingData.phone ?? null,
    updatedAt: timestamp,
  }

  if (!memberSnap.exists) {
    memberData.createdAt = timestamp
  }

  await memberRef.set(memberData, { merge: true })

  if (email) {
    const emailRef = rosterDb.collection('teamMembers').doc(email)
    const emailSnap = await emailRef.get()
    const emailData: admin.firestore.DocumentData = {
      uid,
      email: user.email ?? existingData.email ?? null,
      phone: memberData.phone ?? null,
      updatedAt: timestamp,
    }
    const storeId = getOptionalString(existingData.storeId ?? undefined)
    if (storeId) emailData.storeId = storeId
    const role = getOptionalString(existingData.role ?? undefined)
    if (role) emailData.role = role
    if (typeof existingData.firstSignupEmail === 'string') {
      emailData.firstSignupEmail = existingData.firstSignupEmail
    }
    if (typeof existingData.invitedBy === 'string') {
      emailData.invitedBy = existingData.invitedBy
    }
    if (!emailSnap.exists) {
      emailData.createdAt = timestamp
    }
    await emailRef.set(emailData, { merge: true })
  }
})

async function initializeStoreImpl(
  data: unknown,
  context: functions.https.CallableContext,
) {
  assertAuthenticated(context)

  const uid = context.auth!.uid
  const token = context.auth!.token as Record<string, unknown>
  const email = typeof token.email === 'string' ? (token.email as string) : null
  const normalizedEmail = email ? email.toLowerCase() : null
  const tokenPhone = typeof token.phone_number === 'string' ? (token.phone_number as string) : null

  const payload = (data ?? {}) as InitializeStorePayload
  const contact = normalizeContactPayload(payload.contact)
  const resolvedPhone = contact.hasPhone ? contact.phone ?? null : tokenPhone ?? null
  const resolvedFirstSignupEmail = contact.hasFirstSignupEmail
    ? contact.firstSignupEmail ?? null
    : email?.toLowerCase() ?? null
  const resolvedOwnerName = contact.hasOwnerName ? contact.ownerName ?? null : null
  const resolvedBusinessName = contact.hasBusinessName ? contact.businessName ?? null : null

  const memberRef = rosterDb.collection('teamMembers').doc(uid)
  const memberSnap = await memberRef.get()
  const timestamp = admin.firestore.FieldValue.serverTimestamp()
  const existingData = memberSnap.data() ?? {}
  const existingStoreId =
    typeof existingData.storeId === 'string' && existingData.storeId.trim() !== ''
      ? (existingData.storeId as string)
      : null
  const storeId = existingStoreId ?? uid

  const memberData: admin.firestore.DocumentData = {
    uid,
    email,
    role: 'owner',
    storeId,
    phone: resolvedPhone,
    firstSignupEmail: resolvedFirstSignupEmail,
    invitedBy: uid,
    updatedAt: timestamp,
  }

  if (resolvedOwnerName !== null) {
    memberData.name = resolvedOwnerName
  }

  if (resolvedBusinessName !== null) {
    memberData.companyName = resolvedBusinessName
  }

  if (!memberSnap.exists) {
    memberData.createdAt = timestamp
  }

  await memberRef.set(memberData, { merge: true })

  if (normalizedEmail) {
    const emailRef = rosterDb.collection('teamMembers').doc(normalizedEmail)
    const emailSnap = await emailRef.get()
    const emailData: admin.firestore.DocumentData = {
      uid,
      email,
      role: 'owner',
      storeId,
      phone: resolvedPhone,
      firstSignupEmail: resolvedFirstSignupEmail,
      invitedBy: uid,
      updatedAt: timestamp,
    }

    if (resolvedOwnerName !== null) {
      emailData.name = resolvedOwnerName
    }

    if (resolvedBusinessName !== null) {
      emailData.companyName = resolvedBusinessName
    }
    if (!emailSnap.exists) {
      emailData.createdAt = timestamp
    }
    await emailRef.set(emailData, { merge: true })
  }

  const storeRef = defaultDb.collection('stores').doc(storeId)
  const storeSnap = await storeRef.get()
  const storeData: admin.firestore.DocumentData = {
    ownerId: uid,
    updatedAt: timestamp,
    status: 'Active',
    contractStatus: 'Active',
  }
  if (email) {
    storeData.ownerEmail = email
  }
  if (resolvedOwnerName) {
    storeData.ownerName = resolvedOwnerName
  }
  if (resolvedBusinessName) {
    storeData.displayName = resolvedBusinessName
    storeData.businessName = resolvedBusinessName
  }
  if (!storeSnap.exists) {
    storeData.createdAt = timestamp
  }
  await storeRef.set(storeData, { merge: true })
  const claims = await updateUserClaims(uid, 'owner')

  return { ok: true, claims, storeId }
}

export const initializeStore = functions.https.onCall(async (data, context) => {
  try {
    return await initializeStoreImpl(data, context)
  } catch (error) {
    logCallableError('initializeStore', error, context, data)
    throw error
  }
})

export const resolveStoreAccess = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context)

  const uid = context.auth!.uid
  const token = context.auth!.token as Record<string, unknown>
  const emailFromToken = typeof token.email === 'string' ? (token.email as string).toLowerCase() : null

  const rawPayload = (data ?? {}) as { storeId?: unknown } | unknown
  let requestedStoreId: string | null = null
  if (typeof rawPayload === 'object' && rawPayload !== null && 'storeId' in rawPayload) {
    const candidate = (rawPayload as { storeId?: unknown }).storeId
    if (typeof candidate !== 'string') {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Enter the store ID assigned to your Sedifex workspace.',
      )
    }
    const trimmed = candidate.trim()
    if (!trimmed) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Enter the store ID assigned to your Sedifex workspace.',
      )
    }
    requestedStoreId = trimmed
  }

  if (!emailFromToken) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'A verified email is required to resolve store access for this account.',
    )
  }

  const teamMembersCollection = rosterDb.collection('teamMembers')
  const memberRef = teamMembersCollection.doc(uid)
  const rosterEmailRef = teamMembersCollection.doc(emailFromToken)
  const [memberSnap, rosterEmailSnap] = await Promise.all([memberRef.get(), rosterEmailRef.get()])
  const existingMember = (memberSnap.data() ?? {}) as admin.firestore.DocumentData
  const emailMember = (rosterEmailSnap.data() ?? {}) as admin.firestore.DocumentData

  if (!memberSnap.exists && !rosterEmailSnap.exists) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'We could not find a workspace assignment for this account. Reach out to your Sedifex administrator.',
    )
  }

  const rosterStoreIdFromMember =
    getOptionalString(existingMember.storeId ?? existingMember.storeID ?? existingMember.store_id ?? undefined) ?? null
  const rosterStoreIdFromEmail =
    getOptionalString(emailMember.storeId ?? emailMember.storeID ?? emailMember.store_id ?? undefined) ?? null

  let rosterStoreId = rosterStoreIdFromMember ?? rosterStoreIdFromEmail ?? null

  const rosterEntry: admin.firestore.DocumentData = { ...emailMember }
  for (const [key, value] of Object.entries(existingMember)) {
    if (value !== undefined) {
      rosterEntry[key] = value
    }
  }
  if (rosterStoreId) {
    rosterEntry.storeId = rosterStoreId
  }

  const missingStoreIdMessage =
    'We could not confirm the store ID assigned to your Sedifex workspace. Reach out to your Sedifex administrator.'

  if (!rosterStoreId) {
    throw new functions.https.HttpsError('failed-precondition', missingStoreIdMessage)
  }

  if (requestedStoreId !== null && requestedStoreId !== rosterStoreId) {
    throw new functions.https.HttpsError(
      'permission-denied',
      `Your account is assigned to store ${rosterStoreId}. Enter the correct store ID to continue.`,
    )
  }

  const storeId = rosterStoreId

  const storesCollection = defaultDb.collection('stores')
  let storeRef = storesCollection.doc(storeId)
  let storeSnap = await storeRef.get()

  if (!storeSnap.exists) {
    const ownerIdCandidates = [storeId, uid]
      .map(value => (typeof value === 'string' ? value.trim() : ''))
      .filter((value): value is string => Boolean(value))

    let fallbackSnap: admin.firestore.QueryDocumentSnapshot<admin.firestore.DocumentData> | null = null

    for (const ownerId of ownerIdCandidates) {
      const fallbackQuery = await storesCollection.where('ownerId', '==', ownerId).limit(1).get()
      const match = fallbackQuery.docs[0]
      if (match) {
        fallbackSnap = match
        break
      }
    }

    if (fallbackSnap) {
      storeRef = fallbackSnap.ref
      storeSnap = fallbackSnap
    } else {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'We could not locate the Sedifex workspace configuration for this store. Reach out to your Sedifex administrator.',
      )
    }
  }

  const storeData = (storeSnap.data() ?? {}) as admin.firestore.DocumentData
  const storeStatus = getOptionalString(storeData.status ?? storeData.contractStatus ?? undefined)
  if (isInactiveContractStatus(storeStatus)) {
    throw new functions.https.HttpsError('permission-denied', INACTIVE_WORKSPACE_MESSAGE)
  }

  const now = admin.firestore.Timestamp.now()

  const memberCreatedAt =
    memberSnap.exists && existingMember.createdAt instanceof admin.firestore.Timestamp
      ? (existingMember.createdAt as admin.firestore.Timestamp)
      : now

  const rosterRoleRaw = getOptionalString(rosterEntry.role ?? rosterEntry.memberRole ?? undefined)
  let resolvedRole = 'staff'
  if (rosterRoleRaw) {
    const normalizedRole = rosterRoleRaw.toLowerCase()
    if (VALID_ROLES.has(normalizedRole)) {
      resolvedRole = normalizedRole
    } else if (normalizedRole.includes('owner')) {
      resolvedRole = 'owner'
    }
  } else if (typeof existingMember.role === 'string' && VALID_ROLES.has(existingMember.role)) {
    resolvedRole = existingMember.role
  }

  const rosterPhone =
    getOptionalString(rosterEntry.phone ?? rosterEntry.contactPhone ?? rosterEntry.phoneNumber ?? undefined) ??
    (typeof existingMember.phone === 'string' ? existingMember.phone : null)
  const rosterName =
    getOptionalString(rosterEntry.name ?? rosterEntry.displayName ?? rosterEntry.memberName ?? undefined) ??
    (typeof existingMember.name === 'string' ? existingMember.name : null)
  const rosterFirstSignupEmail =
    getOptionalEmail(
      rosterEntry.firstSignupEmail ??
        rosterEntry.signupEmail ??
        rosterEntry.primaryEmail ??
        rosterEntry.memberEmail ??
        undefined,
    ) ??
    (typeof existingMember.firstSignupEmail === 'string'
      ? existingMember.firstSignupEmail
      : emailFromToken)
  const rosterInvitedBy =
    getOptionalString(rosterEntry.invitedBy ?? rosterEntry.inviterUid ?? rosterEntry.invited_by ?? undefined) ??
    (typeof existingMember.invitedBy === 'string' ? existingMember.invitedBy : null)

  const memberData: admin.firestore.DocumentData = {
    uid,
    storeId,
    role: resolvedRole,
    email: emailFromToken,
    updatedAt: now,
    createdAt: memberCreatedAt,
  }
  if (rosterPhone) memberData.phone = rosterPhone
  if (rosterName) memberData.name = rosterName
  if (rosterFirstSignupEmail) memberData.firstSignupEmail = rosterFirstSignupEmail
  if (rosterInvitedBy) memberData.invitedBy = rosterInvitedBy

  await memberRef.set(memberData, { merge: true })
  await rosterEmailRef.set({ uid, lastResolvedAt: now }, { merge: true })

  const productSeedRecords = toSeedRecords(storeData.seedProducts ?? rosterEntry.seedProducts ?? null)
  const customerSeedRecords = toSeedRecords(storeData.seedCustomers ?? rosterEntry.seedCustomers ?? null)

  const productSeeds = mapProductSeeds(productSeedRecords, storeId)
  const customerSeeds = mapCustomerSeeds(customerSeedRecords, storeId)

  const productResults = await Promise.all(
    productSeeds.map(async seed => {
      const ref = defaultDb.collection('products').doc(seed.id)
      const snapshot = await ref.get()
      const existingProduct = (snapshot.data() ?? {}) as admin.firestore.DocumentData
      const productCreatedAt =
        snapshot.exists && existingProduct.createdAt instanceof admin.firestore.Timestamp
          ? (existingProduct.createdAt as admin.firestore.Timestamp)
          : now
      const productData: admin.firestore.DocumentData = {
        ...seed.data,
        createdAt: productCreatedAt,
        updatedAt: now,
      }
      await ref.set(productData, { merge: true })
      return { id: ref.id, data: productData }
    }),
  )

  const customerResults = await Promise.all(
    customerSeeds.map(async seed => {
      const ref = defaultDb.collection('customers').doc(seed.id)
      const snapshot = await ref.get()
      const existingCustomer = (snapshot.data() ?? {}) as admin.firestore.DocumentData
      const customerCreatedAt =
        snapshot.exists && existingCustomer.createdAt instanceof admin.firestore.Timestamp
          ? (existingCustomer.createdAt as admin.firestore.Timestamp)
          : now
      const customerData: admin.firestore.DocumentData = {
        ...seed.data,
        createdAt: customerCreatedAt,
        updatedAt: now,
      }
      await ref.set(customerData, { merge: true })
      return { id: ref.id, data: customerData }
    }),
  )

  const claims = await updateUserClaims(uid, resolvedRole)

  const storeResponseData: admin.firestore.DocumentData = { ...storeData, storeId }

  return {
    ok: true,
    storeId,
    role: resolvedRole,
    claims,
    teamMember: { id: memberRef.id, data: serializeFirestoreData(memberData) },
    store: { id: storeRef.id, data: serializeFirestoreData(storeResponseData) },
    products: productResults.map(item => ({ id: item.id, data: serializeFirestoreData(item.data) })),
    customers: customerResults.map(item => ({ id: item.id, data: serializeFirestoreData(item.data) })),
  }
})

export const manageStaffAccount = functions.https.onCall(async (data, context) => {
  assertOwnerAccess(context)

  const { storeId, email, role, password } = normalizeManageStaffPayload(data as ManageStaffPayload)
  const invitedBy = context.auth?.uid ?? null
  const { record, created } = await ensureAuthUser(email, password)

  const memberRef = rosterDb.collection('teamMembers').doc(record.uid)
  const memberSnap = await memberRef.get()
  const timestamp = admin.firestore.FieldValue.serverTimestamp()

  const memberData: admin.firestore.DocumentData = {
    uid: record.uid,
    email,
    storeId,
    role,
    invitedBy,
    updatedAt: timestamp,
  }

  if (!memberSnap.exists) {
    memberData.createdAt = timestamp
  }

  await memberRef.set(memberData, { merge: true })
  const emailRef = rosterDb.collection('teamMembers').doc(email)
  const emailSnap = await emailRef.get()
  const emailData: admin.firestore.DocumentData = {
    uid: record.uid,
    email,
    storeId,
    role,
    invitedBy,
    updatedAt: timestamp,
  }
  if (!emailSnap.exists) {
    emailData.createdAt = timestamp
  }
  await emailRef.set(emailData, { merge: true })
  const claims = await updateUserClaims(record.uid, role)

  return { ok: true, role, email, uid: record.uid, created, storeId, claims }
})

export const commitSale = functions.https.onCall(async (data, context) => {
  assertStaffAccess(context)

  const { branchId, items, totals, cashierId, saleId: saleIdRaw, payment, customer } = data || {}

  const saleId = typeof saleIdRaw === 'string' ? saleIdRaw.trim() : ''
  if (!saleId) throw new functions.https.HttpsError('invalid-argument', 'A valid saleId is required')

  const normalizedBranchIdRaw = typeof branchId === 'string' ? branchId.trim() : ''
  if (!normalizedBranchIdRaw) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid branch identifier is required')
  }
  const normalizedBranchId = normalizedBranchIdRaw

  const saleRef = db.collection('sales').doc(saleId)
  const saleItemsRef = db.collection('saleItems')

  await db.runTransaction(async tx => {
    const existingSale = await tx.get(saleRef)
    if (existingSale.exists) throw new functions.https.HttpsError('already-exists', 'Sale has already been committed')

    const normalizedItems = Array.isArray(items)
      ? items.map((it: any) => {
          const productId = typeof it?.productId === 'string' ? it.productId : null
          const name = typeof it?.name === 'string' ? it.name : null
          const qty = Number(it?.qty ?? 0) || 0
          const price = Number(it?.price ?? 0) || 0
          const taxRate = Number(it?.taxRate ?? 0) || 0
          return { productId, name, qty, price, taxRate }
        })
      : []

    const timestamp = admin.firestore.FieldValue.serverTimestamp()

    tx.set(saleRef, {
      branchId: normalizedBranchId,
      storeId: normalizedBranchId,
      cashierId,
      total: totals?.total ?? 0,
      taxTotal: totals?.taxTotal ?? 0,
      payment: payment ?? null,
      customer: customer ?? null,
      items: normalizedItems,
      createdBy: context.auth?.uid ?? null,
      createdAt: timestamp,
    })

    for (const it of normalizedItems) {
      if (!it.productId) {
        throw new functions.https.HttpsError('failed-precondition', 'Bad product')
      }
      const itemId = db.collection('_').doc().id
      tx.set(saleItemsRef.doc(itemId), {
        saleId,
        productId: it.productId,
        qty: it.qty,
        price: it.price,
        taxRate: it.taxRate,
        storeId: normalizedBranchId,
        createdAt: timestamp,
      })

      const pRef = db.collection('products').doc(it.productId)
      const pSnap = await tx.get(pRef)
      if (!pSnap.exists) {
        throw new functions.https.HttpsError('failed-precondition', 'Bad product')
      }
      const curr = Number(pSnap.get('stockCount') || 0)
      const next = curr - Math.abs(it.qty || 0)
      tx.update(pRef, { stockCount: next, updatedAt: timestamp })

      const ledgerId = db.collection('_').doc().id
      tx.set(db.collection('ledger').doc(ledgerId), {
        productId: it.productId,
        qtyChange: -Math.abs(it.qty || 0),
        type: 'sale',
        refId: saleId,
        storeId: normalizedBranchId,
        createdAt: timestamp,
      })
    }
  })

  return { ok: true, saleId }
})

export const receiveStock = functions.https.onCall(async (data, context) => {
  assertStaffAccess(context)

  const { productId, qty, supplier, reference, unitCost } = data || {}

  const productIdStr = typeof productId === 'string' ? productId : null
  if (!productIdStr) throw new functions.https.HttpsError('invalid-argument', 'A product must be selected')

  const amount = Number(qty)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Quantity must be greater than zero')
  }

  const normalizedSupplier = typeof supplier === 'string' ? supplier.trim() : ''
  if (!normalizedSupplier) throw new functions.https.HttpsError('invalid-argument', 'Supplier is required')

  const normalizedReference = typeof reference === 'string' ? reference.trim() : ''
  if (!normalizedReference) throw new functions.https.HttpsError('invalid-argument', 'Reference number is required')

  let normalizedUnitCost: number | null = null
  if (unitCost !== undefined && unitCost !== null && unitCost !== '') {
    const parsedCost = Number(unitCost)
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Cost must be zero or greater when provided')
    }
    normalizedUnitCost = parsedCost
  }

  const productRef = db.collection('products').doc(productIdStr)
  const receiptRef = db.collection('receipts').doc()
  const ledgerRef = db.collection('ledger').doc()

  await db.runTransaction(async tx => {
    const pSnap = await tx.get(productRef)
    if (!pSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Bad product')
    }

    const productStoreIdRaw = pSnap.get('storeId')
    const productStoreId = typeof productStoreIdRaw === 'string' ? productStoreIdRaw.trim() : null

    const currentStock = Number(pSnap.get('stockCount') || 0)
    const nextStock = currentStock + amount
    const timestamp = admin.firestore.FieldValue.serverTimestamp()

    tx.update(productRef, {
      stockCount: nextStock,
      updatedAt: timestamp,
      lastReceivedAt: timestamp,
      lastReceivedQty: amount,
      lastReceivedCost: normalizedUnitCost,
    })

    const totalCost =
      normalizedUnitCost === null ? null : Math.round((normalizedUnitCost * amount + Number.EPSILON) * 100) / 100

    tx.set(receiptRef, {
      productId: productIdStr,
      qty: amount,
      supplier: normalizedSupplier,
      reference: normalizedReference,
      unitCost: normalizedUnitCost,
      totalCost,
      receivedBy: context.auth?.uid ?? null,
      createdAt: timestamp,
      storeId: productStoreId,
    })

    tx.set(ledgerRef, {
      productId: productIdStr,
      qtyChange: amount,
      type: 'receipt',
      refId: receiptRef.id,
      storeId: productStoreId,
      createdAt: timestamp,
    })
  })

  return { ok: true, receiptId: receiptRef.id }
})
