const AFRICAN_COUNTRY_CODES = [
  '233',
  '234',
  '225',
  '221',
  '237',
  '254',
  '255',
  '256',
  '250',
  '251',
  '260',
  '263',
  '27',
  '20',
  '212',
  '213',
  '216',
]

const DEFAULT_AFRICAN_COUNTRY_CODE = '233'

export function normalizeGhanaPhoneDigits(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''

  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''

  if (digits.startsWith('00')) {
    digits = digits.replace(/^00+/, '')
  }

  if (digits.startsWith('2330')) {
    digits = `233${digits.slice(4)}`
  }

  if (digits.startsWith('233')) {
    return digits
  }

  if (digits.startsWith('0')) {
    return `233${digits.slice(1)}`
  }

  if (digits.length === 9) {
    return `233${digits}`
  }

  return digits
}

export function normalizePhoneE164(
  input: string,
  options?: { defaultCountryCode?: string },
): string {
  const trimmed = input.trim()
  if (!trimmed) return ''

  const withoutWhatsApp = trimmed.startsWith('whatsapp:')
    ? trimmed.slice('whatsapp:'.length).trim()
    : trimmed

  if (!withoutWhatsApp) return ''

  const defaultCountryCode = options?.defaultCountryCode ?? DEFAULT_AFRICAN_COUNTRY_CODE
  const rawDigits = withoutWhatsApp.replace(/\D/g, '')

  if (!rawDigits) return ''

  // Ghana numbers are normalized to country-code digits in one step. Returning
  // immediately prevents a local 0XX number from receiving the 233 prefix twice.
  if (defaultCountryCode === '233') {
    const ghanaDigits = normalizeGhanaPhoneDigits(rawDigits)
    return ghanaDigits ? `+${ghanaDigits}` : ''
  }

  const hasPlus = withoutWhatsApp.startsWith('+')
  const digits = rawDigits

  if (hasPlus) {
    return `+${digits}`
  }

  if (withoutWhatsApp.startsWith('00')) {
    return `+${digits.replace(/^00/, '')}`
  }

  if (withoutWhatsApp.startsWith('0')) {
    const rest = digits.replace(/^0/, '')
    return `+${defaultCountryCode}${rest}`
  }

  const matchesAfricanCode = AFRICAN_COUNTRY_CODES.some(code =>
    digits.startsWith(code),
  )
  if (matchesAfricanCode) {
    return `+${digits}`
  }

  return `+${digits}`
}

export function normalizePhoneForWhatsApp(input: string): string {
  const e164 = normalizePhoneE164(input)
  return e164.replace(/^\+/, '')
}
