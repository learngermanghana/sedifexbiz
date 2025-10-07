import * as functions from 'firebase-functions'
import { admin, defaultDb, rosterDb } from './firestore'

// Optional: set a region if you want
const region = 'us-central1'

export const onAuthCreate = functions
  .region(region)
  .auth
  .user()
  .onCreate(async (user) => {
    const uid = user.uid
    const email = user.email?.toLowerCase() ?? null
    const now = admin.FieldValue.serverTimestamp()

    // For the starter, we'll set storeId == the creator's uid
    const storeId = uid

    // Team member payload placed in the roster DB
    const teamPayload = {
      uid,
      email,
      phone: user.phoneNumber ?? null,
      storeId,            // REQUIRED for resolveStoreAccess
      role: 'owner',      // creator is the owner
      name: user.displayName ?? 'Owner account',
      createdAt: now,
      updatedAt: now,
    }

    // Store payload placed in the default DB
    const storePayload = {
      storeId,            // stable ID
      ownerUid: uid,
      company: null as string | null,

      // Access/billing fields your web checks typically look for:
      paymentStatus: 'trial' as 'trial' | 'active' | 'suspended',
      contractStart: now,
      contractEnd: null as any,

      inventorySummary: {
        trackedSkus: 0,
        lowStockSkus: 0,
        incomingShipments: 0,
      },

      createdAt: now,
      updatedAt: now,
    }

    const writes: Promise<unknown>[] = [
      // Roster DB: team member by uid
      rosterDb.collection('teamMembers').doc(uid).set(teamPayload, { merge: true }),

      // Default DB: store doc
      defaultDb.collection('stores').doc(storeId).set(storePayload, { merge: true }),
    ]

    // Optional alias for email lookups
    if (email) {
      writes.push(
        rosterDb.collection('teamMembers').doc(email).set(teamPayload, { merge: true })
      )
    }

    try {
      await Promise.all(writes)
      console.log('[onAuthCreate] Seeded roster + store for', uid)
    } catch (err) {
      console.error('[onAuthCreate] Failed for', uid, err)
      throw err
    }
  })
