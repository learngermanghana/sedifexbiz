import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'

/**
 * onAuthCreate
 *  - Runs when a new Firebase Auth user is created
 *  - Writes a basic teamMembers/<uid> document in the DEFAULT Firestore DB
 *  - Role + storeId will be set later by the onboarding callable (handleUserCreate)
 */
export const onAuthCreate = functions.auth.user().onCreate(async user => {
  const uid = user.uid
  const now = admin.firestore.FieldValue.serverTimestamp()

  functions.logger.info('onAuthCreate triggered', {
    uid,
    email: user.email ?? null,
    phone: user.phoneNumber ?? null,
  })

  try {
    await defaultDb
      .collection('teamMembers')
      .doc(uid)
      .set(
        {
          uid,
          email: user.email ?? null,
          phone: user.phoneNumber ?? null,
          role: 'pending',     // will later become "owner" or "member"
          storeId: null,       // will be set after onboarding
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      )

    functions.logger.info('onAuthCreate completed successfully', { uid })
  } catch (error) {
    functions.logger.error('onAuthCreate failed', {
      uid,
      errorMessage: (error as any)?.message ?? String(error),
      error,
    })
  }
})
