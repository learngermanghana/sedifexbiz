// functions/src/pos/resolveStoreAccess.ts

import * as functions from 'firebase-functions/v1'
import { defaultDb } from '../firestore'

function normalizeCandidate(candidate: unknown): string | null {
  if (typeof candidate !== 'string') {
    return null
  }

  const trimmed = candidate.trim()
  return trimmed || null
}

/**
 * resolveStoreAccess
 *
 * Very simple version:
 * - Requires authenticated user
 * - Requires a storeId in data
 * - Verifies that the store exists in the DEFAULT Firestore DB
 * - (Later we can add role / membership checks here)
 */
export const resolveStoreAccess = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.')
  }

  const memberSnap = await defaultDb.collection('teamMembers').doc(uid).get()
  const memberData = memberSnap.data() || {}

  const candidateStoreIds = [
    data?.storeId,
    memberData.storeId,
    memberData.storeID,
    memberData.workspaceSlug,
    memberData.workspaceId,
    memberData.workspaceUid,
  ]

  const resolvedStoreId =
    candidateStoreIds.map(normalizeCandidate).find(id => id !== null) ?? uid

  const storeRef = defaultDb.collection('stores').doc(resolvedStoreId)
  const storeSnap = await storeRef.get()

  if (!storeSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Store not found.')
  }

  const storeData = storeSnap.data() || {}

  const workspaceSlug =
    typeof storeData.workspaceSlug === 'string' && storeData.workspaceSlug.trim()
      ? storeData.workspaceSlug.trim()
      : storeRef.id

  const role =
    typeof memberData.role === 'string' && memberData.role.trim().toLowerCase() === 'owner'
      ? 'owner'
      : 'staff'

  const finalStoreId = normalizeCandidate(storeData.storeId) ?? resolvedStoreId

  // For now, we just confirm access and return store info.
  // We can later add role checks or membership rules here.
  return {
    ok: true,
    storeId: finalStoreId,
    workspaceSlug,
    role,
    claims: null,
    store: {
      ...storeData,
      id: storeRef.id,
    },
  }
})
