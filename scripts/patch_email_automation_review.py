from pathlib import Path
import re

booking_path = Path('functions/src/bookingEmailAutomation.ts')
booking = booking_path.read_text()
old_number = """function numberValue(value: unknown) {\n  const parsed = Number(value)\n  return Number.isFinite(parsed) ? parsed : null\n}\n"""
new_number = """function numberValue(value: unknown) {\n  if (value === null || value === undefined) return null\n  if (typeof value === 'string' && !value.trim()) return null\n  const parsed = Number(value)\n  return Number.isFinite(parsed) ? parsed : null\n}\n"""
if old_number not in booking:
    raise SystemExit('booking numberValue anchor not found')
booking = booking.replace(old_number, new_number, 1)
booking_path.write_text(booking)

pending_path = Path('functions/src/bookingEmailNotifications.ts')
pending = pending_path.read_text()
old_status = "if (['cancelled', 'canceled', 'completed', 'complete'].includes(status)) return false"
new_status = "if (['cancelled', 'canceled', 'completed', 'complete', 'confirmed'].includes(status)) return false"
if old_status not in pending:
    raise SystemExit('unpaid booking status anchor not found')
pending = pending.replace(old_status, new_status, 1)
pending_path.write_text(pending)

event_path = Path('functions/src/eventCommunications.ts')
event = event_path.read_text()
import_anchor = "import { appendNotificationOutboxRow, getDefaultSpreadsheetId } from './googleSheets'\n"
if "from './emailDelivery'" not in event:
    if import_anchor not in event:
        raise SystemExit('event email delivery import anchor not found')
    event = event.replace(import_anchor, import_anchor + "import { deliverTransactionalEmail } from './emailDelivery'\n", 1)

post_pattern = re.compile(
    r"async function postEmailWebhook\(payload: RecordMap, settings: NotificationSettings\) \{.*?\n\}\n\nasync function queueEventEmail",
    re.S,
)
post_replacement = """async function postEmailWebhook(payload: RecordMap, settings: NotificationSettings) {\n  void settings\n  return deliverTransactionalEmail({\n    storeId: text(payload.storeId, 180),\n    eventType: text(payload.eventType, 100),\n    reference: text(payload.reference, 220),\n    recipientType: text(payload.recipientType, 80),\n    to: email(payload.to),\n    subject: text(payload.subject, 500),\n    html: text(payload.html, 200000),\n    text: text(payload.text, 200000),\n    brand: record(payload.brand),\n    customer: record(payload.customer),\n    payment: record(payload.payment),\n    data: record(payload.data),\n  })\n}\n\nasync function queueEventEmail"""
event, count = post_pattern.subn(post_replacement, event, count=1)
if count != 1:
    raise SystemExit(f'event postEmailWebhook replacement count: {count}')

old_event_status = """    await outboxRef.set({\n      status: webhook.attempted ? (webhook.ok ? 'sent_to_webhook' : 'webhook_failed') : sheetSyncStatus,\n      webhookStatus: webhook.status,\n      sentToWebhookAt: webhook.attempted ? now : null,\n      sheetSyncStatus,\n      updatedAt: now,\n    }, { merge: true })\n"""
new_event_status = """    await outboxRef.set({\n      status: webhook.attempted ? (webhook.ok ? 'delivery_accepted' : 'delivery_failed') : 'queued_no_live_sender',\n      webhookStatus: webhook.status,\n      deliveryChannel: webhook.channel,\n      deliveryStatus: webhook.deliveryStatus,\n      senderName: webhook.senderName || null,\n      senderEmail: webhook.senderEmail || null,\n      replyToEmail: webhook.replyToEmail || null,\n      deliveryReason: webhook.reason || null,\n      sentToWebhookAt: webhook.attempted ? now : null,\n      sheetSyncStatus,\n      updatedAt: now,\n    }, { merge: true })\n"""
if old_event_status not in event:
    raise SystemExit('event outbox status anchor not found')
event = event.replace(old_event_status, new_event_status, 1)
event_path.write_text(event)

print('Email automation review fixes applied.')
