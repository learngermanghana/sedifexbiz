export function normalizeBarcode(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  const hasLetters = /[a-z]/i.test(raw)
  if (hasLetters) {
    // keep letters + digits; remove spaces/hyphens so Code 39/128 match
    return raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  }
  // keep only digits – removes spaces like "8 710447 180655"
  return raw.replace(/[^\d]/g, '')
}

export function formatBarcodeForDisplay(
  value: string | null | undefined,
): string {
  const code = normalizeBarcode(value)
  if (!code) return ''
  // you can get fancy here later (grouping), for now just return digits
  return code
}
