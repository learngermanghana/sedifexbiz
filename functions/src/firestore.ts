import * as admin from 'firebase-admin'
import { getFirestore } from 'firebase-admin/firestore'
import * as functions from 'firebase-functions'

if (!admin.apps.length) {
  admin.initializeApp()
}

export const defaultDb = getFirestore()
export const rosterDb = defaultDb

export { admin }

const SUPPORTED_ROLES = new Set<'owner' | 'staff'>(['owner', 'staff'])

export type StoreContext = {
  storeId: string
  role: 'owner' | 'staff'
}

export async function getStoreContext(authUid: string): Promise<StoreContext> {
  if (!authUid) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required')
  }

  const memberSnap = await rosterDb.collection('teamMembers').doc(authUid).get()
  if (!memberSnap.exists) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Workspace membership required to access this resource.',
    )
  }

  const data = memberSnap.data() ?? {}
  const storeIdRaw = typeof data.storeId === 'string' ? data.storeId.trim() : ''
  if (!storeIdRaw) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Workspace membership is missing a store assignment.',
    )
  }

  const roleRaw = typeof data.role === 'string' ? data.role.trim().toLowerCase() : ''
  if (!SUPPORTED_ROLES.has(roleRaw as 'owner' | 'staff')) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Workspace membership role is not permitted for this operation.',
    )
  }

  const role = roleRaw as 'owner' | 'staff'
  return { storeId: storeIdRaw, role }
}
