type PlainRecord = Record<string, unknown>

const PAID_STATUSES = new Set([
  'paid',
  'confirmed',
  'success',
  'succeeded',
  'complete',
  'completed',
  'captured',
])

function asRecord(value: unknown): PlainRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as PlainRecord
    : {}
}

function normalizeStatus(value: unknown) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : ''
}

export function isPaidIntegrationOrder(data: PlainRecord) {
  const payment = asRecord(data.payment)
  const status = normalizeStatus(
    data.paymentStatus
      ?? data.payment_status
      ?? payment.paymentStatus
      ?? payment.payment_status
      ?? payment.status,
  )

  return data.paymentConfirmed === true
    || data.payment_confirmed === true
    || payment.confirmed === true
    || PAID_STATUSES.has(status)
}
