import { onAuthStateChanged, signOut as firebaseSignOut, type User as FirebaseUser } from 'firebase/auth'

import { auth } from '../firebase'

type MaybePromise<T> = T | Promise<T>

type BufferConstructor = {
  from(data: string, encoding: string): { toString(encoding: string): string }
}

export type AuthChangeEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED'

export type SupabaseUser = {
  id: string
  email: string | null
  user_metadata: Record<string, unknown>
  app_metadata: Record<string, unknown>
}

export type SupabaseSession = {
  access_token: string | null
  expires_at: number | null
  refresh_token: string | null
  token_type: 'bearer'
  user: SupabaseUser | null
}

type AuthStateCallback = (event: AuthChangeEvent, session: SupabaseSession | null) => MaybePromise<void>

type Subscription = { unsubscribe(): void }

type AuthStateSubscription = { data: { subscription: Subscription }; error: null }

type GetSessionResult = { data: { session: SupabaseSession | null }; error: null }

type SignOutResult = { error: unknown | null }

type SetSessionResult = {
  data: { session: SupabaseSession | null; user: SupabaseUser | null }
  error: unknown | null
}

let listeners = new Set<AuthStateCallback>()
let unsubscribeAuth: (() => void) | null = null
let lastSession: SupabaseSession | null = null
let lastEvent: AuthChangeEvent = 'INITIAL_SESSION'

function base64Decode(value: string): string | null {
  if (typeof value !== 'string') {
    return null
  }

  if (typeof atob === 'function') {
    return atob(value)
  }

  const globalBuffer = (globalThis as { Buffer?: BufferConstructor }).Buffer
  if (globalBuffer) {
    return globalBuffer.from(value, 'base64').toString('binary')
  }

  return null
}

function decodeJwtExpiry(token: string | null): number | null {
  if (!token) {
    return null
  }

  try {
    const [, payload] = token.split('.')
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    const decoded = base64Decode(padded)
    if (!decoded) {
      return null
    }
    const parsed = JSON.parse(decoded) as { exp?: number | null }
    if (typeof parsed.exp === 'number' && Number.isFinite(parsed.exp)) {
      return parsed.exp
    }
  } catch {
    /* noop */
  }
  return null
}

async function buildSession(user: FirebaseUser | null): Promise<SupabaseSession | null> {
  if (!user) {
    return null
  }

  let accessToken: string | null = null
  try {
    accessToken = await user.getIdToken()
  } catch (error) {
    console.warn('[supabase-auth] Failed to fetch access token from Firebase adapter', error)
  }

  const expiresAt = decodeJwtExpiry(accessToken)

  return {
    access_token: accessToken,
    expires_at: expiresAt,
    refresh_token: null,
    token_type: 'bearer',
    user: {
      id: user.uid,
      email: user.email ?? null,
      user_metadata: {
        full_name: user.displayName ?? null,
        phone_number: user.phoneNumber ?? null,
        provider_data: user.providerData ?? null,
      },
      app_metadata: {},
    },
  }
}

function ensureAuthListener() {
  if (unsubscribeAuth) {
    return
  }

  unsubscribeAuth = onAuthStateChanged(auth, async nextUser => {
    lastSession = await buildSession(nextUser)
    lastEvent = nextUser ? 'SIGNED_IN' : 'SIGNED_OUT'
    for (const listener of listeners) {
      await listener(lastEvent, lastSession)
    }
  })
}

function onAuthStateChange(callback: AuthStateCallback): AuthStateSubscription {
  ensureAuthListener()
  listeners.add(callback)

  void (async () => {
    if (lastEvent === 'INITIAL_SESSION') {
      const currentUser = auth.currentUser
      lastSession = await buildSession(currentUser)
      lastEvent = currentUser ? 'SIGNED_IN' : 'SIGNED_OUT'
    }
    await callback(lastEvent, lastSession)
  })()

  return {
    data: {
      subscription: {
        unsubscribe() {
          listeners.delete(callback)
          if (listeners.size === 0 && unsubscribeAuth) {
            unsubscribeAuth()
            unsubscribeAuth = null
            lastEvent = 'INITIAL_SESSION'
            lastSession = null
          }
        },
      },
    },
    error: null,
  }
}

async function getSession(): Promise<GetSessionResult> {
  const session = await buildSession(auth.currentUser)
  lastSession = session
  lastEvent = session ? 'SIGNED_IN' : 'SIGNED_OUT'
  return { data: { session }, error: null }
}

async function signOut(): Promise<SignOutResult> {
  try {
    await firebaseSignOut(auth)
    return { error: null }
  } catch (error) {
    return { error }
  }
}

async function setSession(): Promise<SetSessionResult> {
  const session = await buildSession(auth.currentUser)
  lastSession = session
  lastEvent = session ? 'SIGNED_IN' : 'SIGNED_OUT'
  return {
    data: { session, user: session?.user ?? null },
    error: null,
  }
}

function startAutoRefresh() {
  return { data: { started: true }, error: null } as const
}

export const supabase = {
  auth: {
    onAuthStateChange,
    getSession,
    signOut,
    setSession,
    startAutoRefresh,
  },
}

export type SupabaseClient = typeof supabase
export type { SupabaseSession as Session, SupabaseUser as User }
