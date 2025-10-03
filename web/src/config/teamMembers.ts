const rawOverride =
  import.meta.env?.VITE_OVERRIDE_TEAM_MEMBER_ID ??
  import.meta.env?.VITE_OVERRIDE_TEAM_MEMBER_DOC_ID

function normalizeOverride(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : ''
}

export const OVERRIDE_TEAM_MEMBER_ID = normalizeOverride(rawOverride)

export type TeamMemberOverrideId = typeof OVERRIDE_TEAM_MEMBER_ID

export const OVERRIDE_TEAM_MEMBER_DOC_ID = OVERRIDE_TEAM_MEMBER_ID
export type TeamMemberOverrideDocId = TeamMemberOverrideId
