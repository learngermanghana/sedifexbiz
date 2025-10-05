import * as functions from 'firebase-functions'
import { admin, defaultDb, rosterDb } from './firestore'

export const onAuthCreate = functions.auth.user().onCreate(async user => {
  const uid = user.uid
  const timestamp = admin.firestore.FieldValue.serverTimestamp()

  await rosterDb
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

  await defaultDb
    .collection('stores')
    .doc(uid)
    .set(
      {
        ownerId: uid,
        status: 'active',
        inventorySummary: {
          trackedSkus: 0,
          lowStockSkus: 0,
          incomingShipments: 0,
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { merge: true },
    )
})
