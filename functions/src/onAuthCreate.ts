import * as functions from 'firebase-functions'
import { getFirestore } from 'firebase-admin/firestore'
import * as admin from 'firebase-admin'

if (!admin.apps.length) admin.initializeApp()

export const onAuthCreate = functions.auth.user().onCreate(async user => {
  const db = getFirestore()
  const uid = user.uid
  const timestamp = admin.firestore.FieldValue.serverTimestamp()

  await db
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
