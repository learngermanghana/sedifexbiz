import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { Session, SupabaseClient, User } from '../supabaseClient'

const SESSION_COOKIE = 'sedifex_session'
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90 // 90 days
const MIN_SESSION_MAX_AGE_SECONDS = 60 // 1 minute grace period

export async function configureAuthPersistence(client: SupabaseClient) {
  try {
    client.auth.startAutoRefresh()
  } catch (error) {
    console.warn('[auth] Failed to start Supabase auto refresh', error)
  }

  try {
    const { data, error } = await client.auth.getSession()
    if (error) {
      throw error
    }

    const session = data.session
    const accessToken = session?.access_token
    const refreshToken = session?.refresh_token

    if (accessToken && refreshToken) {
      await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
    }
  } catch (error) {
    console.warn('[auth] Failed to synchronise Supabase session state', error)
  }
}

export async function persistSession(session: Session) {
  const sessionId = ensureSessionCookie(session)
  const user = session.user
  if (!sessionId || !user) {
    return
  }

  try {
    await setDoc(
      doc(db, 'sessions', sessionId),
      {
        uid: user.id,
        email: user.email ?? null,
        displayName: readUserDisplayName(user),
        lastLoginAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        sessionFingerprint: sessionId,
      },
      { merge: true },
    )
  } catch (error) {
    console.warn('[session] Failed to persist session metadata', error)
  }
}

export async function refreshSessionHeartbeat(session: Session) {
  const sessionId = ensureSessionCookie(session)
  const user = session.user
  if (!sessionId || !user) {
    return
  }

  try {
    await updateDoc(doc(db, 'sessions', sessionId), {
      uid: user.id,
      lastActiveAt: serverTimestamp(),
      sessionFingerprint: sessionId,
    })
  } catch (error) {
    console.warn('[session] Failed to refresh session metadata', error)
    await persistSession(session)
  }
}

function readUserDisplayName(user: User | null): string | null {
  if (!user) {
    return null
  }

  const metadataName = user.user_metadata?.['full_name']
  if (typeof metadataName === 'string' && metadataName.trim()) {
    return metadataName.trim()
  }

  return null
}

function ensureSessionCookie(session: Session): string | null {
  const fingerprint = createSessionFingerprint(session)
  if (!fingerprint) {
    return null
  }

  setSessionCookie(fingerprint, session)
  return fingerprint
}

function setSessionCookie(value: string, session: Session) {
  if (typeof document === 'undefined') {
    return
  }
  const isSecureContext =
    typeof window !== 'undefined' && window.location?.protocol === 'https:'
  const secureAttribute = isSecureContext ? '; Secure' : ''
  const maxAge = computeSessionMaxAge(session)
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secureAttribute}`
}

function createSessionFingerprint(session: Session): string | null {
  const userId = session.user?.id
  if (!userId) {
    return null
  }

  const expiresAt = typeof session.expires_at === 'number' ? session.expires_at : null
  const tokenHash = session.access_token ? session.access_token.slice(-12) : 'anon'
  return `${userId}:${expiresAt ?? 'persistent'}:${tokenHash}`
}

function computeSessionMaxAge(session: Session): number {
  if (typeof session.expires_at === 'number') {
    const currentSeconds = Math.floor(Date.now() / 1000)
    const diff = session.expires_at - currentSeconds
    if (Number.isFinite(diff) && diff > 0) {
      return Math.max(MIN_SESSION_MAX_AGE_SECONDS, Math.min(diff, SESSION_MAX_AGE_SECONDS))
    }
  }
  return SESSION_MAX_AGE_SECONDS
}
