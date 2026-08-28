type ProgramFingerprintItem = {
  id: string
  time: string
  title: string
  participant: string
  notes: string
  sortOrder: number
}

export async function fingerprintEventProgram(items: ProgramFingerprintItem[]) {
  const canonical = [...items]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.time.localeCompare(b.time) || a.id.localeCompare(b.id))
    .map(item => ({
      id: item.id,
      time: item.time.trim(),
      title: item.title.trim(),
      participant: item.participant.trim(),
      notes: item.notes.trim(),
      sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : 0,
    }))

  const bytes = new TextEncoder().encode(JSON.stringify(canonical))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
