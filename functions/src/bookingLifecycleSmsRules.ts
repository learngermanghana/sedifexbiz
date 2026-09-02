export type LifecycleSmsStage =
  | 'booking_received'
  | 'booking_confirmed'
  | 'booking_rescheduled'
  | 'booking_cancelled'

export type LifecycleSmsEvent = {
  stage: LifecycleSmsStage
  eventKey: string
}

type RecordMap = Record<string, unknown>

export const LIFECYCLE_SMS_STAGES: LifecycleSmsStage[] = [
  'booking_received',
  'booking_confirmed',
  'booking_rescheduled',
  'booking_cancelled',
]

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function first(values: unknown[], max = 500) {
  for (const value of values) {
    const candidate = text(value, max)
    if (candidate) return candidate
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

export function normalizeBookingStatus(value: unknown, fallback = 'pending') {
  return text(value, 100).toLowerCase().replace(/[\s-]+/g, '_') || fallback
}

export function bookingLifecycleStatus(data: RecordMap) {
  const booking = record(data.booking)
  return normalizeBookingStatus(data.bookingStatus ?? data.booking_status ?? data.status ?? booking.status)
}

export function bookingLifecycleDate(data: RecordMap) {
  const booking = record(data.booking)
  return first([data.bookingDate, data.booking_date, data.date, booking.preferredDate, booking.preferred_date, booking.date], 40)
}

export function bookingLifecycleTime(data: RecordMap) {
  const booking = record(data.booking)
  return first([data.bookingTime, data.booking_time, data.time, booking.preferredTime, booking.preferred_time, booking.time], 40)
}

export function bookingLifecycleScheduleKey(data: RecordMap) {
  const raw = `${bookingLifecycleDate(data)}-${bookingLifecycleTime(data)}`
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'unscheduled'
}

export function bookingLifecycleEventId(stage: LifecycleSmsStage, eventKey: string) {
  const safe = `${stage}-${eventKey}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe.slice(0, 220)
}

export function deriveBookingLifecycleSmsEvents(before: RecordMap, after: RecordMap): LifecycleSmsEvent[] {
  const events: LifecycleSmsEvent[] = []
  const isCreate = Object.keys(before).length === 0
  const beforeStatus = bookingLifecycleStatus(before)
  const afterStatus = bookingLifecycleStatus(after)
  const beforeSchedule = bookingLifecycleScheduleKey(before)
  const afterSchedule = bookingLifecycleScheduleKey(after)
  const cancelled = afterStatus === 'cancelled' || afterStatus === 'canceled'
  const completed = afterStatus === 'completed'

  if (isCreate) {
    if (afterStatus === 'confirmed') {
      events.push({ stage: 'booking_confirmed', eventKey: `confirmed-${afterSchedule}` })
    } else if (!cancelled && !completed) {
      events.push({ stage: 'booking_received', eventKey: 'received' })
    }
    return events
  }

  if (afterStatus === 'confirmed' && beforeStatus !== 'confirmed') {
    events.push({ stage: 'booking_confirmed', eventKey: `confirmed-${afterSchedule}` })
  }

  const explicitReschedule = afterStatus === 'rescheduled' && beforeStatus !== 'rescheduled'
  const scheduleChanged = beforeSchedule !== afterSchedule
  if (!cancelled && !completed && (explicitReschedule || (scheduleChanged && beforeStatus === afterStatus))) {
    events.push({ stage: 'booking_rescheduled', eventKey: `rescheduled-${afterSchedule}` })
  }

  if (cancelled && beforeStatus !== 'cancelled' && beforeStatus !== 'canceled') {
    events.push({ stage: 'booking_cancelled', eventKey: `cancelled-${afterSchedule}` })
  }

  return events
}
