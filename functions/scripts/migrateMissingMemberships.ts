import * as admin from 'firebase-admin'

if (!admin.apps.length) {
  admin.initializeApp()
}

const auth = admin.auth()
const db = admin.firestore()

function buildDeterministicStoreId(uid: string): string {
  const suffix = uid.slice(0, 8) || uid
  return `store-${suffix}`
}

function resolveDisplayName(user: admin.auth.UserRecord): string {
  const direct = user.displayName?.trim()
  if (direct) {
    return direct
  }

  const email = user.email?.trim()
  if (email) {
    const [local] = email.split('@')
    if (local) {
      return local
    }
  }

  return `Owner ${user.uid.slice(0, 6)}`
}

async function migrateUser(user: admin.auth.UserRecord): Promise<'skipped' | 'created' | 'failed'> {
  const uid = user.uid
  const memberRef = db.collection('teamMembers').doc(uid)
  const existing = await memberRef.get()
  if (existing.exists) {
    console.log(`[migrate-missing-members] Skipping ${uid}; membership already exists`)
    return 'skipped'
  }

  const storeId = buildDeterministicStoreId(uid)
  const name = resolveDisplayName(user)
  const now = admin.firestore.Timestamp.now()

  const teamMemberPayload: Record<string, unknown> = {
    uid,
    storeId,
    role: 'owner',
    email: user.email ?? null,
    phoneNumber: user.phoneNumber ?? null,
    name,
    createdAt: now,
    updatedAt: now,
  }

  try {
    const storeRef = db.collection('stores').doc(storeId)
    const existingStore = await storeRef.get()

    const storePayload: Record<string, unknown> = {
      storeId,
      ownerId: uid,
      ownerEmail: user.email ?? null,
      ownerName: name,
      updatedAt: now,
    }

    if (!existingStore.exists) {
      storePayload.createdAt = now
    }

    await memberRef.set(teamMemberPayload, { merge: true })
    await storeRef.set(storePayload, { merge: true })
    console.log(`[migrate-missing-members] Created membership and store for ${uid} -> ${storeId}`)
    return 'created'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[migrate-missing-members] Failed to create membership for ${uid}: ${message}`)
    return 'failed'
  }
}

async function run(): Promise<void> {
  let nextPageToken: string | undefined
  let processed = 0
  let created = 0
  let failed = 0

  do {
    const result = await auth.listUsers(1000, nextPageToken)
    for (const user of result.users) {
      const outcome = await migrateUser(user)
      processed += 1
      if (outcome === 'created') {
        created += 1
      } else if (outcome === 'failed') {
        failed += 1
      }
    }
    nextPageToken = result.pageToken
  } while (nextPageToken)

  console.log(
    `[migrate-missing-members] Migration complete. Processed ${processed} users, created ${created} memberships, ${failed} failures`,
  )
}

run().catch(error => {
  console.error('[migrate-missing-members] Migration failed', error)
  process.exit(1)
})
