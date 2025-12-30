function getOptionalEnv(key: string): string | null {
  const value = import.meta.env[key]
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export { getOptionalEnv }
