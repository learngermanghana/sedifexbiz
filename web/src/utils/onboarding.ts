import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

const STORAGE_PREFIX = 'sedifex.onboarding.status.'

export type OnboardingStatus = 'pending' | 'completed'

function getStorageKey(uid: string) {
  return `${STORAGE_PREFIX}${uid}`
}

function canUseStorage(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return typeof window.localStorage !== 'undefined'
  } catch (error) {
    console.warn('[onboarding] Local storage is not accessible', error)
    return false
  }
}

function getCachedOnboardingStatus(uid: string | null): OnboardingStatus | null {
  if (!uid || !canUseStorage()) {
    return null
  }

  try {
    const value = window.localStorage.getItem(getStorageKey(uid))
    if (value === 'pending' || value === 'completed') {
      return value
    }
    return null
  } catch (error) {
    console.warn('[onboarding] Failed to read onboarding status', error)
    return null
  }
}

function setCachedOnboardingStatus(uid: string | null, status: OnboardingStatus) {
  if (!uid || !canUseStorage()) {
    return
  }

  try {
    window.localStorage.setItem(getStorageKey(uid), status)
  } catch (error) {
    console.warn('[onboarding] Failed to persist onboarding status', error)
  }
}

export async function clearOnboardingStatus(uid: string | null) {
  if (!uid || !canUseStorage()) {
    return
  }

  try {
    window.localStorage.removeItem(getStorageKey(uid))
  } catch (error) {
    console.warn('[onboarding] Failed to clear onboarding status', error)
  }
}

export function getOnboardingStatus(uid: string | null): OnboardingStatus | null {
  return getCachedOnboardingStatus(uid)
}

export async function fetchOnboardingStatus(
  uid: string | null,
): Promise<OnboardingStatus | null> {
  if (!uid) return null

  try {
    const ref = doc(db, 'teamMembers', uid)
    const snapshot = await getDoc(ref)
    const rawValue = snapshot.data()?.onboardingStatus
    if (rawValue === 'pending' || rawValue === 'completed') {
      setCachedOnboardingStatus(uid, rawValue)
      return rawValue
    }
    return getCachedOnboardingStatus(uid)
  } catch (error) {
    console.warn('[onboarding] Failed to read onboarding status from Firestore', error)
    return getCachedOnboardingStatus(uid)
  }
}

export async function setOnboardingStatus(
  uid: string | null,
  status: OnboardingStatus,
) {
  if (!uid) return

  setCachedOnboardingStatus(uid, status)

  try {
    const ref = doc(db, 'teamMembers', uid)
    await setDoc(
      ref,
      {
        onboardingStatus: status,
        onboardingCompletedAt: status === 'completed' ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    )
  } catch (error) {
    console.warn('[onboarding] Failed to persist onboarding status', error)
  }
}

export function hasCompletedOnboarding(uid: string | null): boolean {
  return getCachedOnboardingStatus(uid) === 'completed'
}
