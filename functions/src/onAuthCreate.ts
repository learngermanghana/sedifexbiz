import * as functions from 'firebase-functions'
import { admin, rosterDb } from './firestore'

export const onAuthCreate = functions.auth.user().onCreate(async user => {
  const uid = user.uid
  const timestamp = admin.firestore.FieldValue.serverTimestamp()
  const memberRef = rosterDb.collection('teamMembers').doc(uid)
  const existingSnap = await memberRef.get()
  const existingData = existingSnap.data() ?? {}

  const existingStoreId =
    typeof existingData.storeId === 'string' ? existingData.storeId.trim() : ''
  const resolvedStoreId = existingStoreId || uid

  const existingRoleRaw =
    typeof existingData.role === 'string' ? existingData.role.trim().toLowerCase() : ''
  const resolvedRole =
    existingRoleRaw === 'owner' || existingRoleRaw === 'staff' ? existingRoleRaw : 'owner'

  await memberRef.set(
    {
      uid,
      storeId: resolvedStoreId,
      role: resolvedRole,
      email: user.email ?? null,
      phone: user.phoneNumber ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    { merge: true },
  )
})
