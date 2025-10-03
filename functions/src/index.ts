import * as functions from 'firebase-functions'
import { admin } from './firebaseAdmin'
import { applyRoleClaims } from './customClaims'
import { getPersistence, type PersistenceAdapter, type Role } from './persistence'
import { deriveStoreIdFromContext, withCallableErrorLogging } from './telemetry'

import { FIREBASE_CALLABLES } from '../../shared/firebaseCallables'
import { DEFAULT_CURRENCY_CODE } from '../../shared/currency'

const VALID_ROLES: Role[] = ['owner', 'staff']

function assertAuthenticated(context: functions.https.CallableContext): asserts context is functions.https.CallableContext & {
  auth: functions.https.CallableContext['auth']
} {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in first.')
  }
}

async function getStoreContext(uid: string, adapter: PersistenceAdapter) {
  const member = await adapter.getTeamMember(uid)
  if (!member) {
    throw new functions.https.HttpsError('permission-denied', 'Workspace membership required to access this resource.')
  }
  if (!member.storeId || !VALID_ROLES.includes(member.role)) {
    throw new functions.https.HttpsError('failed-precondition', 'Workspace membership is misconfigured.')
  }
  return member
}

type ContactPayload = {
  phone?: unknown
  firstSignupEmail?: unknown
  company?: unknown
  ownerName?: unknown
  country?: unknown
  city?: unknown
}

type InitializeStorePayload = {
  contact?: ContactPayload
  storeId?: unknown
}

type ManageStaffPayload = {
  storeId?: unknown
  email?: unknown
  role?: unknown
  password?: unknown
}

type UpdateStoreProfilePayload = {
  storeId?: unknown
  name?: unknown
  timezone?: unknown
  currency?: unknown
  company?: unknown
  ownerName?: unknown
  country?: unknown
  city?: unknown
}

type RevokeStaffAccessPayload = {
  storeId?: unknown
  uid?: unknown
}

function normalizeString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', `${label} must be a string`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new functions.https.HttpsError('invalid-argument', `${label} cannot be empty`)
  }
  return trimmed
}

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Value must be a string when provided')
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeTimezone(value: unknown): string {
  if (typeof value !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Timezone must be a string')
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new functions.https.HttpsError('invalid-argument', 'Timezone is required')
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed })
  } catch (error) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Timezone "${trimmed}" is not a valid IANA timezone identifier`,
    )
  }
  return trimmed
}

function normalizeRole(value: unknown): Role {
  if (typeof value !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Role must be a string')
  }
  const normalized = value.trim().toLowerCase()
  if (!VALID_ROLES.includes(normalized as Role)) {
    throw new functions.https.HttpsError('invalid-argument', 'Role must be either owner or staff')
  }
  return normalized as Role
}

function normalizeCurrency(value: unknown): string {
  if (value === undefined || value === null) {
    return DEFAULT_CURRENCY_CODE
  }
  if (typeof value !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Currency must be a string when provided')
  }
  const trimmed = value.trim().toUpperCase()
  if (trimmed.length !== 3) {
    throw new functions.https.HttpsError('invalid-argument', 'Currency must be a valid ISO-4217 code')
  }
  return trimmed
}

async function ensureOwner(context: functions.https.CallableContext, adapter: PersistenceAdapter) {
  assertAuthenticated(context)
  const auth = context.auth!
  const membership = await getStoreContext(auth.uid, adapter)
  if (membership.role !== 'owner') {
    throw new functions.https.HttpsError('permission-denied', 'Owner role required for this action.')
  }
  return membership
}

function normalizeStoreId(candidate: unknown, fallback: string): string {
  if (candidate === undefined || candidate === null) {
    return fallback
  }
  if (typeof candidate !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Store ID must be a string when provided')
  }
  const trimmed = candidate.trim()
  if (!trimmed) {
    throw new functions.https.HttpsError('invalid-argument', 'Store ID cannot be empty')
  }
  return trimmed
}

export const initializeStore = functions.https.onCall(
  withCallableErrorLogging(
    FIREBASE_CALLABLES.INITIALIZE_STORE,
    async (data: InitializeStorePayload, context) => {
      assertAuthenticated(context)
      const adapter = getPersistence()
      const auth = context.auth!
      const membership = await adapter.getTeamMember(auth.uid)
      const fallbackStoreId = auth.uid
      const storeId = normalizeStoreId(data?.storeId, membership?.storeId ?? fallbackStoreId)

      const contact = data?.contact ?? {}
      const phone = normalizeOptionalString(contact.phone)
      const firstSignupEmail = normalizeOptionalString(contact.firstSignupEmail)
      const company = normalizeOptionalString(contact.company)
      const ownerName = normalizeOptionalString(contact.ownerName)
      const country = normalizeOptionalString(contact.country)
      const city = normalizeOptionalString(contact.city)

      await adapter.upsertTeamMember({
        uid: auth.uid,
        storeId,
        role: 'owner',
        phone: phone ?? membership?.phone ?? null,
        firstSignupEmail: firstSignupEmail ?? membership?.firstSignupEmail ?? null,
        company: company ?? membership?.company ?? null,
        name: ownerName ?? membership?.name ?? null,
        country: country ?? membership?.country ?? null,
        city: city ?? membership?.city ?? null,
      })

      await adapter.upsertStore({
        id: storeId,
        name: storeId,
        displayName: storeId,
        timezone: 'UTC',
        currency: DEFAULT_CURRENCY_CODE,
        company,
        ownerName,
        country,
        city,
      })

      await applyRoleClaims({ uid: auth.uid, role: 'owner', storeId })
      return { ok: true, storeId }
    },
    {
      resolveStoreId: (_data, context) => deriveStoreIdFromContext(context),
    },
  ),
)

export const resolveStoreAccess = functions.https.onCall(
  withCallableErrorLogging(
    FIREBASE_CALLABLES.RESOLVE_STORE_ACCESS,
    async (_data, context) => {
      if (!context.auth) {
        return { ok: false, error: 'NO_MEMBERSHIP' as const }
      }
      const adapter = getPersistence()
      const member = await adapter.getTeamMember(context.auth.uid)
      if (!member || !member.storeId || !VALID_ROLES.includes(member.role)) {
        return { ok: false, error: 'NO_MEMBERSHIP' as const }
      }
      return { ok: true as const, storeId: member.storeId, role: member.role }
    },
  ),
)

async function getOrCreateUserByEmail(email: string, password: string | null) {
  try {
    const record = await admin.auth().getUserByEmail(email)
    if (password) {
      await admin.auth().updateUser(record.uid, { password })
    }
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

export const manageStaffAccount = functions.https.onCall(
  withCallableErrorLogging(
    FIREBASE_CALLABLES.MANAGE_STAFF_ACCOUNT,
    async (data: ManageStaffPayload, context) => {
      const adapter = getPersistence()
      const ownerMembership = await ensureOwner(context, adapter)
      const storeId = normalizeStoreId(data?.storeId ?? ownerMembership.storeId, ownerMembership.storeId)
      if (storeId !== ownerMembership.storeId) {
        throw new functions.https.HttpsError('permission-denied', 'Cannot manage staff for another store')
      }

      const email = normalizeString(data?.email, 'Email').toLowerCase()
      const role = normalizeRole(data?.role ?? 'staff')
      const password = data?.password === undefined ? null : normalizeString(data.password, 'Password')
      const { record } = await getOrCreateUserByEmail(email, password)

      await adapter.upsertTeamMember({
        uid: record.uid,
        storeId,
        role,
        email,
        invitedBy: ownerMembership.uid,
      } as any)

      await applyRoleClaims({ uid: record.uid, role, storeId })
      return { ok: true, uid: record.uid, storeId, role }
    },
    {
      resolveStoreId: (_data, context) => deriveStoreIdFromContext(context),
    },
  ),
)

export const revokeStaffAccess = functions.https.onCall(
  withCallableErrorLogging(
    FIREBASE_CALLABLES.REVOKE_STAFF_ACCESS,
    async (data: RevokeStaffAccessPayload, context) => {
      const adapter = getPersistence()
      const ownerMembership = await ensureOwner(context, adapter)
      const storeId = normalizeStoreId(data?.storeId ?? ownerMembership.storeId, ownerMembership.storeId)
      if (storeId !== ownerMembership.storeId) {
        throw new functions.https.HttpsError('permission-denied', 'Cannot modify another store')
      }

      const uid = normalizeString(data?.uid, 'UID')
      if (uid === ownerMembership.uid) {
        throw new functions.https.HttpsError('failed-precondition', 'Owners cannot revoke their own access')
      }

      await adapter.removeTeamMember(uid)
      await admin.auth().setCustomUserClaims(uid, {})
      return { ok: true }
    },
    {
      resolveStoreId: (data, context) => {
        if (data && typeof data.storeId === 'string') {
          const trimmed = data.storeId.trim()
          if (trimmed) return trimmed
        }
        return deriveStoreIdFromContext(context)
      },
    },
  ),
)

export const updateStoreProfile = functions.https.onCall(
  withCallableErrorLogging(
    FIREBASE_CALLABLES.UPDATE_STORE_PROFILE,
    async (data: UpdateStoreProfilePayload, context) => {
      const adapter = getPersistence()
      const ownerMembership = await ensureOwner(context, adapter)
      const storeId = normalizeStoreId(data?.storeId ?? ownerMembership.storeId, ownerMembership.storeId)
      if (storeId !== ownerMembership.storeId) {
        throw new functions.https.HttpsError('permission-denied', 'Cannot update another store')
      }

      const name = normalizeString(data?.name ?? ownerMembership.storeId, 'Store name')
      const timezone = normalizeTimezone(data?.timezone ?? 'UTC')
      const currency = normalizeCurrency(data?.currency ?? DEFAULT_CURRENCY_CODE)
      const company = normalizeOptionalString(data?.company)
      const ownerName = normalizeOptionalString(data?.ownerName)
      const country = normalizeOptionalString(data?.country)
      const city = normalizeOptionalString(data?.city)

      await adapter.upsertStore({
        id: storeId,
        name,
        displayName: name,
        timezone,
        currency,
        company,
        ownerName,
        country,
        city,
      })

      return { ok: true, storeId }
    },
    {
      resolveStoreId: (data, context) => {
        if (data && typeof data.storeId === 'string') {
          const trimmed = data.storeId.trim()
          if (trimmed) return trimmed
        }
        return deriveStoreIdFromContext(context)
      },
    },
  ),
)

export const runNightlyDataHygiene = functions.pubsub
  .schedule('0 3 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    const adapter = getPersistence()
    const membersByStore = new Map<string, number>()
    const storesToAudit = new Set<string>()

    for (const role of VALID_ROLES) {
      // intentionally no-op to keep roles referenced for linting
      if (!role) continue
    }

    const owners: Array<{ storeId: string; uid: string }> = []
    // gather owners for auditing
    const auditStoreId = process.env.NIGHTLY_AUDIT_STORE_ID
    if (auditStoreId) {
      storesToAudit.add(auditStoreId)
    }

    for (const storeId of storesToAudit) {
      const members = await adapter.listTeamMembers(storeId)
      membersByStore.set(storeId, members.length)
      const owner = members.find(member => member.role === 'owner')
      if (owner) {
        owners.push({ storeId, uid: owner.uid })
      }
    }

    return { ok: true, auditedStores: Array.from(storesToAudit), membersByStore: Object.fromEntries(membersByStore), owners }
  })
