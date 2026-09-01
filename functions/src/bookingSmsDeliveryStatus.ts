import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'

type RecordMap = Record<string, unknown>

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function acceptedCopy(data: RecordMap) {
  const label = text(data.stageLabel, 100) || 'Booking reminder'
  const customer = text(data.customerName, 160) || 'the client'
  const appointmentDate = text(data.appointmentDate, 40) || text(data.bookingDate, 40)
  const appointment = appointmentDate ? ` for ${appointmentDate}` : ''
  return {
    title: `${label} SMS accepted by Hubtel`,
    message: `${label} SMS for ${customer}${appointment} was accepted by Hubtel for processing. Delivery to the customer’s handset has not yet been confirmed.`,
  }
}

/**
 * Legacy booking-SMS automation records provider acceptance as "sent" as soon
 * as Hubtel returns an accepted message ID. That is useful for duplicate
 * protection, but it must not be presented to stores as confirmed handset
 * delivery. Normalize the store-facing notification and matching booking
 * communication-history record to an explicit provider-accepted state.
 *
 * A future Hubtel delivery-report integration can promote these records to
 * `delivered` only when Hubtel reports handset delivery.
 */
export const normalizeBookingSmsDeliveryStatus = functions.firestore
  .document('stores/{storeId}/storeNotifications/{notificationId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null

    const data = change.after.data() as RecordMap
    if (
      text(data.category, 80) !== 'booking_sms' ||
      text(data.source, 120) !== 'booking_sms_automation' ||
      text(data.kind, 80) !== 'sent' ||
      text(data.status, 80) !== 'sent' ||
      data.deliveryConfirmed === true
    ) {
      return null
    }

    const storeId = text(context.params.storeId, 180)
    const notificationId = text(context.params.notificationId, 500)
    const bookingId = text(data.bookingId, 260)
    if (!storeId || !notificationId) return null

    const copy = acceptedCopy(data)
    const now = admin.firestore.FieldValue.serverTimestamp()
    const patch = {
      kind: 'accepted',
      status: 'accepted',
      providerDeliveryStatus: 'accepted',
      deliveryConfirmed: false,
      severity: 'info',
      title: copy.title,
      message: copy.message,
      deliveryNote: 'Hubtel accepted the SMS request. Handset delivery has not been confirmed.',
      updatedAt: now,
    }

    const writes: Promise<unknown>[] = [change.after.ref.set(patch, { merge: true })]

    if (bookingId) {
      const historyRef = defaultDb
        .collection('stores')
        .doc(storeId)
        .collection('integrationBookings')
        .doc(bookingId)
        .collection('communicationHistory')
        .doc(notificationId)
      writes.push(historyRef.set(patch, { merge: true }))
    }

    await Promise.all(writes)
    return null
  })
