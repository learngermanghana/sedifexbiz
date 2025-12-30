export function normalizeBarcode(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return ''
  // keep only digits – removes spaces like "8 710447 180655"
  return String(value).replace(/[^\d]/g, '')
}

export function formatBarcodeForDisplay(
  value: string | null | undefined,
): string {
  const code = normalizeBarcode(value)
  if (!code) return ''
  // you can get fancy here later (grouping), for now just return digits
  return code
}
