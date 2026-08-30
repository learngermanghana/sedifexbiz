from pathlib import Path
import re

notifications_path = Path('functions/src/notifications.ts')
notifications = notifications_path.read_text()

import_line = "import { appendNotificationOutboxRow, getDefaultSpreadsheetId } from './googleSheets'\n"
new_import_line = import_line + "import { deliverTransactionalEmail } from './emailDelivery'\n"
if "from './emailDelivery'" not in notifications:
    if import_line not in notifications:
        raise SystemExit('notifications import anchor not found')
    notifications = notifications.replace(import_line, new_import_line, 1)

old_required = "const REQUIRED_STORE_ALERT_EVENTS = new Set(['order.created', 'order.confirmed', 'order.pay_on_delivery', 'order.manual_payment', 'booking.created', 'booking.confirmed', 'student_registration.created', 'student_registration.paid', 'donation.created', 'donation.confirmed', 'volunteer.created', 'support_request.created', 'event_registration.created', 'event_registration.confirmed'])"
new_required = "const REQUIRED_STORE_ALERT_EVENTS = new Set(['order.created', 'order.confirmed', 'order.pay_on_delivery', 'order.manual_payment', 'booking.created', 'booking.received', 'booking.confirmed', 'booking.rescheduled', 'booking.cancelled', 'booking.payment_submitted', 'booking.payment_received', 'booking.payment_confirmed', 'student_registration.created', 'student_registration.paid', 'donation.created', 'donation.confirmed', 'volunteer.created', 'support_request.created', 'event_registration.created', 'event_registration.confirmed'])"
if old_required not in notifications:
    raise SystemExit('required events anchor not found')
notifications = notifications.replace(old_required, new_required, 1)

switch_anchor = "  switch (eventType) {\n"
booking_cases = """  switch (eventType) {\n    case 'booking.received': return { customerTitle: 'Booking received', customerIntro: `We received your booking for ${itemName}. Keep the details below for your records. If payment is still pending, the booking will remain pending until payment is confirmed.`, adminTitle: 'New booking received', adminAction: 'Review the booking, payment status and appointment details.' }\n    case 'booking.payment_submitted': return { customerTitle: 'Payment submitted', customerIntro: `We received the payment information for your ${itemName} booking. ${storeName} will review and confirm it.`, adminTitle: 'Booking payment needs review', adminAction: 'Verify the submitted payment and confirm it in Sedifex.' }\n    case 'booking.payment_received': return { customerTitle: 'Payment received', customerIntro: `A payment has been recorded for your ${itemName} booking with ${storeName}. The amount received and remaining balance are shown below.`, adminTitle: 'Booking payment recorded', adminAction: 'Review the payment and remaining balance.' }\n    case 'booking.payment_confirmed': return { customerTitle: 'Payment receipt', customerIntro: `Your payment for ${itemName} has been confirmed by ${storeName}. Keep this email as your Sedifex payment receipt.`, adminTitle: 'Booking payment confirmed', adminAction: 'Payment is confirmed. Continue with the booking workflow.' }\n    case 'booking.rescheduled': return { customerTitle: 'Booking rescheduled', customerIntro: `Your booking for ${itemName} has been rescheduled by ${storeName}. Please review the new date and time below.`, adminTitle: 'Booking rescheduled', adminAction: 'Make sure staff and operational schedules reflect the new appointment.' }\n    case 'booking.cancelled': return { customerTitle: 'Booking cancelled', customerIntro: `Your booking for ${itemName} has been cancelled. Contact ${storeName} if you need help or want to arrange another date.`, adminTitle: 'Booking cancelled', adminAction: 'Review any outstanding payment, refund or follow-up requirement.' }\n    case 'booking.completed': return { customerTitle: 'Thank you for choosing us', customerIntro: `Thank you for choosing ${storeName} for ${itemName}. We appreciate your business and hope to serve you again.`, adminTitle: 'Booking completed', adminAction: 'No action is required unless follow-up is needed.' }\n    case 'booking.reminder_3d': return { customerTitle: 'Booking reminder - 3 days', customerIntro: `Your ${itemName} booking with ${storeName} is in 3 days. Review the appointment details and any outstanding balance below.`, adminTitle: 'Booking reminder', adminAction: 'No action is required unless the customer needs assistance.' }\n    case 'booking.reminder_2d': return { customerTitle: 'Booking reminder - 2 days', customerIntro: `Your ${itemName} booking with ${storeName} is in 2 days. Review the appointment details and any outstanding balance below.`, adminTitle: 'Booking reminder', adminAction: 'No action is required unless the customer needs assistance.' }\n    case 'booking.reminder_1d': return { customerTitle: 'Booking reminder - tomorrow', customerIntro: `Your ${itemName} booking with ${storeName} is tomorrow. Review the appointment details and any outstanding balance below.`, adminTitle: 'Booking reminder', adminAction: 'No action is required unless the customer needs assistance.' }\n"""
if "case 'booking.payment_confirmed'" not in notifications:
    if switch_anchor not in notifications:
        raise SystemExit('eventCopy switch anchor not found')
    notifications = notifications.replace(switch_anchor, booking_cases, 1)

old_detail_keys = "['bookingDate', 'bookingTime', 'preferredClassTime', 'branch', 'location', 'deliveryStatus', 'fulfillmentStatus', 'deliveredAt', 'deliveredBy', 'deliveryNote', 'deliveryReference', 'skill', 'availability', 'notes', 'needSummary']"
new_detail_keys = "['bookingDate', 'bookingTime', 'preferredClassTime', 'branch', 'location', 'totalAmount', 'amountReceived', 'amountOutstanding', 'receiptNumber', 'deliveryStatus', 'fulfillmentStatus', 'deliveredAt', 'deliveredBy', 'deliveryNote', 'deliveryReference', 'skill', 'availability', 'notes', 'needSummary']"
if old_detail_keys not in notifications:
    raise SystemExit('detail row keys anchor not found')
notifications = notifications.replace(old_detail_keys, new_detail_keys, 1)

post_pattern = re.compile(
    r"async function postToWebhook\(payload: Record<string, unknown>, settings: NotificationSettings\) \{.*?\n\}\n\nasync function createDelivery",
    re.S,
)
post_replacement = """async function postToWebhook(payload: Record<string, unknown>, settings: NotificationSettings) {\n  void settings\n  const delivery = await deliverTransactionalEmail({\n    storeId: text(payload.storeId, 180),\n    eventType: text(payload.eventType, 100),\n    reference: text(payload.reference, 220),\n    recipientType: text(payload.recipientType, 80),\n    to: email(payload.to),\n    subject: text(payload.subject, 500),\n    html: text(payload.html, 200000),\n    text: text(payload.text, 200000),\n    brand: getRecord(payload.brand),\n    customer: getRecord(payload.customer),\n    payment: getRecord(payload.payment),\n    data: getRecord(payload.data),\n  })\n  return delivery\n}\n\nasync function createDelivery"""
notifications, replacements = post_pattern.subn(post_replacement, notifications, count=1)
if replacements != 1:
    raise SystemExit(f'postToWebhook replacement count: {replacements}')

old_delivery_lines = """    if (webhook.attempted) await outboxRef.set({ status: webhook.ok ? 'sent_to_webhook' : 'webhook_failed', webhookStatus: webhook.status, sentToWebhookAt: now, sheetSyncStatus, updatedAt: now }, { merge: true })\n    if (!webhook.attempted) await outboxRef.set({ status: sheetSyncStatus, sheetSyncStatus, updatedAt: now }, { merge: true })\n"""
new_delivery_lines = """    if (webhook.attempted) await outboxRef.set({\n      status: webhook.ok ? 'delivery_accepted' : 'delivery_failed',\n      webhookStatus: webhook.status,\n      deliveryChannel: webhook.channel,\n      deliveryStatus: webhook.deliveryStatus,\n      senderName: webhook.senderName || null,\n      senderEmail: webhook.senderEmail || null,\n      replyToEmail: webhook.replyToEmail || null,\n      deliveryReason: webhook.reason || null,\n      sentToWebhookAt: now,\n      sheetSyncStatus,\n      updatedAt: now,\n    }, { merge: true })\n    if (!webhook.attempted) await outboxRef.set({\n      status: 'queued_no_live_sender',\n      deliveryChannel: webhook.channel,\n      deliveryStatus: webhook.deliveryStatus,\n      senderName: webhook.senderName || null,\n      replyToEmail: webhook.replyToEmail || null,\n      deliveryReason: webhook.reason || null,\n      sheetSyncStatus,\n      updatedAt: now,\n    }, { merge: true })\n"""
if old_delivery_lines not in notifications:
    raise SystemExit('createDelivery status anchor not found')
notifications = notifications.replace(old_delivery_lines, new_delivery_lines, 1)

notifications_path.write_text(notifications)

booking_pending_path = Path('functions/src/bookingEmailNotifications.ts')
booking_pending = booking_pending_path.read_text()
old_event = "const UNPAID_BOOKING_EVENT = 'booking_received_-_payment_pending'"
new_event = "const UNPAID_BOOKING_EVENT = 'booking.received'"
if old_event not in booking_pending:
    raise SystemExit('unpaid booking event anchor not found')
booking_pending = booking_pending.replace(old_event, new_event, 1)
booking_pending_path.write_text(booking_pending)

index_path = Path('functions/src/index.ts')
index_text = index_path.read_text()
anchor = """export {\n  notifyUnpaidBookingCreated,\n  processUnpaidBookingEmailNotifications,\n} from './bookingEmailNotifications'\n"""
addition = anchor + """export {\n  automateBookingEmailOnWrite,\n  processBookingEmailReminders,\n} from './bookingEmailAutomation'\n"""
if "from './bookingEmailAutomation'" not in index_text:
    if anchor not in index_text:
        raise SystemExit('index booking email anchor not found')
    index_text = index_text.replace(anchor, addition, 1)
index_path.write_text(index_text)

print('Email automation patches applied.')
