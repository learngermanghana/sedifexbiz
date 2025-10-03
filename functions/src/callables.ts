import * as functions from 'firebase-functions'
import { applyRoleClaims } from './customClaims'
import { getPersistence } from './persistence'
import { deriveStoreIdFromContext, withCallableErrorLogging } from './telemetry'
import { FIREBASE_CALLABLES } from '../../shared/firebaseCallables'

const persistence = () => getPersistence()

type ContactPayload = {
  phone?: unknown
  firstSignupEmail?: unknown
}

type BackfillPayload = {
  contact?: ContactPayload
}

function normalizeNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Value must be a string when provided')
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeContact(contact: ContactPayload | undefined) {
  let hasPhone = false
  let hasFirstSignupEmail = false
  let phone: string | null | undefined
  let firstSignupEmail: string | null | undefined

  if (contact && typeof contact === 'object') {
    if ('phone' in contact) {
      hasPhone = true
      phone = normalizeNullableString(contact.phone)
    }

    if ('firstSignupEmail' in contact) {
      hasFirstSignupEmail = true
      const normalized = normalizeNullableString(contact.firstSignupEmail)
      firstSignupEmail = typeof normalized === 'string' ? normalized.toLowerCase() : normalized
    }
  }

  return { phone, hasPhone, firstSignupEmail, hasFirstSignupEmail }
}

export const backfillMyStore = functions.https.onCall(
  withCallableErrorLogging(
    FIREBASE_CALLABLES.BACKFILL_MY_STORE,
    async (data, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in first.')
      }

      const uid = context.auth.uid
      const token = context.auth.token as Record<string, unknown>
      const email = typeof token.email === 'string' ? token.email : null
      const phone = typeof token.phone_number === 'string' ? token.phone_number : null

      const payload = (data ?? {}) as BackfillPayload
      const contact = normalizeContact(payload.contact)
      const resolvedPhone = contact.hasPhone ? contact.phone ?? null : phone ?? null
      const resolvedFirstSignupEmail = contact.hasFirstSignupEmail
        ? contact.firstSignupEmail ?? null
        : email?.toLowerCase() ?? null

      const adapter = persistence()
      const existing = await adapter.getTeamMember(uid)
      const storeId = existing?.storeId ?? uid

      await adapter.upsertTeamMember({
        uid,
        storeId,
        role: 'owner',
        email,
        phone: resolvedPhone,
        firstSignupEmail: resolvedFirstSignupEmail,
      })

      const claims = await applyRoleClaims({ uid, role: 'owner', storeId })
      return { ok: true, claims, storeId }
    },
    {
      resolveStoreId: async (_data, context) => {
        const uid = context.auth?.uid
        if (!uid) return deriveStoreIdFromContext(context)
        try {
          const member = await persistence().getTeamMember(uid)
          if (member?.storeId) {
            return member.storeId
          }
        } catch (error) {
          functions.logger.warn('[backfillMyStore] Failed to resolve storeId for telemetry', {
            error,
          })
        }
        const fromContext = deriveStoreIdFromContext(context)
        if (fromContext) return fromContext
        return uid
      },
    },
  ),
)
