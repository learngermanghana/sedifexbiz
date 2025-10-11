// functions/src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Billing config (plans & trial)
import { getBillingConfig, type PlanId } from './plans'

// Re-export any other triggers so they’re included in the build
export { onAuthCreate } from './onAuthCreate'

import * as functions from 'firebase-functions'
import { admin, defaultDb } from './firestore'
import { buildSimplePdf } from './utils/pdf'

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

export { confirmPayment } from './confirmPayment'


type ContactPayload = {
  phone?: unknown
  firstSignupEmail?: unknown
  ownerName?: unknown
  businessName?: unknown
  country?: unknown
  town?: unknown
  signupRole?: unknown
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
  let hasCountry = false
  let hasTown = false
  let hasSignupRole = false
  let phone: string | null | undefined
  let firstSignupEmail: string | null | undefined
  let ownerName: string | null | undefined
  let businessName: string | null | undefined
  let country: string | null | undefined
  let town: string | null | undefined
  let signupRole: 'owner' | 'team-member' | null | undefined

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

    if ('country' in contact) {
      hasCountry = true
      const raw = contact.country
      if (raw === null || raw === undefined || raw === '') {
        country = null
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim()
        country = trimmed ? trimmed : null
      } else {
        throw new functions.https.HttpsError('invalid-argument', 'Country must be a string when provided')
      }
    }

    if ('town' in contact) {
      hasTown = true
      const raw = contact.town
      if (raw === null || raw === undefined || raw === '') {
        town = null
      } else if (typeof raw === 'string') {
        const trimmed = raw.trim()
        town = trimmed ? trimmed : null
      } else {
        throw new functions.https.HttpsError('invalid-argument', 'Town must be a string when provided')
      }
    }

    if ('signupRole' in contact) {
      hasSignupRole = true
      const raw = contact.signupRole
      if (raw === null || raw === undefined || raw === '') {
        signupRole = null
      } else if (typeof raw === 'string') {
        const normalized = raw.trim().toLowerCase().replace(/[_\s]+/g, '-')
        if (normalized === 'owner') {
          signupRole = 'owner'
        } else if (normalized === 'team-member' || normalized === 'team') {
          signupRole = 'team-member'
        } else {
          signupRole = null
        }
      } else {
        throw new functions.https.HttpsError('invalid-argument', 'Signup role must be a string when provided')
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
    country,
    hasCountry,
    town,
    hasTown,
    signupRole,
    hasSignupRole,
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
          (product as any).name ?? (product as any).productName ?? (product as any).displayName ?? (product as any).title ?? undefined,
        ) ?? null
      const sku = getOptionalString((product as any).sku ?? (product as any).code ?? (product as any).productSku ?? undefined)
      const idCandidate =
        getOptionalString(
          (product as any).id ?? (product as any).productId ?? (product as any).identifier ?? (product as any).externalId ?? sku ?? name ?? undefined,
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
          (customer as any).displayName ??
            (customer as any).display_name ??
            (customer as any).primaryName ??
            (customer as any).primary_name ??
            undefined,
        ) ?? null
      const fallbackName =
        getOptionalString(
          (customer as any).name ?? (customer as any).customerName ?? (customer as any).customer_name ?? (customer as any).displayName ?? undefined,
        ) ?? primaryName
      const email = getOptionalEmail((customer as any).email ?? (customer as any).contactEmail ?? (customer as any).contact_email ?? undefined)
      const phone = getOptionalString(
        (customer as any).phone ?? (customer as any).phoneNumber ?? (customer as any).phone_number ?? (customer as any).contactPhone ?? undefined,
      )

      if (!primaryName && !fallbackName && !email && !phone) {
        return null
      }

      const identifierCandidate =
        getOptionalString(
          (customer as any).id ??
            (customer as any).customerId ??
            (customer as any).customer_id ??
            (customer as any).identifier ??
            (customer as any).externalId ??
            (customer as any).external_id ??
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
  const memberRef = db.collection('teamMembers').doc(uid)
  const emailRef = email ? db.collection('teamMembers').doc(email) : null
  const [memberSnap, emailSnap] = await Promise.all([
    memberRef.get(),
    emailRef ? emailRef.get() : Promise.resolve(null),
  ])
  const existingData = (memberSnap.data() ?? {}) as admin.firestore.DocumentData
  const existingEmailData = (emailSnap?.data() ?? {}) as admin.firestore.DocumentData
  const timestamp = admin.firestore.FieldValue.serverTimestamp()

  const resolvedEmail = user.email ?? existingData.email ?? existingEmailData.email ?? null
  const resolvedPhone = user.phoneNumber ?? existingData.phone ?? existingEmailData.phone ?? null
  const resolvedStoreId =
    getOptionalString(
      (existingData as any).storeId ?? (existingData as any).storeID ?? (existingData as any).store_id ?? undefined,
    ) ??
    getOptionalString(
      (existingEmailData as any).storeId ?? (existingEmailData as any).storeID ?? (existingEmailData as any).store_id ?? undefined,
    ) ??
    null
  const resolvedRoleRaw =
    getOptionalString((existingData as any).role ?? (existingEmailData as any).role ?? (existingEmailData as any).memberRole ?? undefined) ??
    null
  const resolvedRole = resolvedRoleRaw
    ? VALID_ROLES.has(resolvedRoleRaw.toLowerCase())
      ? resolvedRoleRaw.toLowerCase()
      : resolvedRoleRaw
    : null
  const resolvedFirstSignupEmail =
    typeof (existingData as any).firstSignupEmail === 'string'
      ? (existingData as any).firstSignupEmail
      : typeof (existingEmailData as any).firstSignupEmail === 'string'
      ? (existingEmailData as any).firstSignupEmail
      : null
  const resolvedInvitedBy =
    getOptionalString((existingData as any).invitedBy ?? (existingEmailData as any).invitedBy ?? undefined) ?? null
  const resolvedName =
    getOptionalString((existingData as any).name ?? (existingEmailData as any).name ?? (existingEmailData as any).displayName ?? undefined) ??
    null
  const resolvedCompanyName =
    getOptionalString(
      (existingData as any).companyName ??
        (existingEmailData as any).companyName ??
        (existingEmailData as any).businessName ??
        (existingEmailData as any).workspaceName ??
        undefined,
    ) ?? null
  const resolvedStatus =
    getOptionalString((existingData as any).status ?? (existingEmailData as any).status ?? undefined) ?? null
  const resolvedContractStatus =
    getOptionalString(
      (existingData as any).contractStatus ?? (existingEmailData as any).contractStatus ?? (existingEmailData as any).contract_status ?? undefined,
    ) ?? null

  const storeId = resolvedStoreId ?? uid
  const shouldSeedDefaultStore = !resolvedStoreId

  const memberData: admin.firestore.DocumentData = {
    ...existingEmailData,
    ...existingData,
    uid,
    email: resolvedEmail,
    phone: resolvedPhone,
    updatedAt: timestamp,
  }

  if (resolvedStoreId) {
    (memberData as any).storeId = resolvedStoreId
  } else {
    const currentStoreId = getOptionalString((memberData as any).storeId ?? undefined)
    if (!currentStoreId) {
      (memberData as any).storeId = storeId
    }
  }

  if (resolvedRole) {
    (memberData as any).role = resolvedRole
  } else if (shouldSeedDefaultStore) {
    const currentRole = getOptionalString((memberData as any).role ?? undefined)
    if (!currentRole) {
      (memberData as any).role = 'owner'
    }
  }
  if (resolvedFirstSignupEmail !== null) (memberData as any).firstSignupEmail = resolvedFirstSignupEmail
  if (resolvedInvitedBy) (memberData as any).invitedBy = resolvedInvitedBy
  if (resolvedName) (memberData as any).name = resolvedName
  if (resolvedCompanyName) (memberData as any).companyName = resolvedCompanyName
  if (resolvedStatus) (memberData as any).status = resolvedStatus
  if (resolvedContractStatus) (memberData as any).contractStatus = resolvedContractStatus

  if (!memberSnap.exists) {
    if ((memberData as any).createdAt === undefined) {
      ;(memberData as any).createdAt = timestamp
    }
  }

  await memberRef.set(memberData, { merge: true })

  if (email && emailRef) {
    const emailData: admin.firestore.DocumentData = {
      ...existingEmailData,
      ...memberData,
      uid,
      email: resolvedEmail,
      updatedAt: timestamp,
    }

    if (!emailSnap?.exists) {
      if ((emailData as any).createdAt === undefined) {
        ;(emailData as any).createdAt = timestamp
      }
    } else {
      delete (emailData as any).createdAt
    }

    await emailRef.set(emailData, { merge: true })
  }

  if (shouldSeedDefaultStore) {
    const storeRef = defaultDb.collection('stores').doc(storeId)
    const storeSnap = await storeRef.get()

    // Add default billing on first seed too (parity with initializeStore)
    const { trialDays } = getBillingConfig()
    const trialEndsAt = admin.firestore.Timestamp.fromMillis(Date.now() + trialDays * 24 * 60 * 60 * 1000)

    const storeData: admin.firestore.DocumentData = {
      ownerId: uid,
      status: 'Active',
      contractStatus: 'Active',
      billing: {
        planId: ('starter' as PlanId),
        status: 'trial',
        trialEndsAt,
        provider: 'paystack',
      },
      inventorySummary: {
        trackedSkus: 0,
        lowStockSkus: 0,
        incomingShipments: 0,
      },
      updatedAt: timestamp,
    }

    if (resolvedEmail) {
      ;(storeData as any).ownerEmail = resolvedEmail
    }

    const ownerName = getOptionalString((memberData as any).name ?? undefined)
    if (ownerName) {
      ;(storeData as any).ownerName = ownerName
    }

    const companyName = getOptionalString((memberData as any).companyName ?? undefined)
    if (companyName) {
      ;(storeData as any).displayName = companyName
      ;(storeData as any).businessName = companyName
    }

    if (!storeSnap.exists) {
      ;(storeData as any).createdAt = timestamp
    }

    await storeRef.set(storeData, { merge: true })
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
  const resolvedCountry = contact.hasCountry ? contact.country ?? null : null
  const resolvedTown = contact.hasTown ? contact.town ?? null : null
  const resolvedSignupRole = contact.hasSignupRole ? contact.signupRole ?? null : null

  const memberRef = db.collection('teamMembers').doc(uid)
  const defaultMemberRef = defaultDb.collection('teamMembers').doc(uid)
  const [memberSnap, defaultMemberSnap] = await Promise.all([
    memberRef.get(),
    defaultMemberRef.get(),
  ])
  const timestamp = admin.firestore.FieldValue.serverTimestamp()

  // NEW: compute the trial end once per new workspace
  const { trialDays } = getBillingConfig()
  const trialEndsAt = admin.firestore.Timestamp.fromMillis(
    Date.now() + trialDays * 24 * 60 * 60 * 1000,
  )

  const existingData = memberSnap.data() ?? {}
  const existingStoreId =
    typeof (existingData as any).storeId === 'string' && (existingData as any).storeId.trim() !== ''
      ? ((existingData as any).storeId as string)
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
    ;(memberData as any).name = resolvedOwnerName
  }

  if (resolvedBusinessName !== null) {
    ;(memberData as any).companyName = resolvedBusinessName
  }

  if (resolvedCountry !== null) {
    ;(memberData as any).country = resolvedCountry
  }

  if (resolvedTown !== null) {
    ;(memberData as any).town = resolvedTown
  }

  if (resolvedSignupRole !== null) {
    ;(memberData as any).signupRole = resolvedSignupRole
  }

  if (!memberSnap.exists) {
    ;(memberData as any).createdAt = timestamp
  }

  await Promise.all([
    memberRef.set(memberData, { merge: true }),
    (async () => {
      const defaultMemberData: admin.firestore.DocumentData = {
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
        ;(defaultMemberData as any).name = resolvedOwnerName
      }

      if (resolvedBusinessName !== null) {
        ;(defaultMemberData as any).companyName = resolvedBusinessName
      }

      if (resolvedCountry !== null) {
        ;(defaultMemberData as any).country = resolvedCountry
      }

      if (resolvedTown !== null) {
        ;(defaultMemberData as any).town = resolvedTown
      }

      if (resolvedSignupRole !== null) {
        ;(defaultMemberData as any).signupRole = resolvedSignupRole
      }

      if (!defaultMemberSnap.exists) {
        ;(defaultMemberData as any).createdAt = timestamp
      }

      await defaultMemberRef.set(defaultMemberData, { merge: true })
    })(),
  ])

  if (normalizedEmail) {
    const emailRef = db.collection('teamMembers').doc(normalizedEmail)
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
      ;(emailData as any).name = resolvedOwnerName
    }

    if (resolvedBusinessName !== null) {
      ;(emailData as any).companyName = resolvedBusinessName
    }

    if (resolvedCountry !== null) {
      ;(emailData as any).country = resolvedCountry
    }

    if (resolvedTown !== null) {
      ;(emailData as any).town = resolvedTown
    }

    if (resolvedSignupRole !== null) {
      ;(emailData as any).signupRole = resolvedSignupRole
    }
    if (!emailSnap.exists) {
      ;(emailData as any).createdAt = timestamp
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
    // NEW: billing defaults for new workspace
    billing: {
      planId: ('starter' as PlanId),  // label only; Paystack plan code is stored in config/env
      status: 'trial',                // 'trial' | 'active' | 'past_due' | 'canceled'
      trialEndsAt,                    // Firestore Timestamp
      provider: 'paystack',
    },
  }
  if (email) {
    ;(storeData as any).ownerEmail = email
  }
  if (resolvedOwnerName) {
    ;(storeData as any).ownerName = resolvedOwnerName
  }
  if (resolvedBusinessName) {
    ;(storeData as any).displayName = resolvedBusinessName
    ;(storeData as any).businessName = resolvedBusinessName
  }
  if (resolvedCountry) {
    ;(storeData as any).country = resolvedCountry
  }
  if (resolvedTown) {
    ;(storeData as any).town = resolvedTown
  }
  if (!storeSnap.exists) {
    ;(storeData as any).createdAt = timestamp
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

  const teamMembersCollection = db.collection('teamMembers')
  const memberRef = teamMembersCollection.doc(uid)
  const rosterEmailRef = emailFromToken ? teamMembersCollection.doc(emailFromToken) : null
  const [memberSnap, rosterEmailSnap] = await Promise.all([
    memberRef.get(),
    rosterEmailRef ? rosterEmailRef.get() : Promise.resolve(null),
  ])
  const existingMember = (memberSnap.data() ?? {}) as admin.firestore.DocumentData
  const emailMember = (rosterEmailSnap?.data() ?? {}) as admin.firestore.DocumentData

  if (!memberSnap.exists && (!rosterEmailSnap || !rosterEmailSnap.exists)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'We could not find a workspace assignment for this account. Reach out to your Sedifex administrator.',
    )
  }

  const rosterStoreIdFromMember =
    getOptionalString((existingMember as any).storeId ?? (existingMember as any).storeID ?? (existingMember as any).store_id ?? undefined) ?? null
  const rosterStoreIdFromEmail =
    getOptionalString((emailMember as any).storeId ?? (emailMember as any).storeID ?? (emailMember as any).store_id ?? undefined) ?? null

  let rosterStoreId = rosterStoreIdFromMember ?? rosterStoreIdFromEmail ?? null

  const rosterEntry: admin.firestore.DocumentData = { ...emailMember }
  for (const [key, value] of Object.entries(existingMember)) {
    if (value !== undefined) {
      ;(rosterEntry as any)[key] = value
    }
  }
  if (rosterStoreId) {
    ;(rosterEntry as any).storeId = rosterStoreId
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
  const storeStatus = getOptionalString((storeData as any).status ?? (storeData as any).contractStatus ?? undefined)
  if (isInactiveContractStatus(storeStatus)) {
    throw new functions.https.HttpsError('permission-denied', INACTIVE_WORKSPACE_MESSAGE)
  }

  const now = admin.firestore.Timestamp.now()

  const memberCreatedAt =
    memberSnap.exists && (existingMember as any).createdAt instanceof admin.firestore.Timestamp
      ? ((existingMember as any).createdAt as admin.firestore.Timestamp)
      : now

  const rosterRoleRaw = getOptionalString((rosterEntry as any).role ?? (rosterEntry as any).memberRole ?? undefined)
  let resolvedRole = 'staff'
  if (rosterRoleRaw) {
    const normalizedRole = rosterRoleRaw.toLowerCase()
    if (VALID_ROLES.has(normalizedRole)) {
      resolvedRole = normalizedRole
    } else if (normalizedRole.includes('owner')) {
      resolvedRole = 'owner'
    }
  } else if (typeof (existingMember as any).role === 'string' && VALID_ROLES.has((existingMember as any).role)) {
    resolvedRole = (existingMember as any).role
  }

  const rosterPhone =
    getOptionalString((rosterEntry as any).phone ?? (rosterEntry as any).contactPhone ?? (rosterEntry as any).phoneNumber ?? undefined) ??
    (typeof (existingMember as any).phone === 'string' ? (existingMember as any).phone : null)
  const rosterName =
    getOptionalString((rosterEntry as any).name ?? (rosterEntry as any).displayName ?? (rosterEntry as any).memberName ?? undefined) ??
    (typeof (existingMember as any).name === 'string' ? (existingMember as any).name : null)
  const rosterEmailAddress =
    getOptionalEmail(
      (rosterEntry as any).email ??
        (rosterEntry as any).memberEmail ??
        (rosterEntry as any).primaryEmail ??
        (rosterEntry as any).signupEmail ??
        (existingMember as any).email ??
        emailFromToken ??
        undefined,
    ) ?? null
  const rosterFirstSignupEmail =
    getOptionalEmail(
      (rosterEntry as any).firstSignupEmail ??
        (rosterEntry as any).signupEmail ??
        (rosterEntry as any).primaryEmail ??
        (rosterEntry as any).memberEmail ??
        undefined,
    ) ??
    (typeof (existingMember as any).firstSignupEmail === 'string'
      ? (existingMember as any).firstSignupEmail
      : rosterEmailAddress)
  const rosterInvitedBy =
    getOptionalString((rosterEntry as any).invitedBy ?? (rosterEntry as any).inviterUid ?? (rosterEntry as any).invited_by ?? undefined) ??
    (typeof (existingMember as any).invitedBy === 'string' ? (existingMember as any).invitedBy : null)

  const memberData: admin.firestore.DocumentData = {
    uid,
    storeId,
    role: resolvedRole,
    email: rosterEmailAddress,
    updatedAt: now,
    createdAt: memberCreatedAt,
  }
  if (rosterPhone) (memberData as any).phone = rosterPhone
  if (rosterName) (memberData as any).name = rosterName
  if (rosterFirstSignupEmail) (memberData as any).firstSignupEmail = rosterFirstSignupEmail
  if (rosterInvitedBy) (memberData as any).invitedBy = rosterInvitedBy

  await memberRef.set(memberData, { merge: true })
  if (rosterEmailRef) {
    await rosterEmailRef.set({ uid, lastResolvedAt: now }, { merge: true })
  }

  const productSeedRecords = toSeedRecords((storeData as any).seedProducts ?? (rosterEntry as any).seedProducts ?? null)
  const customerSeedRecords = toSeedRecords((storeData as any).seedCustomers ?? (rosterEntry as any).seedCustomers ?? null)

  const productSeeds = mapProductSeeds(productSeedRecords, storeId)
  const customerSeeds = mapCustomerSeeds(customerSeedRecords, storeId)

  const productResults = await Promise.all(
    productSeeds.map(async seed => {
      const ref = defaultDb.collection('products').doc(seed.id)
      const snapshot = await ref.get()
      const existingProduct = (snapshot.data() ?? {}) as admin.firestore.DocumentData
      const productCreatedAt =
        snapshot.exists && (existingProduct as any).createdAt instanceof admin.firestore.Timestamp
          ? ((existingProduct as any).createdAt as admin.firestore.Timestamp)
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
        snapshot.exists && (existingCustomer as any).createdAt instanceof admin.firestore.Timestamp
          ? ((existingCustomer as any).createdAt as admin.firestore.Timestamp)
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

  const memberRef = db.collection('teamMembers').doc(record.uid)
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
    ;(memberData as any).createdAt = timestamp
  }

  await memberRef.set(memberData, { merge: true })
  const emailRef = db.collection('teamMembers').doc(email)
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
    ;(emailData as any).createdAt = timestamp
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

const SHARE_METHODS = new Set(['web-share', 'email', 'sms', 'whatsapp', 'download'])
const SHARE_STATUSES = new Set(['started', 'success', 'cancelled', 'error'])

type PrepareReceiptSharePayload = {
  saleId?: unknown
  storeId?: unknown
  lines?: unknown
  pdfFileName?: unknown
}

type PrepareReceiptShareResponse = {
  ok: true
  saleId: string
  pdfUrl: string
  pdfFileName: string
  shareUrl: string
  shareId: string
}

export const prepareReceiptShare = functions.https.onCall(
  async (rawData: PrepareReceiptSharePayload, context): Promise<PrepareReceiptShareResponse> => {
    assertStaffAccess(context)

    const saleIdRaw = rawData?.saleId
    const saleId = typeof saleIdRaw === 'string' ? saleIdRaw.trim() : ''
    if (!saleId) {
      throw new functions.https.HttpsError('invalid-argument', 'A valid saleId is required')
    }

    const storeIdRaw = rawData?.storeId
    const storeId = typeof storeIdRaw === 'string' && storeIdRaw.trim() ? storeIdRaw.trim() : null

    const linesRaw = Array.isArray(rawData?.lines) ? rawData?.lines ?? [] : []
    const lines = linesRaw
      .map(line => (typeof line === 'string' ? line : ''))
      .map(line => line.trimEnd())
      .filter((line, index) => line.length > 0 || index === 0)
    if (lines.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Receipt lines are required')
    }

    const pdfFileNameRaw = rawData?.pdfFileName
    const pdfFileName =
      typeof pdfFileNameRaw === 'string' && pdfFileNameRaw.trim()
        ? pdfFileNameRaw.trim()
        : `receipt-${saleId}.pdf`

    const bucket = admin.storage().bucket()
    const safeStoreSegment = storeId ? storeId.replace(/[^A-Za-z0-9_-]/g, '_') : 'unassigned'
    const pdfPath = `receipt-shares/${safeStoreSegment}/${saleId}.pdf`
    const file = bucket.file(pdfPath)

    const [exists] = await file.exists()
    if (!exists) {
      const pdfBody = buildSimplePdf('Sedifex POS', lines.slice(1))
      await file.save(Buffer.from(pdfBody), {
        resumable: false,
        contentType: 'application/pdf',
        metadata: {
          cacheControl: 'public, max-age=31536000',
          contentDisposition: `attachment; filename="${pdfFileName}"`,
        },
      })
    }

    const expiresAtMillis = Date.now() + 1000 * 60 * 60 * 24 * 30
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: new Date(expiresAtMillis),
    })

    const shareId = db.collection('_').doc().id
    await db.collection('receiptShareSessions').doc(shareId).set({
      saleId,
      storeId,
      pdfPath,
      pdfFileName,
      preparedAt: admin.firestore.FieldValue.serverTimestamp(),
      preparedBy: context.auth?.uid ?? null,
      signedUrl,
      expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMillis),
    })

    return {
      ok: true,
      saleId,
      pdfUrl: signedUrl,
      pdfFileName,
      shareUrl: signedUrl,
      shareId,
    }
  },
)

type LogReceiptShareAttemptPayload = {
  saleId?: unknown
  storeId?: unknown
  shareId?: unknown
  method?: unknown
  status?: unknown
  errorMessage?: unknown
}

type LogReceiptShareAttemptResponse = {
  ok: true
  attemptId: string
}

export const logReceiptShareAttempt = functions.https.onCall(
  async (
    rawData: LogReceiptShareAttemptPayload,
    context,
  ): Promise<LogReceiptShareAttemptResponse> => {
    assertStaffAccess(context)

    const saleIdRaw = rawData?.saleId
    const saleId = typeof saleIdRaw === 'string' ? saleIdRaw.trim() : ''
    if (!saleId) {
      throw new functions.https.HttpsError('invalid-argument', 'A valid saleId is required')
    }

    const methodRaw = rawData?.method
    const method = typeof methodRaw === 'string' ? methodRaw.trim() : ''
    if (!SHARE_METHODS.has(method)) {
      throw new functions.https.HttpsError('invalid-argument', 'Unsupported share method')
    }

    const statusRaw = rawData?.status
    const status = typeof statusRaw === 'string' ? statusRaw.trim() : ''
    if (!SHARE_STATUSES.has(status)) {
      throw new functions.https.HttpsError('invalid-argument', 'Unsupported share status')
    }

    const storeIdRaw = rawData?.storeId
    const storeId = typeof storeIdRaw === 'string' && storeIdRaw.trim() ? storeIdRaw.trim() : null

    const shareIdRaw = rawData?.shareId
    const shareId = typeof shareIdRaw === 'string' && shareIdRaw.trim() ? shareIdRaw.trim() : null

    const errorMessageRaw = rawData?.errorMessage
    const errorMessage =
      typeof errorMessageRaw === 'string' && errorMessageRaw.trim()
        ? errorMessageRaw.trim().slice(0, 500)
        : null

    const attemptId = db.collection('_').doc().id
    await db.collection('receiptShareAttempts').doc(attemptId).set({
      saleId,
      storeId,
      shareId,
      method,
      status,
      errorMessage,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: context.auth?.uid ?? null,
    })

    if (shareId) {
      await db
        .collection('receiptShareSessions')
        .doc(shareId)
        .set(
          {
            lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
            lastAttemptStatus: status,
          },
          { merge: true },
        )
    }

    return { ok: true, attemptId }
  },
)
