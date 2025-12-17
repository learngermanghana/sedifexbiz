// functions/src/confirmPayment.ts
import * as functions from 'firebase-functions/v1'
import { defaultDb } from './firestore'

/**
 * Simple stub used by the app to confirm that a payment reference exists.
 * You can extend this later with stricter checks.
 */
export const confirmPayment = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required')
  }

  const reference =
    typeof data?.reference === 'string' ? data.reference.trim() : ''

  if (!reference) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'reference is required',
    )
  }

  // Look for a subscription document with this Paystack reference
  const snap = await defaultDb
    .collection('subscriptions')
    .where('reference', '==', reference)
    .limit(1)
    .get()

  if (snap.empty) {
    return { ok: false, found: false }
  }

  const doc = snap.docs[0]
  return { ok: true, found: true, subscriptionId: doc.id, data: doc.data() }
})
