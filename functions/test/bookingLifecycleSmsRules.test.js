const assert = require('node:assert/strict')
const {
  bookingLifecycleEventId,
  deriveBookingLifecycleSmsEvents,
} = require('../lib/bookingLifecycleSmsRules')

function booking(overrides = {}) {
  return {
    bookingStatus: 'pending',
    bookingDate: '2026-09-10',
    bookingTime: '14:00',
    customerPhone: '0200000000',
    ...overrides,
  }
}

assert.deepEqual(
  deriveBookingLifecycleSmsEvents({}, booking()),
  [{ stage: 'booking_received', eventKey: 'received' }],
  'new pending bookings should send booking received',
)

assert.deepEqual(
  deriveBookingLifecycleSmsEvents({}, booking({ bookingStatus: 'confirmed' })),
  [{ stage: 'booking_confirmed', eventKey: 'confirmed-2026-09-10-14-00' }],
  'new already-confirmed bookings should send one confirmation instead of received + confirmed',
)

assert.deepEqual(
  deriveBookingLifecycleSmsEvents(booking(), booking({ bookingStatus: 'confirmed' })),
  [{ stage: 'booking_confirmed', eventKey: 'confirmed-2026-09-10-14-00' }],
  'approval should send booking confirmation',
)

assert.deepEqual(
  deriveBookingLifecycleSmsEvents(
    booking({ bookingStatus: 'confirmed' }),
    booking({ bookingStatus: 'confirmed', bookingTime: '15:30' }),
  ),
  [{ stage: 'booking_rescheduled', eventKey: 'rescheduled-2026-09-10-15-30' }],
  'changing a confirmed booking schedule should send reschedule SMS',
)

assert.deepEqual(
  deriveBookingLifecycleSmsEvents(
    booking(),
    booking({ bookingStatus: 'rescheduled', bookingDate: '2026-09-11' }),
  ),
  [{ stage: 'booking_rescheduled', eventKey: 'rescheduled-2026-09-11-14-00' }],
  'explicit rescheduled status should send reschedule SMS',
)

assert.deepEqual(
  deriveBookingLifecycleSmsEvents(
    booking({ bookingStatus: 'confirmed' }),
    booking({ bookingStatus: 'cancelled', bookingTime: '16:00' }),
  ),
  [{ stage: 'booking_cancelled', eventKey: 'cancelled-2026-09-10-16-00' }],
  'cancellation should win over a simultaneous schedule change',
)

assert.deepEqual(
  deriveBookingLifecycleSmsEvents(booking(), booking({ notes: 'internal note only' })),
  [],
  'non-status/non-schedule edits must not create SMS events',
)

assert.equal(
  bookingLifecycleEventId('booking_rescheduled', 'rescheduled-2026-09-10-15-30'),
  'booking_rescheduled-rescheduled-2026-09-10-15-30',
  'event IDs should be deterministic for duplicate prevention',
)

console.log('booking lifecycle SMS rules tests passed')
