// functions/src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Core imports first
import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'
import { buildSimplePdf } from './utils/pdf'

// Billing config (plans & trial)
import {
  DEFAULT_PLAN_ID,
  getBillingConfig,
  normalizePlanId,
  type PlanId,
} from './plans'

// Re-export triggers so Firebase can discover them
export { confirmPayment } from './confirmPayment'
export { createCheckout, paystackWebhook, checkSignupUnlock } from './paystack'


// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers and types
// ─────────────────────────────────────────────────────────────────────────────

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
  country?: unknown
  town?: unknown
  signupRole?: unknown
}

type InitializeStorePayload = {
  contact?: ContactPayload
  planId?: unknown
  storeId?: unknown
}

type ManageStaffPayload = {
  storeId?: unknown
  email?: unknown
  role?: unknown
  password?: unknown
}

const VALID_ROLES = new Set(['owner', 'staff'])

function toTimestamp(value: unknown): admin.firestore.Timestamp | null {
  if (!value) return null
  if (typeof value === 'object' && value !== null) {
    if (typeof (value as { toMillis?: unknown }).toMillis === 'function') {
      return value as admin.firestore.Timestamp
    }
    const millis = (value as { _millis?: unknown })._millis
    if (typeof millis === 'number') {
      return admin.firestore.Timestamp.fromMillis(millis)
    }
  }
  return null
}

function isTimestamp(value: unknown): value is admin.firestore.Timestamp {
  return toTimestamp(value) !== null
}

function normalizeWorkspaceSlug(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) {
      return trimmed
    }
  }
  return fallback
}

function normalizeStoreId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

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
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Phone must be a string when provided',
        )
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
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Owner name must be a string when provided',
        )
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
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Business name must be a string when provided',
        )
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
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Country must be a string when provided',
        )
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
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Town must be a string when provided',
        )
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
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Signup role must be a string when provided',
        )
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

async function updateUserClaims(
  uid: string,
  role: string,
  storeId?: string,
  workspaceSlug?: string,
) {
  const userRecord = await admin
    .auth()
    .getUser(uid)
    .catch(() => null)
  const existingClaims = (userRecord?.customClaims ?? {}) as Record<string, unknown>
  const nextClaims: Record<string, unknown> = { ...existingClaims }
  nextClaims.role = role
  if (storeId) {
    nextClaims.storeId = storeId
  }
  if (workspaceSlug) {
    nextClaims.workspaceSlug = workspaceSlug
  }
  delete nextClaims.stores
  delete nextClaims.activeStoreId
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
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Password must be a string when provided',
    )
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
      const record = await admin
        .auth()
        .createUser({ email, password, emailVerified: false })
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
    return value.filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
    )
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
    )
  }
  return []
}

function mapProductSeeds(
  records: Record<string, unknown>[],
  storeId: string,
): SeededDocument[] {
  return records
    .map((product, index) => {
      const name =
        getOptionalString(
          (product as any).name ??
            (product as any).productName ??
            (product as any).displayName ??
            (product as any).title ??
            undefined,
        ) ?? null
      const sku = getOptionalString(
        (product as any).sku ??
          (product as any).code ??
          (product as any).productSku ??
          undefined,
      )
      const idCandidate =
        getOptionalString(
          (product as any).id ??
            (product as any).productId ??
            (product as any).identifier ??
            (product as any).externalId ??
            sku ??
            name ??
            undefined,
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

function mapCustomerSeeds(
  records: Record<string, unknown>[],
  storeId: string,
): SeededDocument[] {
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
          (customer as any).name ??
            (customer as any).customerName ??
            (customer as any).customer_name ??
            (customer as any).displayName ??
            undefined,
        ) ?? primaryName
      const email = getOptionalEmail(
        (customer as any).email ??
          (customer as any).contactEmail ??
          (customer as any).contact_email ??
          undefined,
      )
      const phone = getOptionalString(
        (customer as any).phone ??
          (customer as any).phoneNumber ??
          (customer as any).phone_number ??
          (customer as any).contactPhone ??
          undefined,
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

      const labelFallback =
        fallbackName ?? primaryName ?? email ?? phone ?? `customer_${index + 1}`

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

function parseNonNegativeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return null
}

function resolveReorderLevel(rawLevel: unknown, legacyThreshold?: unknown): number | null {
  return parseNonNegativeNumber(rawLevel) ?? parseNonNegativeNumber(legacyThreshold)
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth trigger: on user creation (seeds teamMembers + default store)
// ─────────────────────────────────────────────────────────────────────────────

export const onAuthCreate = functions.auth.user().onCreate(async user => {
  const uid = user.uid
  const email = typeof user.email === 'string' ? user.email.toLowerCase() : null

  // ✅ Use default DB for teamMembers by uid and email
  const memberRef = defaultDb.collection('teamMembers').doc(uid)
  const emailRef = email ? defaultDb.collection('teamMembers').doc(email) : null
  const [memberSnap, emailSnap] = await Promise.all([
    memberRef.get(),
    emailRef ? emailRef.get() : Promise.resolve(null),
  ])
  const existingData = (memberSnap.data() ?? {}) as admin.firestore.DocumentData
  const existingEmailData = (emailSnap?.data() ?? {}) as admin.firestore.DocumentData
  const timestamp = admin.firestore.FieldValue.serverTimestamp()

  const resolvedEmail = user.email ?? existingData.email ?? existingEmailData.email ?? null
  const resolvedPhone =
    user.phoneNumber ?? existingData.phone ?? existingEmailData.phone ?? null
  const resolvedStoreId =
    getOptionalString(
      (existingData as any).storeId ??
        (existingData as any).storeID ??
        (existingData as any).store_id ??
        undefined,
    ) ??
    getOptionalString(
      (existingEmailData as any).storeId ??
        (existingEmailData as any).storeID ??
        (existingEmailData as any).store_id ??
        undefined,
    ) ??
    null
  const resolvedRoleRaw =
    getOptionalString(
      (existingData as any).role ??
        (existingEmailData as any).role ??
        (existingEmailData as any).memberRole ??
        undefined,
    ) ?? null
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
    getOptionalString(
      (existingData as any).invitedBy ??
        (existingEmailData as any).invitedBy ??
        undefined,
    ) ?? null
  const resolvedName =
    getOptionalString(
      (existingData as any).name ??
        (existingEmailData as any).name ??
        (existingEmailData as any).displayName ??
        undefined,
    ) ?? null
  const resolvedCompanyName =
    getOptionalString(
      (existingData as any).companyName ??
        (existingEmailData as any).companyName ??
        (existingEmailData as any).businessName ??
        (existingEmailData as any).workspaceName ??
        undefined,
    ) ?? null
  const resolvedStatus =
    getOptionalString(
      (existingData as any).status ??
        (existingEmailData as any).status ??
        undefined,
    ) ?? null
  const resolvedContractStatus =
    getOptionalString(
      (existingData as any).contractStatus ??
        (existingEmailData as any).contractStatus ??
        (existingEmailData as any).contract_status ??
        undefined,
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
    ;(memberData as any).storeId = resolvedStoreId
  } else {
    const currentStoreId = getOptionalString((memberData as any).storeId ?? undefined)
    if (!currentStoreId) {
      ;(memberData as any).storeId = storeId
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

  if (resolvedFirstSignupEmail !== null) {
    (memberData as any).firstSignupEmail = resolvedFirstSignupEmail
  }
  if (resolvedInvitedBy) (memberData as any).invitedBy = resolvedInvitedBy
  if (resolvedName) (memberData as any).name = resolvedName
  if (resolvedCompanyName) (memberData as any).companyName = resolvedCompanyName
  if (resolvedStatus) (memberData as any).status = resolvedStatus
  if (resolvedContractStatus)
    (memberData as any).contractStatus = resolvedContractStatus


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
    const trialEndsAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + trialDays * 24 * 60 * 60 * 1000,
    )

    const storeData: admin.firestore.DocumentData = {
      ownerId: uid,
      status: 'Active',
      contractStatus: 'Active',
      billing: {
        planId: DEFAULT_PLAN_ID as PlanId,
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

// ─────────────────────────────────────────────────────────────────────────────
// initializeStore callable
// ─────────────────────────────────────────────────────────────────────────────

async function initializeStoreImpl(
  data: unknown,
  context: functions.https.CallableContext,
) {
  assertAuthenticated(context)

  const uid = context.auth!.uid
  const token = context.auth!.token as Record<string, unknown>
  const email = typeof token.email === 'string' ? (token.email as string) : null
  const normalizedEmail = email ? email.toLowerCase() : null
  const tokenPhone =
    typeof token.phone_number === 'string' ? (token.phone_number as string) : null

  const payload = (data ?? {}) as InitializeStorePayload
  const contact = normalizeContactPayload(payload.contact)
  const resolvedPhone = contact.hasPhone ? contact.phone ?? null : tokenPhone ?? null
  const resolvedFirstSignupEmail = contact.hasFirstSignupEmail
    ? contact.firstSignupEmail ?? null
    : email?.toLowerCase() ?? null
  const resolvedOwnerName = contact.hasOwnerName ? contact.ownerName ?? null : null
  const resolvedBusinessName = contact.hasBusinessName
    ? contact.businessName ?? null
    : null
  const resolvedCountry = contact.hasCountry ? contact.country ?? null : null
  const resolvedTown = contact.hasTown ? contact.town ?? null : null
  const resolvedSignupRole = contact.hasSignupRole ? contact.signupRole ?? null : null

  const normalizedStoreId = normalizeStoreId(payload.storeId ?? null)
  const resolvedRole = resolvedSignupRole === 'team-member' ? 'staff' : 'owner'

  // ✅ Use default DB for teamMembers
  const memberRef = defaultDb.collection('teamMembers').doc(uid)
  const defaultMemberRef = memberRef
  const [memberSnap, defaultMemberSnap] = await Promise.all([
    memberRef.get(),
    defaultMemberRef.get(),
  ])
  const timestamp = admin.firestore.FieldValue.serverTimestamp()

  const { trialDays } = getBillingConfig()
  const requestedPlanId = normalizePlanId(payload.planId)
  if (payload.planId !== undefined && requestedPlanId === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Choose a valid Sedifex plan.',
    )
  }

  const existingData = memberSnap.data() ?? {}
  const existingStoreId =
    typeof (existingData as any).storeId === 'string' &&
    (existingData as any).storeId.trim() !== ''
      ? ((existingData as any).storeId as string)
      : null
  const storeIdCandidate = existingStoreId ?? normalizedStoreId
  if (resolvedRole === 'staff' && !storeIdCandidate) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Enter the store ID provided by your workspace owner to continue.',
    )
  }
  const storeId = storeIdCandidate ?? uid

  const storeRef = defaultDb.collection('stores').doc(storeId)
  const storeSnap = await storeRef.get()
  const existingStoreData = (storeSnap.data() ?? {}) as admin.firestore.DocumentData
  const workspaceSlug = normalizeWorkspaceSlug(
    (existingStoreData as any).workspaceSlug ??
      (existingStoreData as any).slug ??
      (existingStoreData as any).storeSlug ??
      null,
    storeId,
  )

  const existingBillingRaw =
    typeof (existingStoreData as any).billing === 'object' &&
    (existingStoreData as any).billing !== null
      ? ({ ...(existingStoreData as any).billing } as Record<string, unknown>)
      : {}
  const existingPlanId = normalizePlanId(
    (existingBillingRaw as Record<string, unknown>).planId ??
      (existingStoreData as any).planId ??
      null,
  )
  const resolvedPlanId = requestedPlanId ?? existingPlanId ?? DEFAULT_PLAN_ID

  const trialDurationMs = Math.max(trialDays, 0) * 24 * 60 * 60 * 1000
  const nowTimestampValue = admin.firestore.Timestamp.now()
  const existingContractStart = toTimestamp((existingStoreData as any).contractStart)
  const hasContractStart = Boolean(existingContractStart)
  const contractStartTimestamp = existingContractStart ?? nowTimestampValue
  const existingContractEnd = toTimestamp((existingStoreData as any).contractEnd)
  const hasContractEnd = Boolean(existingContractEnd)
  const contractEndTimestamp = hasContractEnd
    ? (existingContractEnd as admin.firestore.Timestamp)
    : admin.firestore.Timestamp.fromMillis(
        contractStartTimestamp.toMillis() + trialDurationMs,
      )

  const memberData: admin.firestore.DocumentData = {
    uid,
    email,
    role: resolvedRole,
    storeId,
    phone: resolvedPhone,
    firstSignupEmail: resolvedFirstSignupEmail,
    invitedBy: uid,
    updatedAt: timestamp,
    workspaceSlug,
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
        role: resolvedRole,
        storeId,
        phone: resolvedPhone,
        firstSignupEmail: resolvedFirstSignupEmail,
        invitedBy: uid,
        updatedAt: timestamp,
        workspaceSlug,
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
    const emailRef = defaultDb.collection('teamMembers').doc(normalizedEmail)
    const emailSnap = await emailRef.get()
    const emailData: admin.firestore.DocumentData = {
      uid,
      email,
      storeId,
      role: resolvedRole,
      phone: resolvedPhone,
      firstSignupEmail: resolvedFirstSignupEmail,
      invitedBy: uid,
      updatedAt: timestamp,
      workspaceSlug,
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

  if (resolvedRole === 'staff') {
    const claims = await updateUserClaims(uid, resolvedRole, storeId, workspaceSlug)
    return { ok: true, claims, storeId, role: resolvedRole }
  }

  const storeData: admin.firestore.DocumentData = {
    ownerId: uid,
    updatedAt: timestamp,
    workspaceSlug,
  }

  const existingStatus = getOptionalString(
    (existingStoreData as any).status ?? undefined,
  )
  if (!existingStatus) {
    ;(storeData as any).status = 'Active'
  }
  const existingContractStatus = getOptionalString(
    (existingStoreData as any).contractStatus ?? undefined,
  )
  if (!existingContractStatus) {
    ;(storeData as any).contractStatus = 'Active'
  }
  if (!hasContractStart) {
    ;(storeData as any).contractStart = contractStartTimestamp
  }
  if (!hasContractEnd) {
    ;(storeData as any).contractEnd = contractEndTimestamp
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
  if (resolvedPhone) {
    ;(storeData as any).ownerPhone = resolvedPhone
  }

  const existingBillingRawStore =
    typeof (existingStoreData as any).billing === 'object' &&
    (existingStoreData as any).billing !== null
      ? ({ ...(existingStoreData as any).billing } as Record<string, unknown>)
      : existingBillingRaw
  const existingTrialEndsAt = toTimestamp((existingBillingRawStore as any).trialEndsAt)
  const nextBilling: Record<string, unknown> = { ...existingBillingRawStore }
  nextBilling.planId = resolvedPlanId
  if (!getOptionalString((nextBilling as any).provider ?? undefined)) {
    ;(nextBilling as any).provider = 'paystack'
  }
  if (!getOptionalString((nextBilling as any).status ?? undefined)) {
    ;(nextBilling as any).status = 'trial'
  }
  ;(nextBilling as any).trialEndsAt = existingTrialEndsAt ?? contractEndTimestamp
  ;(storeData as any).billing = nextBilling

  const existingInventory = (existingStoreData as any).inventorySummary
  if (!storeSnap.exists) {
    ;(storeData as any).createdAt = timestamp
    if (!existingInventory) {
      ;(storeData as any).inventorySummary = {
        trackedSkus: 0,
        lowStockSkus: 0,
        incomingShipments: 0,
      }
    }
  } else if (!existingInventory) {
    ;(storeData as any).inventorySummary = {
      trackedSkus: 0,
      lowStockSkus: 0,
      incomingShipments: 0,
    }
  }

  await storeRef.set(storeData, { merge: true })
  const claims = await updateUserClaims(uid, resolvedRole, storeId, workspaceSlug)

  return { ok: true, claims, storeId, role: resolvedRole }
}

export const initializeStore = functions.https.onCall(async (data, context) => {
  try {
    return await initializeStoreImpl(data, context)
  } catch (error) {
    logCallableError('initializeStore', error, context, data)
    throw error
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Workspace lookup + access resolution
// ─────────────────────────────────────────────────────────────────────────────

async function lookupWorkspaceBySelector(selector: string): Promise<{
  slug: string
  storeId: string | null
  data: admin.firestore.DocumentData
} | null> {
  const normalized = selector.trim()
  if (!normalized) {
    return null
  }

  const workspacesCollection = defaultDb.collection('workspaces')
  const directRef = workspacesCollection.doc(normalized)
  const directSnap = await directRef.get()
  if (directSnap.exists) {
    const data = (directSnap.data() ?? {}) as admin.firestore.DocumentData
    const storeId = getOptionalString((data as any).storeId ?? undefined)
    return { slug: directRef.id, storeId, data }
  }

  const fallbackFields = ['storeId', 'slug', 'workspaceSlug', 'storeSlug']

  for (const field of fallbackFields) {
    const fallbackQuery = await workspacesCollection
      .where(field, '==', normalized)
      .limit(1)
      .get()
    const fallbackDoc = fallbackQuery.docs[0]
    if (!fallbackDoc) {
      continue
    }

    const fallbackData = (fallbackDoc.data() ?? {}) as admin.firestore.DocumentData
    const fallbackStoreId = getOptionalString(
      (fallbackData as any).storeId ?? undefined,
    )
    return { slug: fallbackDoc.id, storeId: fallbackStoreId, data: fallbackData }
  }

  return null
}

export const resolveStoreAccess = functions.https.onCall(
  async (data: unknown, context: functions.https.CallableContext) => {
    assertAuthenticated(context)

    const uid = context.auth!.uid
    const token = context.auth!.token as Record<string, unknown>
    const emailFromToken =
      typeof token.email === 'string' ? (token.email as string).toLowerCase() : null

    // storeId that comes from the app (or fall back to profile/uid)
    const requestedStoreId = normalizeStoreId((data as any)?.storeId ?? null)
    const memberRef = defaultDb.collection('teamMembers').doc(uid)
    const emailRef = emailFromToken
      ? defaultDb.collection('teamMembers').doc(emailFromToken)
      : null
    const [memberSnap, emailSnap] = await Promise.all([
      memberRef.get(),
      emailRef?.get() ?? Promise.resolve(null),
    ])

    const baseMemberData = {
      ...(emailSnap?.data() ?? {}),
      ...(memberSnap.data() ?? {}),
    } as admin.firestore.DocumentData

    const profileStoreId = normalizeStoreId((baseMemberData as any).storeId ?? null)
    const resolvedStoreId = requestedStoreId ?? profileStoreId ?? uid
    if (!resolvedStoreId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'A valid store ID is required to access this account.',
      )
    }

    const resolvedRole =
      getOptionalString((baseMemberData as any).role ?? undefined) === 'staff'
        ? 'staff'
        : 'owner'

    const now = admin.firestore.FieldValue.serverTimestamp()
    const workspaceSlug = normalizeWorkspaceSlug(
      (baseMemberData as any).workspaceSlug ?? null,
      resolvedStoreId,
    )

    const memberPayload: admin.firestore.DocumentData = {
      ...baseMemberData,
      uid,
      storeId: resolvedStoreId,
      role: resolvedRole,
      email: emailFromToken ?? (baseMemberData as any).email ?? null,
      workspaceSlug,
      updatedAt: now,
    }

    if (!memberSnap.exists) {
      ;(memberPayload as any).createdAt = now
    }

    await memberRef.set(memberPayload, { merge: true })
    if (emailRef) {
      const emailPayload: admin.firestore.DocumentData = {
        ...memberPayload,
        uid,
        email: emailFromToken,
        updatedAt: now,
      }
      if (emailSnap && !emailSnap.exists) {
        ;(emailPayload as any).createdAt = now
      }
      await emailRef.set(emailPayload, { merge: true })
    }

    const storeRef = defaultDb.collection('stores').doc(resolvedStoreId)
    const storeSnap = await storeRef.get()
    const baseStoreData = (storeSnap.data() ?? {}) as admin.firestore.DocumentData
    const storeData: admin.firestore.DocumentData = {
      ...baseStoreData,
      storeId: resolvedStoreId,
      workspaceSlug,
      updatedAt: now,
    }

    if (!getOptionalString((storeData as any).status ?? undefined)) {
      ;(storeData as any).status = 'Active'
    }
    if (!getOptionalString((storeData as any).contractStatus ?? undefined)) {
      ;(storeData as any).contractStatus = 'Active'
    }

    if (resolvedRole === 'owner') {
      if (!getOptionalString((storeData as any).ownerId ?? undefined)) {
        ;(storeData as any).ownerId = uid
      }
      if (
        emailFromToken &&
        !getOptionalString((storeData as any).ownerEmail ?? undefined)
      ) {
        ;(storeData as any).ownerEmail = emailFromToken
      }
      if (!getOptionalString((storeData as any).status ?? undefined)) {
        ;(storeData as any).status = 'Active'
      }
      if (!getOptionalString((storeData as any).contractStatus ?? undefined)) {
        ;(storeData as any).contractStatus = 'Active'
      }
    }

    if (!storeSnap.exists) {
      ;(storeData as any).createdAt = now
      if (!(storeData as any).inventorySummary) {
        ;(storeData as any).inventorySummary = {
          trackedSkus: 0,
          lowStockSkus: 0,
          incomingShipments: 0,
        }
      }
    }

    await storeRef.set(storeData, { merge: true })

    const workspaceRef = defaultDb.collection('workspaces').doc(resolvedStoreId)
    const workspaceSnap = await workspaceRef.get()
    const workspacePayload: admin.firestore.DocumentData = {
      storeId: resolvedStoreId,
      slug: workspaceSlug,
      workspaceSlug,
      storeSlug: workspaceSlug,
      ownerId: (storeData as any).ownerId ?? null,
      updatedAt: now,
    }

    if (!workspaceSnap.exists) {
      ;(workspacePayload as any).createdAt = now
    }

    await workspaceRef.set(workspacePayload, { merge: true })

    const claims = await updateUserClaims(
      uid,
      resolvedRole,
      resolvedStoreId,
      workspaceSlug,
    )

    return {
      ok: true,
      storeId: resolvedStoreId,
      workspaceSlug,
      role: resolvedRole,
      claims,
    }
  },
)

// ─────────────────────────────────────────────────────────────────────────────
// Staff management
// ─────────────────────────────────────────────────────────────────────────────

export const manageStaffAccount = functions.https.onCall(async (data, context) => {
  assertOwnerAccess(context)

  const { storeId, email, role, password } = normalizeManageStaffPayload(
    data as ManageStaffPayload,
  )
  const invitedBy = context.auth?.uid ?? null
  const { record, created } = await ensureAuthUser(email, password)

  // ✅ Default DB for staff member docs
  const memberRef = defaultDb.collection('teamMembers').doc(record.uid)
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

  const emailRef = defaultDb.collection('teamMembers').doc(email)
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
  const claims = await updateUserClaims(record.uid, role, storeId, storeId)

  return { ok: true, role, email, uid: record.uid, created, storeId, claims }
})

// ─────────────────────────────────────────────────────────────────────────────
// Sales + stock receiving
// ─────────────────────────────────────────────────────────────────────────────

export const commitSale = functions.https.onCall(async (data, context) => {
  // For now, just require that the user is logged in.
  // We’re NOT enforcing role-based access until claims are sorted out.
  assertAuthenticated(context)

  const {
    branchId,
    workspaceId: workspaceIdRaw,
    items,
    totals,
    cashierId,
    saleId: saleIdRaw,
    payment,
    customer,
    note: saleNoteRaw,
  } = data || {}

  const normalizedBranchIdRaw = typeof branchId === 'string' ? branchId.trim() : ''
  if (!normalizedBranchIdRaw) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'A valid branch identifier is required',
    )
  }
  const normalizedBranchId = normalizedBranchIdRaw

  const workspaceIdCandidate =
    typeof workspaceIdRaw === 'string' ? workspaceIdRaw.trim() : ''
  const lookupSelector = workspaceIdCandidate || normalizedBranchId
  const workspaceLookup = lookupSelector
    ? await lookupWorkspaceBySelector(lookupSelector)
    : null
  const resolvedWorkspaceId =
    workspaceLookup?.slug ??
    (workspaceIdCandidate ? workspaceIdCandidate : normalizedBranchId)
  const resolvedStoreId = workspaceLookup?.storeId ?? normalizedBranchId

  // Determine saleId (use provided one or generate a new ID)
  const saleId =
    typeof saleIdRaw === 'string' && saleIdRaw.trim()
      ? saleIdRaw.trim()
      : db.collection('_').doc().id

  const workspaceRef = db.collection('workspaces').doc(resolvedWorkspaceId)
  // IMPORTANT: use global products collection so products are found correctly
  const productsCollection = db.collection('products')
  const saleRef = workspaceRef.collection('sales').doc(saleId)
  const saleItemsCollection = workspaceRef.collection('saleItems')
  const ledgerCollection = workspaceRef.collection('ledger')
  const alertsCollection = db.collection('alerts')

  await db.runTransaction(async tx => {
    const existingSale = await tx.get(saleRef)
    if (existingSale.exists) {
      throw new functions.https.HttpsError(
        'already-exists',
        'Sale has already been committed',
      )
    }

  const normalizedItems = Array.isArray(items)
    ? items.map((it: any) => {
        const productId = typeof it?.productId === 'string' ? it.productId : null
        const name = typeof it?.name === 'string' ? it.name : null
        const qty = Number(it?.qty ?? 0) || 0
        const price = Number(it?.price ?? 0) || 0
        const taxRate = Number(it?.taxRate ?? 0) || 0
        const discountAmount = Number.isFinite(it?.discountAmount)
          ? Number(it.discountAmount)
          : 0
        const discountPercent = Number.isFinite(it?.discountPercent)
          ? Number(it.discountPercent)
          : 0
        return { productId, name, qty, price, taxRate, discountAmount, discountPercent }
      })
    : []

  const saleDiscountPercentRaw = totals?.discountPercent
  const saleDiscountPercent = Number.isFinite(saleDiscountPercentRaw)
    ? Number(saleDiscountPercentRaw)
    : 0
  const saleDiscountAmountRaw = totals?.discountAmount
  const saleDiscountAmount = Number.isFinite(saleDiscountAmountRaw)
    ? Number(saleDiscountAmountRaw)
    : 0
  const saleNoteCandidate = typeof saleNoteRaw === 'string' ? saleNoteRaw.trim() : ''
  const saleNote = saleNoteCandidate || null

  const subtotal = normalizedItems.reduce((acc, item) => acc + item.price * item.qty, 0)
  const itemDiscountTotal = normalizedItems.reduce((acc, item) => {
    const lineSubtotal = item.price * item.qty
    const percentDiscount =
      item.discountPercent && Number.isFinite(item.discountPercent)
        ? Math.max(0, lineSubtotal * (item.discountPercent / 100))
        : 0
    const discount = Math.max(0, item.discountAmount || percentDiscount)
    return acc + Math.min(lineSubtotal, discount)
  }, 0)
  const subtotalAfterItemDiscount = Math.max(0, subtotal - itemDiscountTotal)
  const salePercentAmount =
    saleDiscountPercent > 0 ? subtotalAfterItemDiscount * (saleDiscountPercent / 100) : 0
  const normalizedSaleDiscountAmount = Math.max(
    0,
    saleDiscountAmount || salePercentAmount,
  )
  const saleDiscountApplied = Math.min(subtotalAfterItemDiscount, normalizedSaleDiscountAmount)
  const discountTotal = itemDiscountTotal + saleDiscountApplied
  const providedTotal = Number.isFinite(totals?.total) ? Number(totals.total) : null
  const netTotal = Math.max(0, subtotalAfterItemDiscount - saleDiscountApplied)
  const total = providedTotal !== null ? Math.max(0, providedTotal) : netTotal
  const taxTotal = Number(totals?.taxTotal ?? 0) || 0

    const timestamp = admin.firestore.FieldValue.serverTimestamp()

    tx.set(saleRef, {
      workspaceId: resolvedWorkspaceId,
      branchId: resolvedStoreId,
      storeId: resolvedStoreId,
      cashierId,
      total,
      subtotal,
      itemDiscountTotal,
      saleDiscountAmount: saleDiscountApplied,
      saleDiscountPercent,
      discountTotal,
      taxTotal,
      payment: payment ?? null,
      customer: customer ?? null,
      note: saleNote,
      items: normalizedItems,
      createdBy: context.auth?.uid ?? null,
      createdAt: timestamp,
    })

    for (const it of normalizedItems) {
      if (!it.productId) {
        throw new functions.https.HttpsError('failed-precondition', 'Bad product')
      }
      const itemId = db.collection('_').doc().id
      tx.set(saleItemsCollection.doc(itemId), {
        saleId,
        productId: it.productId,
        qty: it.qty,
        price: it.price,
        taxRate: it.taxRate,
        discountAmount: Math.min(Math.max(0, it.discountAmount || 0), it.price * it.qty),
        discountPercent: Number.isFinite(it.discountPercent) ? Number(it.discountPercent) : 0,
        storeId: resolvedStoreId,
        workspaceId: resolvedWorkspaceId,
        createdAt: timestamp,
      })

      const pRef = productsCollection.doc(it.productId)
      const pSnap = await tx.get(pRef)
      if (!pSnap.exists) {
        throw new functions.https.HttpsError('failed-precondition', 'Bad product')
      }
      const curr = Number(pSnap.get('stockCount') || 0)
      const next = curr - Math.abs(it.qty || 0)
      const reorderLevel = resolveReorderLevel(
        pSnap.get('reorderLevel'),
        pSnap.get('reorderThreshold'),
      )
      const productStoreIdRaw = pSnap.get('storeId')
      const productStoreId =
        typeof productStoreIdRaw === 'string' ? productStoreIdRaw.trim() : null
      tx.update(pRef, { stockCount: next, updatedAt: timestamp })

      const ledgerId = db.collection('_').doc().id
      tx.set(ledgerCollection.doc(ledgerId), {
        productId: it.productId,
        qtyChange: -Math.abs(it.qty || 0),
        type: 'sale',
        refId: saleId,
        storeId: resolvedStoreId,
        workspaceId: resolvedWorkspaceId,
        createdAt: timestamp,
      })

      if (reorderLevel !== null && next <= reorderLevel) {
        const alertRef = alertsCollection.doc()
        tx.set(alertRef, {
          type: 'low-stock',
          productId: it.productId,
          storeId: productStoreId || resolvedStoreId,
          createdAt: timestamp,
        })
      }
    }
  })

  return { ok: true, saleId }
})

export const receiveStock = functions.https.onCall(async (data, context) => {
  // Same here: only require that the user is authenticated.
  assertAuthenticated(context)

  const {
    productId,
    qty,
    supplier,
    reference,
    unitCost,
    workspaceId: workspaceIdRaw,
    storeId: storeIdRaw,
    branchId: branchIdRaw,
    note: receiptNoteRaw,
  } = data || {}

  const productIdStr = typeof productId === 'string' ? productId : null
  if (!productIdStr) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'A product must be selected',
    )
  }

  const amount = Number(qty)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Quantity must be greater than zero',
    )
  }

  const normalizedSupplier = typeof supplier === 'string' ? supplier.trim() : ''
  if (!normalizedSupplier) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Supplier is required',
    )
  }

  const normalizedReference = typeof reference === 'string' ? reference.trim() : ''
  if (!normalizedReference) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Reference number is required',
    )
  }

  let normalizedUnitCost: number | null = null
  if (unitCost !== undefined && unitCost !== null && unitCost !== '') {
    const parsedCost = Number(unitCost)
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Cost must be zero or greater when provided',
      )
    }
    normalizedUnitCost = parsedCost
  }

  const workspaceIdCandidate =
    typeof workspaceIdRaw === 'string' ? workspaceIdRaw.trim() : ''
  const storeIdCandidate = typeof storeIdRaw === 'string' ? storeIdRaw.trim() : ''
  const branchIdCandidate =
    typeof branchIdRaw === 'string' ? branchIdRaw.trim() : ''
  const selector = workspaceIdCandidate || storeIdCandidate || branchIdCandidate
  const workspaceLookup = selector
    ? await lookupWorkspaceBySelector(selector)
    : null
  const resolvedWorkspaceId =
    workspaceLookup?.slug ??
    (workspaceIdCandidate ? workspaceIdCandidate : selector)
  if (!resolvedWorkspaceId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'A valid workspace identifier is required',
    )
  }
  let resolvedStoreId = workspaceLookup?.storeId ?? storeIdCandidate
  if (!resolvedStoreId) {
    resolvedStoreId = branchIdCandidate || resolvedWorkspaceId
  }

  const workspaceRef = db.collection('workspaces').doc(resolvedWorkspaceId)
  // IMPORTANT: use global products collection to match commitSale
  const productRef = db.collection('products').doc(productIdStr)
  const receiptRef = workspaceRef.collection('receipts').doc()
  const ledgerRef = workspaceRef.collection('ledger').doc()
  const alertsCollection = db.collection('alerts')
  const receiptNote = typeof receiptNoteRaw === 'string' && receiptNoteRaw.trim()
    ? receiptNoteRaw.trim()
    : null

  await db.runTransaction(async tx => {
    const pSnap = await tx.get(productRef)
    if (!pSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Bad product')
    }

    const productStoreIdRaw = pSnap.get('storeId')
    const productStoreId =
      typeof productStoreIdRaw === 'string' ? productStoreIdRaw.trim() : null

    const currentStock = Number(pSnap.get('stockCount') || 0)
    const nextStock = currentStock + amount
    const timestamp = admin.firestore.FieldValue.serverTimestamp()
    const reorderLevel = resolveReorderLevel(
      pSnap.get('reorderLevel'),
      pSnap.get('reorderThreshold'),
    )

    tx.update(productRef, {
      stockCount: nextStock,
      updatedAt: timestamp,
      lastReceivedAt: timestamp,
      lastReceivedQty: amount,
      lastReceivedCost: normalizedUnitCost,
    })

    const totalCost =
      normalizedUnitCost === null
        ? null
        : Math.round((normalizedUnitCost * amount + Number.EPSILON) * 100) /
          100

    tx.set(receiptRef, {
      productId: productIdStr,
      qty: amount,
      supplier: normalizedSupplier,
      reference: normalizedReference,
      unitCost: normalizedUnitCost,
      totalCost,
      receivedBy: context.auth?.uid ?? null,
      note: receiptNote,
      createdAt: timestamp,
      storeId: productStoreId || resolvedStoreId,
      workspaceId: resolvedWorkspaceId,
    })

    tx.set(ledgerRef, {
      productId: productIdStr,
      qtyChange: amount,
      type: 'receipt',
      refId: receiptRef.id,
      storeId: productStoreId || resolvedStoreId,
      workspaceId: resolvedWorkspaceId,
      createdAt: timestamp,
    })

    if (reorderLevel !== null && nextStock <= reorderLevel) {
      const alertRef = alertsCollection.doc()
      tx.set(alertRef, {
        type: 'low-stock',
        productId: productIdStr,
        storeId: productStoreId || resolvedStoreId,
        createdAt: timestamp,
      })
    }
  })

  return { ok: true, receiptId: receiptRef.id }
})

// ─────────────────────────────────────────────────────────────────────────────
// Receipt share logging
// ─────────────────────────────────────────────────────────────────────────────

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
  async (
    rawData: PrepareReceiptSharePayload,
    context,
  ): Promise<PrepareReceiptShareResponse> => {
    assertStaffAccess(context)

    const saleIdRaw = rawData?.saleId
    const saleId = typeof saleIdRaw === 'string' ? saleIdRaw.trim() : ''
    if (!saleId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'A valid saleId is required',
      )
    }

    const storeIdRaw = rawData?.storeId
    const storeId =
      typeof storeIdRaw === 'string' && storeIdRaw.trim()
        ? storeIdRaw.trim()
        : null

    const linesRaw = Array.isArray(rawData?.lines) ? rawData?.lines ?? [] : []
    const lines = linesRaw
      .map(line => (typeof line === 'string' ? line : ''))
      .map(line => line.trimEnd())
      .filter((line, index) => line.length > 0 || index === 0)
    if (lines.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Receipt lines are required',
      )
    }

    const pdfFileNameRaw = rawData?.pdfFileName
    const pdfFileName =
      typeof pdfFileNameRaw === 'string' && pdfFileNameRaw.trim()
        ? pdfFileNameRaw.trim()
        : `receipt-${saleId}.pdf`

    const bucket = admin.storage().bucket()
    const safeStoreSegment = storeId
      ? storeId.replace(/[^A-Za-z0-9_-]/g, '_')
      : 'unassigned'
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
    await db
      .collection('receiptShareSessions')
      .doc(shareId)
      .set({
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
    context: functions.https.CallableContext,
  ): Promise<LogReceiptShareAttemptResponse> => {
    assertStaffAccess(context)

    const saleIdRaw = rawData?.saleId
    const saleId = typeof saleIdRaw === 'string' ? saleIdRaw.trim() : ''
    if (!saleId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'A valid saleId is required',
      )
    }

    const methodRaw = rawData?.method
    const method = typeof methodRaw === 'string' ? methodRaw.trim() : ''
    if (!SHARE_METHODS.has(method)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Unsupported share method',
      )
    }

    const statusRaw = rawData?.status
    const status = typeof statusRaw === 'string' ? statusRaw.trim() : ''
    if (!SHARE_STATUSES.has(status)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Unsupported share status',
      )
    }

    const storeIdRaw = rawData?.storeId
    const storeId =
      typeof storeIdRaw === 'string' && storeIdRaw.trim()
        ? storeIdRaw.trim()
        : null

    const shareIdRaw = rawData?.shareId
    const shareId =
      typeof shareIdRaw === 'string' && shareIdRaw.trim()
        ? shareIdRaw.trim()
        : null

    const errorMessageRaw = rawData?.errorMessage
    const errorMessage =
      typeof errorMessageRaw === 'string' && errorMessageRaw.trim()
        ? errorMessageRaw.trim().slice(0, 500)
        : null

    const attemptId = db.collection('_').doc().id
    await db
      .collection('receiptShareAttempts')
      .doc(attemptId)
      .set({
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
