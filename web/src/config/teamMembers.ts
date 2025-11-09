import runtimeEnv from './runtimeEnv'

const rawOverride = runtimeEnv.VITE_OVERRIDE_TEAM_MEMBER_DOC_ID

function normalizeOverride(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : ''
}

export const OVERRIDE_TEAM_MEMBER_DOC_ID = normalizeOverride(rawOverride)

export type TeamMemberOverrideDocId = typeof OVERRIDE_TEAM_MEMBER_DOC_ID
