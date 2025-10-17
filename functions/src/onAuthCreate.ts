import * as functions from 'firebase-functions'
import { admin, defaultDb, rosterDb } from './firestore'

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function normalizeExistingSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function slugCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = slugify(trimmed)
  return normalized || null
}

function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function deriveWorkspaceName(user: functions.auth.UserRecord): string {
  const displayName = typeof user.displayName === 'string' ? user.displayName.trim() : ''
  if (displayName) return displayName

  const email = typeof user.email === 'string' ? user.email.trim() : ''
  if (email) {
    const localPart = email.split('@')[0] ?? ''
    const cleaned = localPart.replace(/[-_.]+/g, ' ').trim()
    if (cleaned) return toTitleCase(cleaned)
  }

  const phone = typeof user.phoneNumber === 'string' ? user.phoneNumber.trim() : ''
  if (phone) return phone

  return 'New Sedifex Workspace'
}

function buildWorkspaceData(
  user: functions.auth.UserRecord,
  timestamp: admin.firestore.FieldValue,
  workspaceName: string,
  slug: string,
  isNew: boolean,
): admin.firestore.DocumentData {
  const data: admin.firestore.DocumentData = {
    slug,
    storeId: user.uid,
    ownerId: user.uid,
    ownerEmail: user.email ?? null,
    ownerPhone: user.phoneNumber ?? null,
    company: workspaceName,
    displayName: workspaceName,
    status: 'active',
    contractStatus: 'active',
    paymentStatus: 'trial',
    updatedAt: timestamp,
  }

  if (isNew) {
    data.createdAt = timestamp
  }

  return data
}

async function ensureWorkspaceForUser(
  user: functions.auth.UserRecord,
  timestamp: admin.firestore.FieldValue,
  preferredSlug: string | null,
): Promise<{ slug: string; created: boolean }> {
  const workspaceName = deriveWorkspaceName(user)
  const candidates: string[] = []

  const pushCandidate = (candidate: string | null) => {
    if (!candidate) return
    if (!candidates.includes(candidate)) {
      candidates.push(candidate)
    }
  }

  const preferredCandidate = preferredSlug ? slugCandidate(preferredSlug) ?? preferredSlug : null
  pushCandidate(preferredCandidate)

  const displayNameSlug = slugCandidate(user.displayName ?? null)
  const emailSlug = slugCandidate(
    typeof user.email === 'string' ? user.email.split('@')[0] ?? '' : null,
  )
  const phoneSlug = slugCandidate(user.phoneNumber ?? null)
  const uidSlug = slugCandidate(user.uid)

  pushCandidate(displayNameSlug)
  pushCandidate(emailSlug)
  pushCandidate(phoneSlug)
  pushCandidate(uidSlug)

  const workspaceCollection = defaultDb.collection('workspaces')
  const preferredMatches = new Set<string>()
  if (preferredCandidate) {
    preferredMatches.add(preferredCandidate)
  }

  for (const candidate of candidates) {
    const docRef = workspaceCollection.doc(candidate)
    const snapshot = await docRef.get()
    const isPreferred = preferredMatches.has(candidate)
    if (snapshot.exists && !isPreferred) {
      continue
    }

    const data = buildWorkspaceData(user, timestamp, workspaceName, candidate, !snapshot.exists)
    await docRef.set(data, { merge: true })
    return { slug: candidate, created: !snapshot.exists }
  }

  const fallbackBase = displayNameSlug ?? emailSlug ?? phoneSlug ?? uidSlug ?? 'workspace'

  if (!candidates.includes(fallbackBase)) {
    const baseRef = workspaceCollection.doc(fallbackBase)
    const baseSnapshot = await baseRef.get()
    if (!baseSnapshot.exists) {
      const data = buildWorkspaceData(user, timestamp, workspaceName, fallbackBase, true)
      await baseRef.set(data, { merge: true })
      return { slug: fallbackBase, created: true }
    }
  }

  let suffix = 2

  while (true) {
    const candidate = `${fallbackBase}-${suffix}`
    const docRef = workspaceCollection.doc(candidate)
    const snapshot = await docRef.get()
    if (snapshot.exists) {
      suffix += 1
      continue
    }

    const data = buildWorkspaceData(user, timestamp, workspaceName, candidate, true)
    await docRef.set(data, { merge: true })
    return { slug: candidate, created: true }
  }
}

export const onAuthCreate = functions.auth.user().onCreate(async (user) => {
  const uid = user.uid
  const now = admin.firestore.FieldValue.serverTimestamp()

  const rosterTeamMemberRef = rosterDb.collection('teamMembers').doc(uid)
  const defaultTeamMemberRef = defaultDb.collection('teamMembers').doc(uid)
  const storeRef = defaultDb.collection('stores').doc(uid)
  const [rosterTeamMemberSnap, defaultTeamMemberSnap, storeSnap] = await Promise.all([
    rosterTeamMemberRef.get(),
    defaultTeamMemberRef.get(),
    storeRef.get(),
  ])

  const teamMemberSnap = rosterTeamMemberSnap.exists ? rosterTeamMemberSnap : defaultTeamMemberSnap

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
    rosterTeamMemberRef.set(teamMemberData, { merge: true }),
    defaultTeamMemberRef.set(teamMemberData, { merge: true }),
    storeRef.set(storeData, { merge: true }),
  ])
})
