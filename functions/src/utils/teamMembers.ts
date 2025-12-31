import type { firestore } from 'firebase-admin'

const TEAM_MEMBERS_COLLECTION = 'teamMembers'

export function buildMembershipDocId(uid: string, storeId: string) {
  return `${uid}_${storeId}`
}

export function getMembershipRef(
  db: firestore.Firestore,
  uid: string,
  storeId: string,
) {
  return db.collection(TEAM_MEMBERS_COLLECTION).doc(buildMembershipDocId(uid, storeId))
}

export function getProfileRef(db: firestore.Firestore, uid: string) {
  return db.collection(TEAM_MEMBERS_COLLECTION).doc(uid)
}

export async function findFirstMembership(
  db: firestore.Firestore,
  uid: string,
): Promise<{ ref: firestore.DocumentReference; data: firestore.DocumentData } | null> {
  const snapshot = await db.collection(TEAM_MEMBERS_COLLECTION).where('uid', '==', uid).get()
  if (snapshot.empty) return null

  const docs = snapshot.docs
  const nonProfile = docs.find(doc => doc.id !== uid && Boolean(doc.data().storeId))
  const match = nonProfile ?? docs.find(doc => Boolean(doc.data().storeId)) ?? docs[0]
  return { ref: match.ref, data: match.data() }
}

export async function findMembershipByStore(
  db: firestore.Firestore,
  uid: string,
  storeId: string,
): Promise<{ ref: firestore.DocumentReference; data: firestore.DocumentData } | null> {
  const ref = getMembershipRef(db, uid, storeId)
  const snapshot = await ref.get()
  if (snapshot.exists) {
    return { ref, data: snapshot.data() ?? {} }
  }

  const legacyRef = getProfileRef(db, uid)
  const legacySnap = await legacyRef.get()
  if (legacySnap.exists) {
    const legacyData = legacySnap.data() ?? {}
    const legacyStoreId =
      typeof legacyData.storeId === 'string' ? legacyData.storeId.trim() : ''
    if (legacyStoreId && legacyStoreId === storeId) {
      return { ref: legacyRef, data: legacyData }
    }
  }

  return null
}

export async function upsertMembership(
  db: firestore.Firestore,
  uid: string,
  storeId: string,
  data: firestore.DocumentData,
  updateProfile = true,
) {
  const memberRef = getMembershipRef(db, uid, storeId)
  await memberRef.set(
    {
      uid,
      storeId,
      ...data,
    },
    { merge: true },
  )

  if (!updateProfile) return

  const profilePayload: firestore.DocumentData = {
    uid,
    updatedAt: data.updatedAt ?? data.createdAt ?? null,
  }

  if ('email' in data) {
    profilePayload.email = data.email ?? null
  }

  if ('phone' in data) {
    profilePayload.phone = data.phone ?? null
  }

  await getProfileRef(db, uid).set(profilePayload, { merge: true })
}
