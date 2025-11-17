import * as functions from 'firebase-functions/v1'
import { admin, defaultDb, rosterDb } from './firestore'

export const onAuthCreate = functions.auth.user().onCreate(async (user) => {
  const uid = user.uid
  const now = admin.firestore.FieldValue.serverTimestamp()

  // Roster DB: teamMembers/<uid>
  await rosterDb
    .collection('teamMembers')
    .doc(uid)
    .set(
      {
        uid,
        email: user.email ?? null,
        phone: user.phoneNumber ?? null,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    )

  // Default DB: stores/<uid>
  await defaultDb
    .collection('stores')
    .doc(uid)
    .set(
      {
        ownerId: uid,
        status: 'Active',
        contractStatus: 'Active',
        inventorySummary: {
          trackedSkus: 0,
          lowStockSkus: 0,
          incomingShipments: 0,
        },
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    )
})
