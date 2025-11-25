import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'

export const onAuthCreate = functions.auth.user().onCreate(async user => {
  const uid = user.uid
  const timestamp = admin.firestore.FieldValue.serverTimestamp()

  await defaultDb
    .collection('teamMembers')
    .doc(uid)
    .set(
      {
        uid,
        email: user.email ?? null,
        phone: user.phoneNumber ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { merge: true },
    )
})
