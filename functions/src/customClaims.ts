import { admin } from './firebaseAdmin'
import { getPersistence } from './persistence'

export type RoleClaimPayload = {
  uid: string
  role: string
  storeId: string
}

function normalizeCompany(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function resolveCompanyName(uid: string, storeId: string): Promise<string | null> {
  try {
    const adapter = getPersistence()
    const member = await adapter.getTeamMember(uid)
    const store = storeId ? await adapter.getStore(storeId) : null
    const memberCompany = normalizeCompany(member?.company)
    const storeCompany = normalizeCompany(store?.company)
    return storeCompany ?? memberCompany ?? null
  } catch (error) {
    console.warn('[customClaims] Failed to resolve company name for claims', { uid, storeId, error })
    return null
  }
}

export async function applyRoleClaims({ uid, role, storeId }: RoleClaimPayload) {
  const userRecord = await admin
    .auth()
    .getUser(uid)
    .catch(() => null)
  const existingClaims = (userRecord?.customClaims ?? {}) as Record<string, unknown>
  const nextClaims: Record<string, unknown> = { ...existingClaims }

  nextClaims.role = role
  nextClaims.activeStoreId = storeId

  const companyName = await resolveCompanyName(uid, storeId)
  if (companyName) {
    nextClaims.company = companyName
  } else {
    delete nextClaims.company
  }

  delete nextClaims.stores
  delete nextClaims.storeId
  delete nextClaims.roleByStore

  await admin.auth().setCustomUserClaims(uid, nextClaims)
  return nextClaims
}
