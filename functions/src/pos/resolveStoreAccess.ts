// functions/src/pos/resolveStoreAccess.ts

import * as functions from 'firebase-functions/v1'
import { defaultDb } from '../firestore'

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

  const storeIdRaw = (data?.storeId ?? '').toString().trim()
  if (!storeIdRaw) {
    throw new functions.https.HttpsError('invalid-argument', 'storeId is required.')
  }

  const storeRef = defaultDb.collection('stores').doc(storeIdRaw)
  const storeSnap = await storeRef.get()

  if (!storeSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Store not found.')
  }

  const storeData = storeSnap.data() || {}

  // For now, we just confirm access and return store info.
  // We can later add role checks or membership rules here.
  return {
    ok: true,
    storeId: storeIdRaw,
    store: {
      ...storeData,
      id: storeRef.id,
    },
  }
})
