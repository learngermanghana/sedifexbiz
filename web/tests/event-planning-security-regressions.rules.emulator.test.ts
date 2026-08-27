import { describe, test } from 'vitest'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  signOut,
  type Auth,
} from 'firebase/auth'

const projectId = process.env.GCLOUD_PROJECT ?? 'sedifex-ci'
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'
const shouldRun = process.env.RUN_EVENT_PLANNING_EMULATOR_TESTS === '1'
const [firestoreAddress, firestorePortRaw] = firestoreHost.split(':')
const firestorePort = Number(firestorePortRaw ?? '8080')

interface TestContext {
  app: FirebaseApp
  db: Firestore
  auth: Auth
  uid: string
  storeId: string
}

function createBaseApp(name: string) {
  const app = initializeApp(
    {
      projectId,
      apiKey: 'fake-api-key',
      authDomain: `${projectId}.firebaseapp.com`,
    },
    name,
  )
  const db = getFirestore(app)
  connectFirestoreEmulator(db, firestoreAddress, firestorePort)
  const auth = getAuth(app)
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true })
  return { app, db, auth }
}

async function createOwner(): Promise<TestContext> {
  const base = createBaseApp(`event-regression-owner-${Math.random().toString(36).slice(2)}`)
  await signInAnonymously(base.auth)
  const user = base.auth.currentUser
  if (!user) throw new Error('Anonymous sign-in failed')

  const storeId = user.uid
  await setDoc(doc(base.db, 'teamMembers', user.uid), {
    uid: user.uid,
    storeId,
    role: 'owner',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await setDoc(doc(base.db, 'stores', storeId), {
    storeId,
    ownerUid: user.uid,
    name: 'Security regression store',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return { ...base, uid: user.uid, storeId }
}

async function createStaff(owner: TestContext): Promise<TestContext> {
  const base = createBaseApp(`event-regression-staff-${Math.random().toString(36).slice(2)}`)
  await signInAnonymously(base.auth)
  const user = base.auth.currentUser
  if (!user) throw new Error('Anonymous sign-in failed')

  await setDoc(doc(owner.db, 'teamMembers', user.uid), {
    uid: user.uid,
    storeId: owner.storeId,
    role: 'staff',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return { ...base, uid: user.uid, storeId: owner.storeId }
}

async function expectPermissionDenied<T>(promise: Promise<T>, message: string) {
  try {
    await promise
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error
      ? (error as { code?: string }).code
      : undefined
    if (code === 'permission-denied') return
    throw new Error(`${message} - expected permission-denied, received: ${String(error)}`)
  }
  throw new Error(`${message} - expected permission-denied, but operation succeeded`)
}

async function destroyContext(context: TestContext) {
  await signOut(context.auth).catch(() => {})
  await deleteApp(context.app)
}

function eventPayload() {
  return {
    eventCode: `ECE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    title: 'Security Regression Event',
    eventType: 'Corporate event',
    clientName: 'Test Client',
    eventDate: '2026-09-20',
    status: 'planning',
    progress: 20,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
}

const describeOrSkip = shouldRun ? describe : describe.skip

describeOrSkip('Event planning P1 security regressions', () => {
  test('an owner cannot forge linked-store access by re-parenting another store', async () => {
    const attacker = await createOwner()
    const victim = await createOwner()
    try {
      await expectPermissionDenied(
        updateDoc(doc(attacker.db, 'stores', victim.storeId), {
          parentStoreId: attacker.storeId,
        }),
        'owner must not be able to forge parentStoreId on another store',
      )

      await expectPermissionDenied(
        updateDoc(doc(attacker.db, 'stores', victim.storeId), {
          ownerUid: attacker.uid,
        }),
        'owner must not be able to rewrite another store ownership identifier',
      )
    } finally {
      await destroyContext(victim)
      await destroyContext(attacker)
    }
  })

  test('staff cannot delete a root event through a recursive descendant rule', async () => {
    const owner = await createOwner()
    const staff = await createStaff(owner)
    try {
      const ownerEventRef = doc(owner.db, 'stores', owner.storeId, 'events', 'staff-delete-regression')
      await setDoc(ownerEventRef, eventPayload())

      await expectPermissionDenied(
        deleteDoc(doc(staff.db, 'stores', owner.storeId, 'events', 'staff-delete-regression')),
        'staff must not be able to delete the root event document',
      )
    } finally {
      await destroyContext(staff)
      await destroyContext(owner)
    }
  })

  test('secure contract bearer-link records are never exposed to browser Firestore clients', async () => {
    const owner = await createOwner()
    try {
      const linkRef = doc(owner.db, 'eventContractLinks', 'browser-must-not-access-this-link')
      await expectPermissionDenied(
        setDoc(linkRef, {
          storeId: owner.storeId,
          eventId: 'event-1',
          reviewUrl: 'https://sedifex.com/event-contract/secret-token',
        }),
        'store owner must not be able to forge or overwrite a secure contract link directly',
      )
      await expectPermissionDenied(
        getDoc(linkRef),
        'store owner must not be able to read secure contract bearer-link records directly',
      )
    } finally {
      await destroyContext(owner)
    }
  })

  test('secure client collaboration bearer-link records are never exposed to browser Firestore clients', async () => {
    const owner = await createOwner()
    try {
      const linkRef = doc(owner.db, 'eventClientLinks', 'browser-must-not-access-client-link')
      await expectPermissionDenied(
        setDoc(linkRef, {
          storeId: owner.storeId,
          eventId: 'event-1',
          recipientEmail: 'client@example.com',
          status: 'active',
        }),
        'store owner must not be able to forge or overwrite a secure client collaboration link directly',
      )
      await expectPermissionDenied(
        getDoc(linkRef),
        'store owner must not be able to read secure client collaboration bearer-link records directly',
      )
    } finally {
      await destroyContext(owner)
    }
  })
})
