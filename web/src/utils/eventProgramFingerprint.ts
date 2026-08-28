type ProgramFingerprintItem = {
  id: string
  time: string
  title: string
  participant: string
  notes: string
  sortOrder: number
}

function compareCodeUnits(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

export async function fingerprintEventProgram(items: ProgramFingerprintItem[]) {
  const canonical = items
    .map(item => ({
      id: item.id,
      time: item.time.trim(),
      title: item.title.trim(),
      participant: item.participant.trim(),
      notes: item.notes.trim(),
      sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || compareCodeUnits(a.time, b.time) || compareCodeUnits(a.id, b.id))

  const bytes = new TextEncoder().encode(JSON.stringify(canonical))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
