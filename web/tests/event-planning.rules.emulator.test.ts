import { afterAll, describe, test } from 'vitest'
import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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

const projectId = process.env.GCLOUD_PROJECT ?? 'sedifex-ac2b0'
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'
const shouldRun = process.env.RUN_EVENT_PLANNING_EMULATOR_TESTS === '1'

const [firestoreAddress, firestorePortRaw] = firestoreHost.split(':')
const firestorePort = Number(firestorePortRaw ?? '8080')
const authBaseUrl = `http://${authHost}`

interface TestContext {
  app: FirebaseApp
  db: Firestore
  auth: Auth | null
  uid: string | null
  storeId: string | null
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
  connectAuthEmulator(auth, authBaseUrl, { disableWarnings: true })
  return { app, db, auth }
}

async function createOwner(): Promise<TestContext> {
  const base = createBaseApp(`event-owner-${Math.random().toString(36).slice(2)}`)
  await signInAnonymously(base.auth)
  const user = base.auth.currentUser
  if (!user) throw new Error('Anonymous sign-in failed for event owner test context')

  // Production owner workspaces use the owner's uid as their primary store id.
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
    name: 'Event Planning Test Store',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return { ...base, uid: user.uid, storeId }
}

async function createStaff(owner: TestContext): Promise<TestContext> {
  if (!owner.storeId) throw new Error('Owner store is required')
  const base = createBaseApp(`event-staff-${Math.random().toString(36).slice(2)}`)
  await signInAnonymously(base.auth)
  const user = base.auth.currentUser
  if (!user) throw new Error('Anonymous sign-in failed for event staff test context')

  await setDoc(doc(owner.db, 'teamMembers', user.uid), {
    uid: user.uid,
    storeId: owner.storeId,
    role: 'staff',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return { ...base, uid: user.uid, storeId: owner.storeId }
}

async function createAuthenticatedWithoutMembership(): Promise<TestContext> {
  const base = createBaseApp(`event-no-membership-${Math.random().toString(36).slice(2)}`)
  await signInAnonymously(base.auth)
  const user = base.auth.currentUser
  if (!user) throw new Error('Anonymous sign-in failed for no-membership test context')
  return { ...base, uid: user.uid, storeId: null }
}

async function createUnauthenticated(): Promise<TestContext> {
  const base = createBaseApp(`event-unauth-${Math.random().toString(36).slice(2)}`)
  await signOut(base.auth).catch(() => {})
  return { ...base, auth: null, uid: null, storeId: null }
}

async function destroyContext(context: TestContext) {
  if (context.auth) await signOut(context.auth).catch(() => {})
  await deleteApp(context.app)
}

async function expectSucceeds<T>(promise: Promise<T>, message: string) {
  try {
    await promise
  } catch (error) {
    throw new Error(`${message} - expected success, received: ${String(error)}`)
  }
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

function eventPayload(title = 'Ama & Kojo Wedding') {
  return {
    eventCode: `ECE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    title,
    eventType: 'Traditional wedding',
    clientName: 'Ama Mensah',
    eventDate: '2026-09-20',
    startTime: '12:00',
    venue: 'Accra',
    guestCount: 200,
    planningPackage: 'full_planning',
    complexity: 'standard',
    status: 'planning',
    progress: 20,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
}

const describeOrSkip = shouldRun ? describe : describe.skip

afterAll(async () => {
  // Contexts are destroyed per test. This hook keeps Vitest explicit when the
  // emulator suite is skipped in ordinary unit-test runs.
})

describeOrSkip('Firestore rules - event planning', () => {
  test('owner can create, read, update and delete an event in their own store', async () => {
    const owner = await createOwner()
    try {
      const eventRef = doc(owner.db, 'stores', owner.storeId!, 'events', 'owner-crud')
      await expectSucceeds(setDoc(eventRef, eventPayload()), 'owner should create event')
      await expectSucceeds(getDoc(eventRef), 'owner should read event')
      await expectSucceeds(updateDoc(eventRef, { progress: 75, updatedAt: serverTimestamp() }), 'owner should update event')
      await expectSucceeds(deleteDoc(eventRef), 'owner should delete event')
    } finally {
      await destroyContext(owner)
    }
  })

  test('staff can work on events but cannot delete the event record', async () => {
    const owner = await createOwner()
    const staff = await createStaff(owner)
    try {
      const existingRef = doc(owner.db, 'stores', owner.storeId!, 'events', 'staff-edit')
      await setDoc(existingRef, eventPayload())

      const staffExistingRef = doc(staff.db, 'stores', owner.storeId!, 'events', 'staff-edit')
      await expectSucceeds(getDoc(staffExistingRef), 'staff should read event')
      await expectSucceeds(updateDoc(staffExistingRef, { status: 'confirmed', updatedAt: serverTimestamp() }), 'staff should update event')
      await expectSucceeds(
        setDoc(doc(staff.db, 'stores', owner.storeId!, 'events', 'staff-create'), eventPayload('Staff-created event')),
        'staff should create event',
      )
      await expectPermissionDenied(deleteDoc(staffExistingRef), 'staff should not delete event record')
    } finally {
      await destroyContext(staff)
      await destroyContext(owner)
    }
  })

  test('another store owner cannot read or mutate event data', async () => {
    const owner = await createOwner()
    const outsider = await createOwner()
    try {
      const eventPath = ['stores', owner.storeId!, 'events', 'isolated-event'] as const
      await setDoc(doc(owner.db, ...eventPath), eventPayload())
      const outsiderRef = doc(outsider.db, ...eventPath)

      await expectPermissionDenied(getDoc(outsiderRef), 'other store should not read event')
      await expectPermissionDenied(updateDoc(outsiderRef, { progress: 100 }), 'other store should not update event')
      await expectPermissionDenied(deleteDoc(outsiderRef), 'other store should not delete event')
      await expectPermissionDenied(
        setDoc(doc(outsider.db, 'stores', owner.storeId!, 'events', 'cross-store-create'), eventPayload()),
        'other store should not create event',
      )
    } finally {
      await destroyContext(outsider)
      await destroyContext(owner)
    }
  })

  test('event subcollections inherit store isolation', async () => {
    const owner = await createOwner()
    const outsider = await createOwner()
    try {
      const guestRef = doc(owner.db, 'stores', owner.storeId!, 'events', 'subcollections', 'guests', 'guest-1')
      await expectSucceeds(setDoc(guestRef, { name: 'Guest One', rsvp: 'yes' }), 'owner should write event guest')
      await expectPermissionDenied(
        getDoc(doc(outsider.db, 'stores', owner.storeId!, 'events', 'subcollections', 'guests', 'guest-1')),
        'other store should not read event guest',
      )
    } finally {
      await destroyContext(outsider)
      await destroyContext(owner)
    }
  })

  test('authenticated users without membership and unauthenticated users are denied', async () => {
    const owner = await createOwner()
    const noMembership = await createAuthenticatedWithoutMembership()
    const unauthenticated = await createUnauthenticated()
    try {
      await setDoc(doc(owner.db, 'stores', owner.storeId!, 'events', 'membership-required'), eventPayload())
      await expectPermissionDenied(
        getDoc(doc(noMembership.db, 'stores', owner.storeId!, 'events', 'membership-required')),
        'signed-in user without membership should be denied',
      )
      await expectPermissionDenied(
        getDoc(doc(unauthenticated.db, 'stores', owner.storeId!, 'events', 'membership-required')),
        'unauthenticated user should be denied',
      )
    } finally {
      await destroyContext(unauthenticated)
      await destroyContext(noMembership)
      await destroyContext(owner)
    }
  })

  test('audit history is readable by store members but immutable from browser clients', async () => {
    const owner = await createOwner()
    const staff = await createStaff(owner)
    const outsider = await createOwner()
    try {
      await expectSucceeds(
        getDocs(collection(owner.db, 'stores', owner.storeId!, 'eventActivity')),
        'owner should read own event activity collection',
      )
      await expectSucceeds(
        getDocs(collection(staff.db, 'stores', owner.storeId!, 'eventActivity')),
        'staff should read own event activity collection',
      )
      await expectPermissionDenied(
        getDocs(collection(outsider.db, 'stores', owner.storeId!, 'eventActivity')),
        'other store should not read event activity',
      )
      await expectPermissionDenied(
        setDoc(doc(owner.db, 'stores', owner.storeId!, 'eventActivity', 'forged-entry'), {
          action: 'updated',
          eventId: 'event-1',
        }),
        'browser client should not forge event activity',
      )
    } finally {
      await destroyContext(outsider)
      await destroyContext(staff)
      await destroyContext(owner)
    }
  })

  test('a member cannot move themselves to another store or self-promote', async () => {
    const owner = await createOwner()
    const staff = await createStaff(owner)
    try {
      const staffMembership = doc(staff.db, 'teamMembers', staff.uid!)
      await expectPermissionDenied(
        updateDoc(staffMembership, { storeId: staff.uid }),
        'staff should not move their membership to another store',
      )
      await expectPermissionDenied(
        updateDoc(staffMembership, { role: 'owner' }),
        'staff should not promote themselves to owner',
      )
    } finally {
      await destroyContext(staff)
      await destroyContext(owner)
    }
  })
})
