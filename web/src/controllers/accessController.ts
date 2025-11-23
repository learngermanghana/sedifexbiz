import type { User } from 'firebase/auth'

export type SignupRoleOption = 'owner' | 'team-member'

export type ResolveStoreAccessResult = {
  ok: boolean
  storeId: string
  workspaceSlug: string
  role: string
  claims?: Record<string, unknown>
}

export const INACTIVE_WORKSPACE_MESSAGE =
  'We could not confirm the store ID assigned to your Sedifex workspace. Reach out to your Sedifex administrator.'

export function extractCallableErrorMessage(error: unknown): string | null {
  if (!error) return null
  if (typeof error === 'string') return error.trim() || null
  if (error instanceof Error) return error.message.trim() || null

  if (typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
    const value = (error as { message?: unknown }).message
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  return null
}

export async function initializeStore(
  _payload: {
    phone: string | null
    firstSignupEmail: string | null
    ownerName: string | null
    businessName: string | null
    country: string | null
    town: string | null
    signupRole: SignupRoleOption
  },
  storeId?: string | null,
): Promise<{ storeId: string; claims?: Record<string, unknown> }> {
  const resolvedStoreId = storeId ?? 'default-store'
  return { storeId: resolvedStoreId, claims: {} }
}

export async function resolveStoreAccess(
  storeId?: string,
): Promise<ResolveStoreAccessResult> {
  const resolvedStoreId = storeId ?? 'default-store'
  return {
    ok: true,
    storeId: resolvedStoreId,
    workspaceSlug: resolvedStoreId,
    role: 'owner',
    claims: {},
  }
}

export async function afterSignupBootstrap(_user: User): Promise<void> {
  // Placeholder for future bootstrap logic.
}
