import * as functions from 'firebase-functions/v1'
import { admin } from './firestore'

type Role = 'owner' | 'staff'

function assertAuthenticated(ctx: functions.https.CallableContext) {
  if (!ctx.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required')
}

/**
 * Minimal callable to set a user's custom role claim using Firebase Admin only.
 * If `uid` is omitted, the caller's uid is used.
 */
export const applyRoleClaims = functions.https.onCall(async (data, context) => {
  assertAuthenticated(context)

  const uid =
    typeof data?.uid === 'string' && data.uid.trim() ? data.uid.trim() : context.auth!.uid

  if (!uid) {
    throw new functions.https.HttpsError('invalid-argument', 'A user id is required to apply role claims')
  }

  const roleRaw = typeof data?.role === 'string' ? data.role.trim().toLowerCase() : ''
  const role: Role = roleRaw === 'owner' ? 'owner' : 'staff'

  // Merge with existing custom claims to avoid clobbering anything else.
  const existing =
    (await admin
      .auth()
      .getUser(uid)
      .then(u => (u.customClaims ?? {}) as Record<string, unknown>)
      .catch(() => ({})))

  const nextClaims: Record<string, unknown> = { ...existing, role }
  delete nextClaims.stores
  delete nextClaims.activeStoreId
  delete nextClaims.storeId
  delete nextClaims.roleByStore

  await admin.auth().setCustomUserClaims(uid, nextClaims)
  return { ok: true as const, uid, claims: nextClaims }
})
