from pathlib import Path

self_service_path = Path('functions/src/customerPortalSelfService.ts')
text = self_service_path.read_text()

# Carry the canonical customer id with the request so older bookings that were
# matched by email/phone still resolve to the right CRM record at review time.
text = text.replace(
"""type PortalRequest = {
  id: string
  type: RequestType
""",
"""type PortalRequest = {
  id: string
  customerId?: string | null
  type: RequestType
""",
1,
)

text = text.replace(
"""import { deliverTransactionalEmail } from './emailDelivery'
""",
"""import { deliverTransactionalEmail } from './emailDelivery'
import { queueBookingPortalDecisionEmail } from './bookingEmailAutomation'
""",
1,
)

text = text.replace(
"""  const request: PortalRequest = {
    id: `cpr_${Date.now()}_${randomBytes(6).toString('hex')}`,
    type: action,
""",
"""  const request: PortalRequest = {
    id: `cpr_${Date.now()}_${randomBytes(6).toString('hex')}`,
    customerId: loaded.link.customerId,
    type: action,
""",
1,
)

old_submit_mirror = """    if (root.exists) {
      await rootRef.set({
        customerPortalRequest: request,
        customerPortalRequestStatus: 'pending',
        customerPortalRequestUpdatedAt: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    }
"""
new_submit_mirror = """    if (root.exists) {
      const rootData = root.data() as RecordMap
      const rootStoreId = firstText(rootData, ['storeId', 'store_id', 'merchantId'], 180)
      if (rootStoreId === loaded.link.storeId) {
        await rootRef.set({
          customerPortalRequest: request,
          customerPortalRequestStatus: 'pending',
          customerPortalRequestUpdatedAt: now,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true })
      } else {
        functions.logger.warn('Skipped customer portal root mirror because store ownership did not match', {
          bookingId: loaded.bookingId,
          expectedStoreId: loaded.link.storeId,
          rootStoreId: rootStoreId || null,
        })
      }
    }
"""
if old_submit_mirror not in text:
    raise SystemExit('submit root mirror marker missing')
text = text.replace(old_submit_mirror, new_submit_mirror, 1)

text = text.replace(
"""    const customerId = explicitBookingCustomerId(booking)
    const nextStatus: RequestStatus = decision === 'approve' ? 'approved' : 'rejected'
    const reviewedRequest: PortalRequest = {
      id: text(requestData.id, 220),
      type: requestType,
""",
"""    const customerId = text(requestData.customerId, 220) || explicitBookingCustomerId(booking)
    const nextStatus: RequestStatus = decision === 'approve' ? 'approved' : 'rejected'
    const reviewedRequest: PortalRequest = {
      id: text(requestData.id, 220),
      customerId: customerId || null,
      type: requestType,
""",
1,
)

old_update_start = """    const update: Record<string, unknown> = {
      customerPortalRequest: reviewedRequest,
      customerPortalRequestStatus: nextStatus,
      customerPortalRequestUpdatedAt: reviewedAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }
    if (decision === 'approve' && requestType === 'reschedule') {
"""
new_update_start = """    const oldSlotId = firstText(booking, ['slotId', 'slot_id'], 220)
    const quantity = Math.max(1, Math.floor(numberValue(booking.quantity) ?? 1))
    if (decision === 'approve' && oldSlotId && (requestType === 'reschedule' || requestType === 'cancel')) {
      const slotRef = defaultDb.collection('stores').doc(storeId).collection('integrationAvailabilitySlots').doc(oldSlotId)
      const slotSnapshot = await transaction.get(slotRef)
      if (slotSnapshot.exists) {
        const slotData = slotSnapshot.data() as RecordMap
        const seatsBooked = Math.max(0, Math.floor(numberValue(slotData.seatsBooked) ?? 0))
        transaction.update(slotRef, {
          seatsBooked: Math.max(0, seatsBooked - quantity),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      } else {
        functions.logger.warn('Customer portal review could not find the booking availability slot to release', {
          storeId,
          bookingId,
          slotId: oldSlotId,
        })
      }
    }

    const update: Record<string, unknown> = {
      customerPortalRequest: reviewedRequest,
      customerPortalRequestStatus: nextStatus,
      customerPortalRequestUpdatedAt: reviewedAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }
    if (decision === 'approve' && requestType === 'reschedule') {
"""
if old_update_start not in text:
    raise SystemExit('review update marker missing')
text = text.replace(old_update_start, new_update_start, 1)

old_reschedule_assign = """      Object.assign(update, {
        bookingDate: nextDate,
        date: nextDate,
        bookingTime: nextTime,
        time: nextTime,
        booking: {
          ...record(booking.booking),
          preferredDate: nextDate,
          preferredTime: nextTime,
        },
        syncStatus: 'pending',
        syncReason: 'booking_rescheduled',
        syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
"""
new_reschedule_assign = """      Object.assign(update, {
        bookingDate: nextDate,
        date: nextDate,
        bookingTime: nextTime,
        time: nextTime,
        slotId: null,
        slot_id: null,
        ...(oldSlotId ? { previousSlotId: oldSlotId, availabilitySlotReleasedAt: reviewedAt } : {}),
        booking: {
          ...record(booking.booking),
          preferredDate: nextDate,
          preferredTime: nextTime,
        },
        syncStatus: 'pending',
        syncReason: 'booking_rescheduled',
        syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
"""
if old_reschedule_assign not in text:
    raise SystemExit('reschedule assignment marker missing')
text = text.replace(old_reschedule_assign, new_reschedule_assign, 1)

old_cancel_assign = """      Object.assign(update, {
        bookingStatus: 'cancelled',
        booking_status: 'cancelled',
        status: 'cancelled',
        booking: {
          ...record(booking.booking),
          status: 'cancelled',
          bookingStatus: 'cancelled',
          booking_status: 'cancelled',
        },
        cancelledAt: reviewedAt,
        syncStatus: 'pending',
        syncReason: 'booking_cancelled',
        syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
"""
new_cancel_assign = """      Object.assign(update, {
        bookingStatus: 'cancelled',
        booking_status: 'cancelled',
        status: 'cancelled',
        slotId: null,
        slot_id: null,
        ...(oldSlotId ? { previousSlotId: oldSlotId, availabilitySlotReleasedAt: reviewedAt } : {}),
        booking: {
          ...record(booking.booking),
          status: 'cancelled',
          bookingStatus: 'cancelled',
          booking_status: 'cancelled',
        },
        cancelledAt: reviewedAt,
        syncStatus: 'pending',
        syncReason: 'booking_cancelled',
        syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
"""
if old_cancel_assign not in text:
    raise SystemExit('cancel assignment marker missing')
text = text.replace(old_cancel_assign, new_cancel_assign, 1)

old_review_mirror = """    if (root.exists) {
      const mirror: Record<string, unknown> = {
        customerPortalRequest: reviewedRequest,
        customerPortalRequestStatus: reviewedRequest.status,
        customerPortalRequestUpdatedAt: reviewedAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
      if (decision === 'approve' && reviewedRequest.type === 'reschedule') {
        Object.assign(mirror, {
          bookingDate: reviewedRequest.requestedDate,
          date: reviewedRequest.requestedDate,
          bookingTime: reviewedRequest.requestedTime,
          time: reviewedRequest.requestedTime,
          booking: {
            ...record(root.data()?.booking),
            preferredDate: reviewedRequest.requestedDate,
            preferredTime: reviewedRequest.requestedTime,
          },
          syncStatus: 'pending',
          syncReason: 'booking_rescheduled',
          syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
      if (decision === 'approve' && reviewedRequest.type === 'cancel') {
        Object.assign(mirror, {
          bookingStatus: 'cancelled', booking_status: 'cancelled', status: 'cancelled', cancelledAt: reviewedAt,
          booking: { ...record(root.data()?.booking), status: 'cancelled', bookingStatus: 'cancelled', booking_status: 'cancelled' },
          syncStatus: 'pending', syncReason: 'booking_cancelled', syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
      await rootRef.set(mirror, { merge: true })
    }
"""
new_review_mirror = """    if (root.exists) {
      const rootData = root.data() as RecordMap
      const rootStoreId = firstText(rootData, ['storeId', 'store_id', 'merchantId'], 180)
      if (rootStoreId === storeId) {
        const mirror: Record<string, unknown> = {
          customerPortalRequest: reviewedRequest,
          customerPortalRequestStatus: reviewedRequest.status,
          customerPortalRequestUpdatedAt: reviewedAt,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }
        if (decision === 'approve' && reviewedRequest.type === 'reschedule') {
          Object.assign(mirror, {
            bookingDate: reviewedRequest.requestedDate,
            date: reviewedRequest.requestedDate,
            bookingTime: reviewedRequest.requestedTime,
            time: reviewedRequest.requestedTime,
            slotId: null,
            slot_id: null,
            booking: {
              ...record(rootData.booking),
              preferredDate: reviewedRequest.requestedDate,
              preferredTime: reviewedRequest.requestedTime,
            },
            syncStatus: 'pending',
            syncReason: 'booking_rescheduled',
            syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        }
        if (decision === 'approve' && reviewedRequest.type === 'cancel') {
          Object.assign(mirror, {
            bookingStatus: 'cancelled', booking_status: 'cancelled', status: 'cancelled', cancelledAt: reviewedAt,
            slotId: null, slot_id: null,
            booking: { ...record(rootData.booking), status: 'cancelled', bookingStatus: 'cancelled', booking_status: 'cancelled' },
            syncStatus: 'pending', syncReason: 'booking_cancelled', syncRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        }
        await rootRef.set(mirror, { merge: true })
      } else {
        functions.logger.warn('Skipped reviewed customer portal root mirror because store ownership did not match', {
          bookingId,
          expectedStoreId: storeId,
          rootStoreId: rootStoreId || null,
        })
      }
    }
"""
if old_review_mirror not in text:
    raise SystemExit('review root mirror marker missing')
text = text.replace(old_review_mirror, new_review_mirror, 1)

old_decision_notify = """  if (reviewedRequest.status === 'rejected' && customerId) {
    await notifyCustomerOfRejection({ storeId, store, customer, bookingId, booking: bookingAfter, request: reviewedRequest })
  }
"""
new_decision_notify = """  if (reviewedRequest.status === 'approved') {
    try {
      await queueBookingPortalDecisionEmail(
        storeId,
        bookingId,
        reviewedRequest.type === 'cancel' ? 'booking.cancelled' : 'booking.rescheduled',
        bookingAfter,
      )
    } catch (error) {
      // The normal booking onWrite automation is an independent fallback. Keep
      // the approved booking state even if this eager notification attempt fails.
      functions.logger.error('Customer portal approval notification failed', {
        storeId,
        bookingId,
        requestId: reviewedRequest.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  } else if (customerId) {
    await notifyCustomerOfRejection({ storeId, store, customer, bookingId, booking: bookingAfter, request: reviewedRequest })
  }
"""
if old_decision_notify not in text:
    raise SystemExit('decision notification marker missing')
text = text.replace(old_decision_notify, new_decision_notify, 1)

self_service_path.write_text(text)

# Expose the existing booking email automation as an idempotent eager sender for
# approved portal decisions. The Firestore onWrite trigger calls the same event
# with the same reference, so notification_delivery_log suppresses duplicates.
booking_email_path = Path('functions/src/bookingEmailAutomation.ts')
booking_email = booking_email_path.read_text()
marker = """async function queueBookingEmail(
  storeId: string,
  bookingId: string,
  eventType: BookingEmailEvent,
  data: RecordMap,
  options: { forceStoreAlert?: boolean; referenceSuffix?: string } = {},
) {
  return queueBrandedNotification({
    eventType,
    storeId,
    reference: eventReference(bookingId, eventType, data, options.referenceSuffix),
    customer: customerFromBooking(data),
    payment: paymentFromBooking(data),
    data: notificationData(bookingId, data),
    forceStoreAlert: options.forceStoreAlert === true,
  })
}
"""
addition = marker + """

export async function queueBookingPortalDecisionEmail(
  storeId: string,
  bookingId: string,
  eventType: 'booking.rescheduled' | 'booking.cancelled',
  data: RecordMap,
) {
  return queueBookingEmail(
    storeId,
    bookingId,
    eventType,
    data,
    eventType === 'booking.rescheduled'
      ? { forceStoreAlert: true, referenceSuffix: `${bookingDate(data)}-${bookingTime(data)}` }
      : { forceStoreAlert: true },
  )
}
"""
if marker not in booking_email:
    raise SystemExit('booking email helper marker missing')
booking_email = booking_email.replace(marker, addition, 1)
booking_email_path.write_text(booking_email)

# A paid booking must always expose a zero customer-facing balance even if a
# legacy/stale amountOutstanding field survives settlement.
portal_path = Path('functions/src/customerPortal.ts')
portal = portal_path.read_text()
old_map = """  const directOutstanding = firstNumber(data, ['amountOutstanding', 'balance', 'outstandingAmount', 'payment.amountOutstanding', 'payment.balance'])
  const outstanding = directOutstanding !== null
    ? Math.max(0, directOutstanding)
    : total !== null && received !== null
      ? Math.max(0, total - received)
      : paidLike(data.paymentStatus ?? payment.status) ? 0 : null
  return {
"""
new_map = """  const paymentStatus = firstText(data, ['paymentStatus', 'payment.status']) || 'pending'
  const directOutstanding = firstNumber(data, ['amountOutstanding', 'balance', 'outstandingAmount', 'payment.amountOutstanding', 'payment.balance'])
  const outstanding = paidLike(paymentStatus)
    ? 0
    : directOutstanding !== null
      ? Math.max(0, directOutstanding)
      : total !== null && received !== null
        ? Math.max(0, total - received)
        : null
  return {
"""
if old_map not in portal:
    raise SystemExit('customer portal outstanding marker missing')
portal = portal.replace(old_map, new_map, 1)
portal = portal.replace(
"""    paymentStatus: firstText(data, ['paymentStatus', 'payment.status']) || 'pending',
""",
"""    paymentStatus,
""",
1,
)
portal_path.write_text(portal)

# UI defense-in-depth: paid-like statuses hide the Pay button and render zero
# even if an older API response happens to carry a stale positive balance.
public_portal_path = Path('web/src/pages/PublicCustomerPortal.tsx')
public_portal = public_portal_path.read_text()
old_ui = """            const normalizedBookingStatus = booking.status.toLowerCase().replace(/[\\s-]+/g, '_')
            const isClosed = ['cancelled', 'canceled', 'completed', 'complete'].includes(normalizedBookingStatus)
            const request = requestByBooking.get(booking.id)
            const pendingRequest = request?.status === 'pending'
            const canPay = !isClosed && typeof booking.amountOutstanding === 'number' && booking.amountOutstanding > 0
            const isEditingAction = actionBookingId === booking.id && Boolean(actionType)
"""
new_ui = """            const normalizedBookingStatus = booking.status.toLowerCase().replace(/[\\s-]+/g, '_')
            const normalizedPaymentStatus = booking.paymentStatus.toLowerCase().replace(/[\\s-]+/g, '_')
            const isClosed = ['cancelled', 'canceled', 'completed', 'complete'].includes(normalizedBookingStatus)
            const isPaid = ['paid', 'confirmed', 'success', 'succeeded', 'captured', 'complete', 'completed', 'paid_cash'].includes(normalizedPaymentStatus)
            const displayOutstanding = isPaid ? 0 : booking.amountOutstanding
            const request = requestByBooking.get(booking.id)
            const pendingRequest = request?.status === 'pending'
            const canPay = !isClosed && !isPaid && typeof displayOutstanding === 'number' && displayOutstanding > 0
            const isEditingAction = actionBookingId === booking.id && Boolean(actionType)
"""
if old_ui not in public_portal:
    raise SystemExit('public portal canPay marker missing')
public_portal = public_portal.replace(old_ui, new_ui, 1)
public_portal = public_portal.replace(
"""                  <div><dt>Balance</dt><dd>{formatMoney(booking.amountOutstanding, booking.currency)}</dd></div>
""",
"""                  <div><dt>Balance</dt><dd>{formatMoney(displayOutstanding, booking.currency)}</dd></div>
""",
1,
)
public_portal = public_portal.replace(
"""                        {payingBookingId === booking.id ? 'Opening secure payment…' : `Pay balance · ${formatMoney(booking.amountOutstanding, booking.currency)}`}
""",
"""                        {payingBookingId === booking.id ? 'Opening secure payment…' : `Pay balance · ${formatMoney(displayOutstanding, booking.currency)}`}
""",
1,
)
public_portal_path.write_text(public_portal)
