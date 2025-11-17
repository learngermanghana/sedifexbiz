import * as functions from 'firebase-functions'
import { admin, defaultDb } from './firestore'
import { ensureWorkspaceForUser, normalizeExistingSlug } from './workspaces'

export const onAuthCreate = functions.auth.user().onCreate(async (user) => {
  const uid = user.uid
  const now = admin.firestore.FieldValue.serverTimestamp()

  const teamMemberRef = defaultDb.collection('teamMembers').doc(uid)
  const storeRef = defaultDb.collection('stores').doc(uid)
  const [teamMemberSnap, storeSnap] = await Promise.all([teamMemberRef.get(), storeRef.get()])

  const existingStoreData = storeSnap.exists ? storeSnap.data() : undefined
  const existingWorkspaceSlug = existingStoreData
    ? normalizeExistingSlug((existingStoreData as Record<string, unknown>).workspaceSlug ?? null)
    : null

  const { slug: workspaceSlug } = await ensureWorkspaceForUser(user, now, existingWorkspaceSlug)

  const teamMemberData: admin.firestore.DocumentData = {
    uid,
    email: user.email ?? null,
    phone: user.phoneNumber ?? null,
    workspaceSlug,
    updatedAt: now,
  }

  if (!teamMemberSnap.exists) {
    teamMemberData.createdAt = now
  }

  const storeData: admin.firestore.DocumentData = {
    ownerId: uid,
    status: 'Active',
    contractStatus: 'Active',
    workspaceSlug,
    updatedAt: now,
  }

  if (user.email) {
    storeData.ownerEmail = user.email
  }

  if (user.displayName) {
    storeData.ownerName = user.displayName
  }

  if (user.phoneNumber) {
    storeData.ownerPhone = user.phoneNumber
  }

  if (!storeSnap.exists) {
    storeData.createdAt = now
    storeData.inventorySummary = {
      trackedSkus: 0,
      lowStockSkus: 0,
      incomingShipments: 0,
    }
  } else {
    const existingInventory = (storeSnap.data() as Record<string, unknown> | undefined)?.inventorySummary
    if (!existingInventory) {
      storeData.inventorySummary = {
        trackedSkus: 0,
        lowStockSkus: 0,
        incomingShipments: 0,
      }
    }
  }

  await Promise.all([
    teamMemberRef.set(teamMemberData, { merge: true }),
    storeRef.set(storeData, { merge: true }),
  ])
})
