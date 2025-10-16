// web/src/utils/normalizeStaffRole.ts
export type NormalizedStaffRole = 'owner' | 'staff'

export function normalizeStaffRole(role: unknown): NormalizedStaffRole {
  if (typeof role === 'string') {
    const normalized = role.trim().toLowerCase()
    if (normalized === 'owner') {
      return 'owner'
    }
  }

  return 'staff'
}
