export function extractWorkspaceName(data: any): string | null {
  const candidates = [
    data?.company,
    data?.name,
    data?.companyName,
    data?.storeName,
    data?.businessName,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}
