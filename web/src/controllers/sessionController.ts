import { setPersistence, browserLocalPersistence, type Auth, type User } from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

export async function configureAuthPersistence(auth: Auth) {
  try {
    await setPersistence(auth, browserLocalPersistence)
  } catch (error) {
    console.warn('[session] Unable to set persistence', error)
  }
}

export async function persistSession(
  user: User,
  metadata?: { storeId?: string; workspaceSlug?: string; role?: string },
) {
  const sessionDoc = doc(db, 'sessions', user.uid)
  await setDoc(
    sessionDoc,
    {
      uid: user.uid,
      email: user.email ?? null,
      metadata: metadata ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function refreshSessionHeartbeat(user: User) {
  const sessionDoc = doc(db, 'sessions', user.uid)
  await setDoc(
    sessionDoc,
    {
      heartbeatAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function ensureStoreDocument(_user: User) {
  // Placeholder for future store bootstrap logic.
}

export async function ensureTeamMemberDocument(
  _user: User,
  _options: { storeId: string; role: string },
) {
  // Placeholder for future team member bootstrap logic.
}
