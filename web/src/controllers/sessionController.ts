// web/src/controllers/sessionController.ts
import {
  Auth,
  User,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  setPersistence,
} from 'firebase/auth'
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db, rosterDb } from '../firebase'

const SESSION_COOKIE = 'sedifex_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90 // 90 days

/**
 * Prefer durable auth; gracefully degrade if the browser disallows it.
 */
export async function configureAuthPersistence(auth: Auth) {
  try {
    await setPersistence(auth, browserLocalPersistence)
    return
  } catch (error) {
    console.warn('[auth] Falling back from local persistence', error)
  }

  try {
    await setPersistence(auth, browserSessionPersistence)
  } catch (error) {
    console.warn('[auth] Falling back to in-memory persistence', error)
    await setPersistence(auth, inMemoryPersistence)
  }
}

type WorkspaceMetadata = {
  storeId?: string
  role?: 'owner' | 'staff'
}

/**
 * Records/updates a lightweight session document for analytics & support.
 */
export async function persistSession(user: User, workspace?: WorkspaceMetadata) {
  const sessionId = ensureSessionId()
  try {
    await setDoc(
      doc(db, 'sessions', sessionId),
      {
        uid: user.uid,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        lastLoginAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        storeId: workspace?.storeId ?? null,
        role: workspace?.role ?? null,
      },
      { merge: true },
    )
  } catch (error) {
    console.warn('[session] Failed to persist session metadata', error)
  }
}

type StoreInventorySummary = {
  trackedSkus: number
  lowStockSkus: number
  incomingShipments: number
}

const DEFAULT_INVENTORY_SUMMARY: StoreInventorySummary = {
  trackedSkus: 0,
  lowStockSkus: 0,
  incomingShipments: 0,
}

/**
 * Ensures a store doc exists and matches the schema that access checks expect.
 * This is a safety net if the auth trigger hasn't run yet.
 */
export async function ensureStoreDocument(user: User) {
  try {
    await setDoc(
      doc(db, 'stores', user.uid),
      {
        // Access-related fields
        storeId: user.uid,                // stable ID used by access resolution
        ownerUid: user.uid,               // link back to the creator/owner
        paymentStatus: 'trial',           // 'trial' | 'active' | 'suspended'
        contractStart: serverTimestamp(), // good default
        contractEnd: null,                // set later if you time-box trials

        // Inventory snapshot
        inventorySummary: { ...DEFAULT_INVENTORY_SUMMARY },

        // Back-compat (optional): keep legacy aliases if older code references them
        ownerId: user.uid,
        status: 'active',

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
  } catch (error) {
    console.warn('[store] Failed to ensure store metadata for user', user.uid, error)
  }
}

type TeamMemberMetadata = {
  storeId?: string
  role?: 'owner' | 'staff'
}

/**
 * Seeds/repairs the roster entry in the secondary "roster" DB.
 * Also creates an email-key alias doc when available for flexible lookups.
 */
export async function ensureTeamMemberDocument(user: User, metadata?: TeamMemberMetadata) {
  const storeId = metadata?.storeId ?? user.uid
  const role = metadata?.role ?? 'owner'
  const email = user.email ? user.email.toLowerCase() : null

  const payload = {
    uid: user.uid,
    storeId,
    role,
    email,
    phone: user.phoneNumber ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  try {
    // uid-keyed doc
    await setDoc(doc(rosterDb, 'teamMembers', user.uid), payload, { merge: true })

    // email-keyed alias (optional but useful)
    if (email) {
      await setDoc(doc(rosterDb, 'teamMembers', email), payload, { merge: true })
    }
  } catch (error) {
    console.warn('[team] Failed to ensure team member metadata for user', user.uid, error)
  }
}

/**
 * Heartbeat updater; if a session doc is missing, re-create it.
 */
export async function refreshSessionHeartbeat(user: User) {
  const sessionId = getSessionId()
  if (!sessionId) return

  try {
    await updateDoc(doc(db, 'sessions', sessionId), {
      uid: user.uid,
      lastActiveAt: serverTimestamp(),
    })
  } catch (error) {
    console.warn('[session] Failed to refresh session metadata', error)
    await persistSession(user)
  }
}

// ----------------- cookie helpers -----------------

function ensureSessionId() {
  const existing = getSessionId()
  if (existing) return existing
  const generated = generateSessionId()
  setSessionCookie(generated)
  return generated
}

function getSessionId() {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function setSessionCookie(value: string) {
  if (typeof document === 'undefined') return
  const isSecureContext =
    typeof window !== 'undefined' &&
    typeof window.location !== 'undefined' &&
    window.location.protocol === 'https:'
  const secureAttribute = isSecureContext ? '; Secure' : ''
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(
    value,
  )}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secureAttribute}`
}

function generateSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}
