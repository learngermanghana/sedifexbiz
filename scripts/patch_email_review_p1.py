from pathlib import Path
import re

booking_path = Path('functions/src/bookingEmailAutomation.ts')
booking = booking_path.read_text()

old_payment_status = """function paymentStatus(data: RecordMap) {\n  const payment = record(data.payment)\n  return normalizeStatus(data.paymentStatus ?? data.payment_status ?? payment.status ?? payment.paymentStatus, 'pending')\n}\n"""
new_payment_status = """function paymentStatus(data: RecordMap) {\n  const payment = record(data.payment)\n  const raw = normalizeStatus(data.paymentStatus ?? data.payment_status ?? payment.status ?? payment.paymentStatus, 'pending')\n  if (['paid', 'payment_paid', 'paid_cash', 'confirmed', 'success', 'succeeded', 'captured', 'complete', 'completed'].includes(raw)) return 'paid'\n  if (['partially_paid', 'partial', 'payment_partial', 'deposit_paid', 'part_paid'].includes(raw)) return 'partial'\n  if (['awaiting_verification', 'manual_review', 'payment_awaiting_verification', 'pending_verification'].includes(raw)) return 'awaiting_verification'\n  if (['pending', 'payment_pending', 'unpaid', 'pending_payment', 'pending_cash'].includes(raw)) return 'pending'\n  return raw\n}\n"""
if old_payment_status not in booking:
    raise SystemExit('paymentStatus anchor not found')
booking = booking.replace(old_payment_status, new_payment_status, 1)

old_candidates = """async function storeReminderCandidates(storeId: string, today: string, endDate: string) {\n  const collection = defaultDb.collection('stores').doc(storeId).collection('integrationBookings')\n  const [bookingDateSnapshot, legacyDateSnapshot] = await Promise.all([\n    collection.where('bookingDate', '>=', today).where('bookingDate', '<=', endDate).limit(STORE_BOOKING_LIMIT).get(),\n    collection.where('date', '>=', today).where('date', '<=', endDate).limit(STORE_BOOKING_LIMIT).get(),\n  ])\n\n  const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()\n  bookingDateSnapshot.docs.forEach(document => candidates.set(document.id, document))\n  legacyDateSnapshot.docs.forEach(document => candidates.set(document.id, document))\n  return Array.from(candidates.values())\n}\n"""
new_candidates = """async function pagedReminderRange(\n  collection: FirebaseFirestore.CollectionReference,\n  field: 'bookingDate' | 'date',\n  today: string,\n  endDate: string,\n) {\n  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = []\n  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null\n\n  for (;;) {\n    let pageQuery: FirebaseFirestore.Query = collection\n      .where(field, '>=', today)\n      .where(field, '<=', endDate)\n      .orderBy(field)\n      .limit(STORE_BOOKING_LIMIT)\n    if (cursor) pageQuery = pageQuery.startAfter(cursor)\n\n    const snapshot = await pageQuery.get()\n    documents.push(...snapshot.docs)\n    if (snapshot.size < STORE_BOOKING_LIMIT) break\n    cursor = snapshot.docs[snapshot.docs.length - 1] || null\n    if (!cursor) break\n  }\n\n  return documents\n}\n\nasync function storeReminderCandidates(storeId: string, today: string, endDate: string) {\n  const collection = defaultDb.collection('stores').doc(storeId).collection('integrationBookings')\n  const [bookingDateDocuments, legacyDateDocuments] = await Promise.all([\n    pagedReminderRange(collection, 'bookingDate', today, endDate),\n    pagedReminderRange(collection, 'date', today, endDate),\n  ])\n\n  const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>()\n  bookingDateDocuments.forEach(document => candidates.set(document.id, document))\n  legacyDateDocuments.forEach(document => candidates.set(document.id, document))\n  return Array.from(candidates.values())\n}\n"""
if old_candidates not in booking:
    raise SystemExit('reminder candidate anchor not found')
booking = booking.replace(old_candidates, new_candidates, 1)
booking_path.write_text(booking)

email_path = Path('functions/src/emailDelivery.ts')
email_delivery = email_path.read_text()

old_input_tail = """  payment?: RecordMap | null\n  data?: RecordMap | null\n}\n"""
new_input_tail = """  payment?: RecordMap | null\n  data?: RecordMap | null\n  webhookPayload?: RecordMap | null\n}\n"""
if old_input_tail not in email_delivery:
    raise SystemExit('email input anchor not found')
email_delivery = email_delivery.replace(old_input_tail, new_input_tail, 1)

record_anchor = """function record(value: unknown): RecordMap {\n  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}\n}\n"""
compat_helpers = record_anchor + """\nfunction firstText(source: RecordMap, keys: string[], max = 500) {\n  for (const key of keys) {\n    const value = text(source[key], max)\n    if (value) return value\n  }\n  return ''\n}\n\nfunction buildCompatibleWebhookPayload(input: TransactionalEmailDeliveryInput): RecordMap {\n  const data = record(input.data)\n  const customer = record(input.customer)\n  const payment = record(input.payment)\n  const bookingId = firstText(data, ['bookingId', 'booking_id', 'id'], 220)\n  const bookingStatus = firstText(data, ['bookingStatus', 'booking_status', 'status'], 80)\n    || (input.eventType === 'booking.confirmed' ? 'confirmed' : input.eventType === 'booking.created' || input.eventType === 'booking.received' ? 'pending_approval' : '')\n\n  return {\n    storeId: input.storeId,\n    eventType: input.eventType,\n    reference: input.reference,\n    recipientType: input.recipientType,\n    to: input.to,\n    subject: input.subject,\n    html: input.html,\n    text: input.text,\n    brand: input.brand ?? null,\n    customer: input.customer ?? null,\n    payment: input.payment ?? null,\n    data: input.data ?? null,\n    bookingId: bookingId || undefined,\n    booking_id: bookingId || undefined,\n    bookingStatus: bookingStatus || undefined,\n    booking_status: bookingStatus || undefined,\n    status: bookingStatus || undefined,\n    serviceId: firstText(data, ['serviceId', 'service_id'], 220) || undefined,\n    serviceName: firstText(data, ['serviceName', 'service_name', 'itemName', 'productName'], 240) || undefined,\n    bookingDate: firstText(data, ['bookingDate', 'booking_date', 'preferredDate', 'date'], 80) || undefined,\n    bookingTime: firstText(data, ['bookingTime', 'booking_time', 'preferredTime', 'time'], 80) || undefined,\n    notes: firstText(data, ['notes', 'message', 'details'], 2000) || undefined,\n    quantity: firstText(data, ['quantity'], 20) || undefined,\n    customerName: text(customer.name, 240) || undefined,\n    customerPhone: text(customer.phone, 80) || undefined,\n    customerEmail: email(customer.email) || undefined,\n    paymentStatus: firstText(payment, ['status'], 80) || undefined,\n    payment_status: firstText(payment, ['status'], 80) || undefined,\n    paymentMethod: firstText(payment, ['method'], 80) || undefined,\n    paymentAmount: numberValue(payment.amount) || undefined,\n    paymentReference: firstText(payment, ['reference'], 220) || undefined,\n    paymentConfirmed: input.eventType === 'booking.confirmed' || ['paid', 'confirmed', 'success', 'succeeded', 'captured', 'complete', 'completed'].includes(text(payment.status, 80).toLowerCase().replace(/[\\s-]+/g, '_')),\n  }\n}\n"""
if 'function buildCompatibleWebhookPayload' not in email_delivery:
    if record_anchor not in email_delivery:
        raise SystemExit('record helper anchor not found')
    email_delivery = email_delivery.replace(record_anchor, compat_helpers, 1)

old_apps = """    const sent = Math.max(0, numberValue(body.sent))\n    const queuedForRetry = Math.max(0, numberValue(body.queuedForRetry))\n    const duplicate = body.duplicate === true\n    const accepted = response.ok && body.ok !== false && (sent > 0 || queuedForRetry > 0 || duplicate)\n    const deliveryStatus = duplicate\n      ? 'duplicate'\n      : sent > 0\n        ? 'sent'\n        : queuedForRetry > 0\n          ? 'queued'\n          : 'failed'\n"""
new_apps = """    const sent = Math.max(0, numberValue(body.sent))\n    const queuedForRetry = Math.max(0, numberValue(body.queuedForRetry))\n    const duplicate = body.duplicate === true\n    // The current Apps Script template reports quota deferrals but does not create\n    // a durable retry for transactional recipients, so quota-only deferrals must\n    // continue to the Sedifex fallback instead of becoming terminal successes.\n    const accepted = response.ok && body.ok !== false && (sent > 0 || duplicate)\n    const deliveryStatus = duplicate\n      ? 'duplicate'\n      : sent > 0\n        ? 'sent'\n        : 'failed'\n"""
if old_apps not in email_delivery:
    raise SystemExit('Apps Script acceptance anchor not found')
email_delivery = email_delivery.replace(old_apps, new_apps, 1)

old_reason = """      reason: accepted ? undefined : text(body.error, 500) || `apps-script-http-${response.status}`,\n"""
new_reason = """      reason: accepted\n        ? undefined\n        : queuedForRetry > 0\n          ? 'apps-script-quota-deferred-without-durable-retry'\n          : text(body.error, 500) || `apps-script-http-${response.status}`,\n"""
if old_reason not in email_delivery:
    raise SystemExit('Apps Script reason anchor not found')
email_delivery = email_delivery.replace(old_reason, new_reason, 1)

old_payload = """  const payload: RecordMap = {\n    storeId: input.storeId,\n    eventType: input.eventType,\n    reference: input.reference,\n    recipientType: input.recipientType,\n    to: input.to,\n    subject: input.subject,\n    html: input.html,\n    text: input.text,\n    brand: input.brand ?? null,\n    customer: input.customer ?? null,\n    payment: input.payment ?? null,\n    data: input.data ?? null,\n    senderName: settings.storeName,\n    replyToEmail: settings.replyToEmail || null,\n  }\n"""
new_payload = """  const payload: RecordMap = {\n    ...(input.webhookPayload ? record(input.webhookPayload) : buildCompatibleWebhookPayload(input)),\n    senderName: settings.storeName,\n    replyToEmail: settings.replyToEmail || null,\n  }\n"""
if old_payload not in email_delivery:
    raise SystemExit('webhook payload anchor not found')
email_delivery = email_delivery.replace(old_payload, new_payload, 1)

old_return_condition = """    if (appsScript.ok || appsScript.deliveryStatus === 'queued' || appsScript.deliveryStatus === 'duplicate') {\n      return appsScript\n    }\n"""
new_return_condition = """    if (appsScript.ok || appsScript.deliveryStatus === 'duplicate') {\n      return appsScript\n    }\n"""
if old_return_condition not in email_delivery:
    raise SystemExit('Apps Script terminal condition anchor not found')
email_delivery = email_delivery.replace(old_return_condition, new_return_condition, 1)
email_path.write_text(email_delivery)

notifications_path = Path('functions/src/notifications.ts')
notifications = notifications_path.read_text()
old_delivery_call = """    data: getRecord(payload.data),\n  })\n"""
new_delivery_call = """    data: getRecord(payload.data),\n    webhookPayload: buildWebhookPayload(payload),\n  })\n"""
if old_delivery_call not in notifications:
    raise SystemExit('notification delivery payload anchor not found')
notifications = notifications.replace(old_delivery_call, new_delivery_call, 1)
notifications_path.write_text(notifications)

print('Applied all four PR review fixes.')
