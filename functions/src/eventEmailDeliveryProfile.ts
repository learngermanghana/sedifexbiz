import * as functions from 'firebase-functions/v1'
import { defaultDb } from './firestore'
import { eventEmailDeliveryProfile } from './eventContractEmail'

type RecordMap = Record<string, unknown>

function text(value: unknown, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

async function assertStoreAccess(storeId: string, uid: string) {
  const [storeSnapshot, memberSnapshot] = await Promise.all([
    defaultDb.collection('stores').doc(storeId).get(),
    defaultDb.collection('teamMembers').doc(uid).get(),
  ])
  if (!storeSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Store not found')
  const storeData = storeSnapshot.data() as RecordMap
  const memberData = memberSnapshot.exists ? memberSnapshot.data() as RecordMap : {}
  const direct = text(memberData.uid, 220) === uid && text(memberData.storeId, 180) === storeId
  const linkedOwner = text(memberData.uid, 220) === uid
    && text(memberData.role, 40) === 'owner'
    && Boolean(text(memberData.storeId, 180))
    && text(storeData.parentStoreId, 180) === text(memberData.storeId, 180)
  const ownerUid = text(storeData.ownerUid, 220) === uid
  if (!direct && !linkedOwner && !ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to this store')
  }
}

export const getEventEmailDeliveryProfile = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  if (!storeId) throw new functions.https.HttpsError('invalid-argument', 'storeId is required')
  await assertStoreAccess(storeId, context.auth.uid)
  return eventEmailDeliveryProfile(storeId)
})
