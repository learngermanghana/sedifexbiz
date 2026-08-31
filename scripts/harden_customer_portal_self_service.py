from pathlib import Path

path = Path('functions/src/customerPortalSelfService.ts')
text = path.read_text()

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

path.write_text(text)
