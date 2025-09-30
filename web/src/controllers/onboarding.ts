// web/src/controllers/onboarding.ts
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { persistActiveStoreIdForUser } from '../utils/activeStoreStorage'

const MAX_BASE_SLUG_LENGTH = 32
const UID_SUFFIX_LENGTH = 8
const MAX_COLLISION_ATTEMPTS = 10

function slugify(value: string | null | undefined): string {
  if (!value) {
    return ''
  }

  const normalized = value
    .normalize('NFKD')
    .replace(/[^\w\s@.-]/g, '')
    .replace(/[\u0300-\u036f]/g, '')
  const lower = normalized.toLowerCase()
  const withHyphen = lower.replace(/[^a-z0-9]+/g, '-')
  const trimmed = withHyphen.replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
  if (trimmed.length <= MAX_BASE_SLUG_LENGTH) {
    return trimmed
  }
  return trimmed.slice(0, MAX_BASE_SLUG_LENGTH).replace(/^-+|-+$/g, '')
}

function resolveBaseSlug(company?: string | null, email?: string | null): string {
  const companySlug = slugify(company)
  if (companySlug) {
    return companySlug
  }
  const emailSlug = slugify(email)
  if (emailSlug) {
    return emailSlug
  }
  return 'store'
}

function buildUidSuffix(uid: string): string {
  const uidSlug = slugify(uid)
  if (!uidSlug) {
    return 'owner'
  }
  const trimmed = uidSlug.replace(/^-+|-+$/g, '')
  const slice = trimmed.slice(0, UID_SUFFIX_LENGTH)
  return slice || trimmed || 'owner'
}

function hashUid(uid: string): string {
  let hash = 0
  for (let index = 0; index < uid.length; index += 1) {
    hash = (hash * 31 + uid.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

function buildCandidate(baseSlug: string, uidSuffix: string, attempt: number): string {
  if (attempt === 0) {
    return `${baseSlug}-${uidSuffix}`
  }
  return `${baseSlug}-${uidSuffix}-${attempt + 1}`
}

function persistAndReturn(uid: string, storeId: string): string {
  persistActiveStoreIdForUser(uid, storeId)
  return storeId
}

export async function generateUniqueStoreId(params: {
  uid: string
  company?: string | null
  email?: string | null
}): Promise<string> {
  const { uid, company = null, email = null } = params
  const baseSlug = resolveBaseSlug(company, email) || 'store'
  const uidSuffix = buildUidSuffix(uid)
  const uidHash = hashUid(uid)

  for (let attempt = 0; attempt <= MAX_COLLISION_ATTEMPTS; attempt += 1) {
    const candidate = buildCandidate(baseSlug, uidSuffix, attempt)
    try {
      const snapshot = await getDoc(doc(db, 'stores', candidate))
      if (!snapshot.exists()) {
        return persistAndReturn(uid, candidate)
      }
      const ownerId = snapshot.get('ownerId')
      if (typeof ownerId === 'string' && ownerId === uid) {
        return persistAndReturn(uid, candidate)
      }
    } catch (error) {
      console.warn(`[onboarding] Failed to inspect storeId "${candidate}"`, error)
      return persistAndReturn(uid, candidate)
    }
  }

  const hashedSuffix = uidHash.slice(0, Math.max(UID_SUFFIX_LENGTH, 4)) || uidSuffix
  const fallbackCandidate = `${baseSlug}-${uidSuffix}-${hashedSuffix}`
  try {
    const snapshot = await getDoc(doc(db, 'stores', fallbackCandidate))
    if (!snapshot.exists()) {
      return persistAndReturn(uid, fallbackCandidate)
    }
    const ownerId = snapshot.get('ownerId')
    if (typeof ownerId === 'string' && ownerId === uid) {
      return persistAndReturn(uid, fallbackCandidate)
    }
  } catch (error) {
    console.warn(`[onboarding] Failed to inspect storeId "${fallbackCandidate}"`, error)
    return persistAndReturn(uid, fallbackCandidate)
  }

  const ultimateCandidate = `${fallbackCandidate}-${hashUid(`${uid}-${fallbackCandidate}`)}`
  return persistAndReturn(uid, ultimateCandidate)
}
