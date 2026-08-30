import * as functions from 'firebase-functions/v1'
import { defineString } from 'firebase-functions/params'
import { admin, defaultDb } from './firestore'
import { appendNotificationOutboxRow, getDefaultSpreadsheetId } from './googleSheets'
import { deliverTransactionalEmail } from './emailDelivery'

const SEDIFEX_NOTIFICATION_WEBHOOK_URL = defineString('SEDIFEX_NOTIFICATION_WEBHOOK_URL', { default: '' })
const SEDIFEX_NOTIFICATION_SHARED_SECRET = defineString('SEDIFEX_NOTIFICATION_SHARED_SECRET', { default: '' })

type CustomerInfo = { name?: string | null; email?: string | null; phone?: string | null }
type PaymentInfo = { status?: string | null; amount?: number | null; currency?: string | null; method?: string | null; reference?: string | null }
type NotificationPayload = { eventType: string; storeId: string; reference?: string | null; customer?: CustomerInfo | null; payment?: PaymentInfo | null; data?: Record<string, unknown> | null; forceStoreAlert?: boolean }
type StoreBrand = { storeId: string; storeName: string; logoUrl: string | null; brandColor: string; email: string | null; phone: string | null; publicUrl: string | null }
type NotificationSettings = { customerEmailEnabled: boolean; storeAlertEnabled: boolean; adminEmails: string[]; replyToEmail: string | null; mode: 'sedifex_default' | 'custom_webhook'; customWebhookEnabled: boolean; customWebhookUrl: string | null; deliveryPreference: 'automatic' | 'sedifex' | 'store_email' | 'custom_webhook'; fallbackToSedifex: boolean; automations: Record<string, boolean> }

const DEFAULT_BRAND_COLOR = '#4f46e5'
const REQUIRED_STORE_ALERT_EVENTS = new Set(['order.created', 'order.confirmed', 'order.pay_on_delivery', 'order.manual_payment', 'booking.created', 'booking.received', 'booking.confirmed', 'booking.rescheduled', 'booking.cancelled', 'booking.payment_submitted', 'booking.payment_received', 'booking.payment_confirmed', 'student_registration.created', 'student_registration.paid', 'donation.created', 'donation.confirmed', 'volunteer.created', 'support_request.created', 'event_registration.created', 'event_registration.confirmed'])

function text(value: unknown, max = 500) { return typeof value === 'string' ? value.trim().slice(0, max) : '' }
function email(value: unknown) { const cleaned = text(value, 220).toLowerCase(); return cleaned.includes('@') ? cleaned : '' }
function numberValue(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }
function getRecord(value: unknown) { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function getNestedRecord(record: Record<string, unknown>, key: string) { return getRecord(record[key]) }
function notificationDeliveryPreference(value: unknown): NotificationSettings['deliveryPreference'] {
  const candidate = text(value, 40)
  return ['automatic', 'sedifex', 'store_email', 'custom_webhook'].includes(candidate)
    ? candidate as NotificationSettings['deliveryPreference']
    : 'automatic'
}
function booleanSettings(value: unknown) {
  return Object.fromEntries(Object.entries(getRecord(value)).filter(([, enabled]) => typeof enabled === 'boolean')) as Record<string, boolean>
}
function titleCase(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()) }
function formatMoney(payment?: PaymentInfo | null) { const amount = numberValue(payment?.amount); return amount === null ? null : `${payment?.currency || 'GHS'} ${amount.toFixed(2)}` }
function escapeHtml(value: unknown) { return text(value, 3000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;') }
function getFirstText(record: Record<string, unknown>, keys: string[], max = 500) { for (const key of keys) { const value = text(record[key], max); if (value) return value } return '' }
function getDataItemName(data?: Record<string, unknown> | null) { const source = data ?? {}; return getFirstText(source, ['itemName', 'serviceName', 'productName', 'programName', 'course', 'supportType', 'preferredProject', 'project', 'campaign', 'title', 'name'], 220) || 'your request' }

function eventCopy(eventType: string, storeName: string, itemName: string) {
  switch (eventType) {
    case 'booking.received': return { customerTitle: 'Booking received', customerIntro: `We received your booking for ${itemName}. Keep the details below for your records. If payment is still pending, the booking will remain pending until payment is confirmed.`, adminTitle: 'New booking received', adminAction: 'Review the booking, payment status and appointment details.' }
    case 'booking.payment_submitted': return { customerTitle: 'Payment submitted', customerIntro: `We received the payment information for your ${itemName} booking. ${storeName} will review and confirm it.`, adminTitle: 'Booking payment needs review', adminAction: 'Verify the submitted payment and confirm it in Sedifex.' }
    case 'booking.payment_received': return { customerTitle: 'Payment received', customerIntro: `A payment has been recorded for your ${itemName} booking with ${storeName}. The amount received and remaining balance are shown below.`, adminTitle: 'Booking payment recorded', adminAction: 'Review the payment and remaining balance.' }
    case 'booking.payment_confirmed': return { customerTitle: 'Payment receipt', customerIntro: `Your payment for ${itemName} has been confirmed by ${storeName}. Keep this email as your Sedifex payment receipt.`, adminTitle: 'Booking payment confirmed', adminAction: 'Payment is confirmed. Continue with the booking workflow.' }
    case 'booking.rescheduled': return { customerTitle: 'Booking rescheduled', customerIntro: `Your booking for ${itemName} has been rescheduled by ${storeName}. Please review the new date and time below.`, adminTitle: 'Booking rescheduled', adminAction: 'Make sure staff and operational schedules reflect the new appointment.' }
    case 'booking.cancelled': return { customerTitle: 'Booking cancelled', customerIntro: `Your booking for ${itemName} has been cancelled. Contact ${storeName} if you need help or want to arrange another date.`, adminTitle: 'Booking cancelled', adminAction: 'Review any outstanding payment, refund or follow-up requirement.' }
    case 'booking.completed': return { customerTitle: 'Thank you for choosing us', customerIntro: `Thank you for choosing ${storeName} for ${itemName}. We appreciate your business and hope to serve you again.`, adminTitle: 'Booking completed', adminAction: 'No action is required unless follow-up is needed.' }
    case 'booking.reminder_3d': return { customerTitle: 'Booking reminder - 3 days', customerIntro: `Your ${itemName} booking with ${storeName} is in 3 days. Review the appointment details and any outstanding balance below.`, adminTitle: 'Booking reminder', adminAction: 'No action is required unless the customer needs assistance.' }
    case 'booking.reminder_2d': return { customerTitle: 'Booking reminder - 2 days', customerIntro: `Your ${itemName} booking with ${storeName} is in 2 days. Review the appointment details and any outstanding balance below.`, adminTitle: 'Booking reminder', adminAction: 'No action is required unless the customer needs assistance.' }
    case 'booking.reminder_1d': return { customerTitle: 'Booking reminder - tomorrow', customerIntro: `Your ${itemName} booking with ${storeName} is tomorrow. Review the appointment details and any outstanding balance below.`, adminTitle: 'Booking reminder', adminAction: 'No action is required unless the customer needs assistance.' }
    case 'order.confirmed': return { customerTitle: 'Order confirmed', customerIntro: `Your order for ${itemName} has been received and confirmed. Thank you for buying from ${storeName}.`, adminTitle: 'New paid order received', adminAction: 'Prepare delivery or contact the customer if you need extra details.' }
    case 'order.pay_on_delivery': return { customerTitle: 'Order received', customerIntro: `Your order for ${itemName} has been received. Payment will be handled on delivery.`, adminTitle: 'New pay on delivery order', adminAction: 'Contact the customer and prepare delivery.' }
    case 'order.manual_payment': return { customerTitle: 'Order received', customerIntro: `Your order for ${itemName} has been received and is pending payment review.`, adminTitle: 'New manual payment order', adminAction: 'Review the payment details and follow up with the customer.' }
    case 'order.delivered': return { customerTitle: 'Order delivered', customerIntro: `Your order for ${itemName} from ${storeName} has been marked as delivered. Thank you for shopping with ${storeName}.`, adminTitle: 'Order marked delivered', adminAction: 'No action is needed unless the customer reports a delivery issue.' }
    case 'booking.confirmed': return { customerTitle: 'Booking confirmed', customerIntro: `Your booking for ${itemName} is confirmed by ${storeName}.`, adminTitle: 'Booking confirmed', adminAction: 'Prepare to deliver the booked service.' }
    case 'booking.created': return { customerTitle: 'Payment received', customerIntro: `Payment received. Your booking for ${itemName} is waiting for store confirmation.`, adminTitle: 'Service payment received', adminAction: 'Review the booking and confirm it with the customer.' }
    case 'student_registration.paid':
    case 'student_registration.created': return { customerTitle: 'Registration received', customerIntro: `Your registration for ${itemName} has been received. ${storeName} will contact you with the next steps.`, adminTitle: 'Registration received', adminAction: 'Review the registration and follow up with the student.' }
    case 'donation.confirmed':
    case 'donation.created': return { customerTitle: 'Thank you for your donation', customerIntro: `Thank you for supporting ${storeName}. Your donation has been received.`, adminTitle: 'New donation received', adminAction: 'Review the donor record and update any programme notes if needed.' }
    case 'volunteer.created': return { customerTitle: 'Volunteer application received', customerIntro: `Thank you for applying to volunteer with ${storeName}. Your application has been received.`, adminTitle: 'New volunteer application', adminAction: 'Review the volunteer application and contact the applicant.' }
    case 'support_request.created': return { customerTitle: 'We received your request', customerIntro: `${storeName} has received your support request. The team will review it and respond as soon as possible.`, adminTitle: 'New support request', adminAction: 'Review the request and decide the next support action.' }
    case 'event_registration.confirmed':
    case 'event_registration.created': return { customerTitle: 'Seat reserved / Registration confirmed', customerIntro: `Your seat for ${itemName} has been reserved by ${storeName}.`, adminTitle: 'Event seat reserved', adminAction: 'Review the registration and confirm attendance where needed.' }
    default: return { customerTitle: titleCase(eventType || 'Notification'), customerIntro: `${storeName} has received your request for ${itemName}.`, adminTitle: titleCase(eventType || 'New notification'), adminAction: 'Review this notification in Sedifex.' }
  }
}

function detailRows(payload: NotificationPayload, itemName: string) {
  const rows: Array<[string, string | null]> = []
  const customer = payload.customer ?? {}
  const payment = payload.payment ?? {}
  rows.push(['Reference', text(payload.reference ?? payment.reference, 220) || null])
  rows.push(['Item / service', itemName || null])
  rows.push(['Customer', text(customer.name, 180) || null])
  rows.push(['Phone', text(customer.phone, 80) || null])
  rows.push(['Email', email(customer.email) || null])
  rows.push(['Amount', formatMoney(payment)])
  rows.push(['Payment', text(payment.status, 80) ? titleCase(text(payment.status, 80)) : null])
  rows.push(['Method', text(payment.method, 80) ? titleCase(text(payment.method, 80)) : null])
  const data = payload.data ?? {}
  for (const key of ['bookingDate', 'bookingTime', 'preferredClassTime', 'branch', 'location', 'totalAmount', 'amountReceived', 'amountOutstanding', 'receiptNumber', 'deliveryStatus', 'fulfillmentStatus', 'deliveredAt', 'deliveredBy', 'deliveryNote', 'deliveryReference', 'skill', 'availability', 'notes', 'needSummary']) {
    const value = text(data[key], 1000)
    if (value) rows.push([titleCase(key), value])
  }
  return rows.filter(([, value]) => Boolean(value))
}

function rowsHtml(rows: Array<[string, string | null]>) {
  return rows.map(([label, value]) => `<tr><td style="padding:9px 0;color:#64748b;font-size:13px;width:38%;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:9px 0;color:#111827;font-size:14px;font-weight:700;vertical-align:top;">${escapeHtml(value)}</td></tr>`).join('')
}

function buildHtmlEmail(args: { brand: StoreBrand; title: string; intro: string; rows: Array<[string, string | null]>; footerNote: string; actionText?: string }) {
  const brandColor = args.brand.brandColor || DEFAULT_BRAND_COLOR
  const safeStore = escapeHtml(args.brand.storeName)
  const logo = args.brand.logoUrl ? `<img src="${escapeHtml(args.brand.logoUrl)}" alt="${safeStore}" style="height:42px;max-width:180px;object-fit:contain;display:block;margin-bottom:12px;" />` : `<div style="font-weight:900;font-size:24px;letter-spacing:-0.04em;margin-bottom:8px;">${safeStore}</div>`
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;"><div style="padding:28px 16px;background:#f5f7fb;"><div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:22px;overflow:hidden;box-shadow:0 24px 80px rgba(15,23,42,0.08);"><div style="background:${escapeHtml(brandColor)};padding:24px 26px;color:#ffffff;">${logo}<p style="margin:0;color:rgba(255,255,255,0.82);font-size:13px;font-weight:700;">Powered by Sedifex</p></div><div style="padding:28px 26px;"><h1 style="margin:0 0 10px;font-size:26px;line-height:1.15;letter-spacing:-0.04em;color:#111827;">${escapeHtml(args.title)}</h1><p style="margin:0;color:#475569;font-size:15px;line-height:1.7;">${escapeHtml(args.intro)}</p>${args.rows.length ? `<div style="margin:22px 0;border:1px solid #e5e7eb;background:#f8fafc;border-radius:16px;padding:14px 18px;"><table style="width:100%;border-collapse:collapse;">${rowsHtml(args.rows)}</table></div>` : ''}${args.actionText ? `<p style="margin:0 0 12px;color:#111827;font-size:14px;line-height:1.6;"><strong>Next step:</strong> ${escapeHtml(args.actionText)}</p>` : ''}<p style="margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.6;">${escapeHtml(args.footerNote)}</p></div><div style="padding:18px 26px;background:#f8fafc;border-top:1px solid #e5e7eb;color:#64748b;font-size:12px;line-height:1.55;"><p style="margin:0;">This email was sent by ${safeStore} through Sedifex.</p>${args.brand.email ? `<p style="margin:4px 0 0;">Contact: ${escapeHtml(args.brand.email)}${args.brand.phone ? ` · ${escapeHtml(args.brand.phone)}` : ''}</p>` : ''}</div></div></div></body></html>`
}

function buildTextEmail(title: string, intro: string, rows: Array<[string, string | null]>, action?: string) {
  const details = rows.map(([label, value]) => `${label}: ${value}`).join('\n')
  return [title, '', intro, details ? `\nDetails\n${details}` : '', action ? `\nNext step: ${action}` : ''].filter(Boolean).join('\n')
}

async function fetchStoreBrand(storeId: string): Promise<StoreBrand> {
  const snap = await defaultDb.collection('stores').doc(storeId).get()
  const data = snap.data() ?? {}
  const storeName = text(data.displayName, 160) || text(data.businessName, 160) || text(data.name, 160) || 'Sedifex Store'
  const emailAddress = email(data.email) || email(data.ownerEmail) || email(data.firstSignupEmail) || null
  return { storeId, storeName, logoUrl: text(data.logoUrl, 900) || null, brandColor: text(data.brandColor, 40) || DEFAULT_BRAND_COLOR, email: emailAddress, phone: text(data.phone, 80) || null, publicUrl: text(data.publicUrl ?? data.websiteUrl, 900) || null }
}

async function ensureNotificationSettings(storeId: string, brand?: StoreBrand): Promise<NotificationSettings> {
  const resolvedBrand = brand ?? await fetchStoreBrand(storeId)
  const settingsRef = defaultDb.collection('storeSettings').doc(storeId)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const snap = await settingsRef.get()
  const data = snap.data() ?? {}
  const existing = getNestedRecord(data, 'notifications')
  const existingAdminEmails = Array.isArray(existing.adminEmails) ? existing.adminEmails.map(email).filter(Boolean) : []
  const defaultAdminEmails = existingAdminEmails.length ? existingAdminEmails : [resolvedBrand.email].filter((value): value is string => Boolean(value))
  if (!existing.createdAt) {
    await settingsRef.set({ notifications: { customerEmailEnabled: existing.customerEmailEnabled !== false, storeAlertEnabled: true, adminEmails: defaultAdminEmails, replyToEmail: email(existing.replyToEmail) || resolvedBrand.email || null, mode: text(existing.mode, 40) || 'sedifex_default', customWebhookEnabled: existing.customWebhookEnabled === true, customWebhookUrl: text(existing.customWebhookUrl, 1000) || null, deliveryPreference: notificationDeliveryPreference(existing.deliveryPreference), fallbackToSedifex: existing.fallbackToSedifex !== false, automations: booleanSettings(existing.automations), createdAt: now, updatedAt: now } }, { merge: true })
  } else if (!existingAdminEmails.length && resolvedBrand.email) {
    await settingsRef.set({ notifications: { adminEmails: [resolvedBrand.email], replyToEmail: email(existing.replyToEmail) || resolvedBrand.email, updatedAt: now } }, { merge: true })
  }
  return { customerEmailEnabled: existing.customerEmailEnabled !== false, storeAlertEnabled: existing.storeAlertEnabled !== false, adminEmails: defaultAdminEmails, replyToEmail: email(existing.replyToEmail) || resolvedBrand.email, mode: existing.mode === 'custom_webhook' ? 'custom_webhook' : 'sedifex_default', customWebhookEnabled: existing.customWebhookEnabled === true, customWebhookUrl: text(existing.customWebhookUrl, 1000) || null, deliveryPreference: notificationDeliveryPreference(existing.deliveryPreference), fallbackToSedifex: existing.fallbackToSedifex !== false, automations: booleanSettings(existing.automations) }
}



function buildWebhookPayload(payload: Record<string, unknown>) {
  const eventType = text(payload.eventType, 80)
  const data = getRecord(payload.data)
  const customer = getRecord(payload.customer)
  const payment = getRecord(payload.payment)
  const bookingId = getFirstText(data, ['bookingId', 'booking_id', 'id'], 220)
  const bookingStatus = getFirstText(data, ['bookingStatus', 'booking_status', 'status'], 80) || (eventType === 'booking.confirmed' ? 'confirmed' : eventType === 'booking.created' ? 'pending_approval' : '')

  return {
    ...payload,
    bookingId: bookingId || undefined,
    booking_id: bookingId || undefined,
    bookingStatus: bookingStatus || undefined,
    booking_status: bookingStatus || undefined,
    status: bookingStatus || undefined,
    serviceId: getFirstText(data, ['serviceId', 'service_id'], 220) || undefined,
    serviceName: getFirstText(data, ['serviceName', 'service_name', 'itemName', 'productName'], 240) || undefined,
    bookingDate: getFirstText(data, ['bookingDate', 'booking_date', 'preferredDate', 'date'], 80) || undefined,
    bookingTime: getFirstText(data, ['bookingTime', 'booking_time', 'preferredTime', 'time'], 80) || undefined,
    notes: getFirstText(data, ['notes', 'message', 'details'], 2000) || undefined,
    quantity: getFirstText(data, ['quantity'], 20) || undefined,
    customerName: text(customer.name, 240) || undefined,
    customerPhone: text(customer.phone, 80) || undefined,
    customerEmail: email(customer.email) || undefined,
    paymentStatus: getFirstText(payment, ['status'], 80) || undefined,
    payment_status: getFirstText(payment, ['status'], 80) || undefined,
    paymentMethod: getFirstText(payment, ['method'], 80) || undefined,
    paymentAmount: numberValue(payment.amount) ?? undefined,
    paymentReference: getFirstText(payment, ['reference'], 220) || undefined,
    paymentConfirmed: eventType === 'booking.confirmed' || isSettled(payment.status),
  }
}

async function postToWebhook(payload: Record<string, unknown>, settings: NotificationSettings) {
  void settings
  const delivery = await deliverTransactionalEmail({
    storeId: text(payload.storeId, 180),
    eventType: text(payload.eventType, 100),
    reference: text(payload.reference, 220),
    recipientType: text(payload.recipientType, 80),
    to: email(payload.to),
    subject: text(payload.subject, 500),
    html: text(payload.html, 200000),
    text: text(payload.text, 200000),
    brand: getRecord(payload.brand),
    customer: getRecord(payload.customer),
    payment: getRecord(payload.payment),
    data: getRecord(payload.data),
    webhookPayload: buildWebhookPayload(payload),
  })
  return delivery
}

async function createDelivery(args: { payload: NotificationPayload; brand: StoreBrand; settings: NotificationSettings; recipientType: 'customer' | 'store'; to: string; subject: string; html: string; text: string }) {
  const reference = text(args.payload.reference, 220) || `${args.payload.eventType}-${Date.now()}`
  const key = `${args.payload.storeId}|${args.payload.eventType}|${reference}|${args.recipientType}|${args.to}`.replace(/\//g, '_')
  const logRef = defaultDb.collection('notification_delivery_log').doc(key)
  const outboxRef = defaultDb.collection('notification_outbox').doc()
  const activityRef = defaultDb.collection('stores').doc(args.payload.storeId).collection('notificationActivity').doc(outboxRef.id)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const created = await defaultDb.runTransaction(async transaction => {
    const existing = await transaction.get(logRef)
    if (existing.exists) return false
    transaction.set(logRef, { storeId: args.payload.storeId, eventType: args.payload.eventType, reference, recipientType: args.recipientType, to: args.to, outboxId: outboxRef.id, createdAt: now })
    transaction.set(outboxRef, { storeId: args.payload.storeId, eventType: args.payload.eventType, reference, recipientType: args.recipientType, to: args.to, subject: args.subject, html: args.html, text: args.text, brand: args.brand, customer: args.payload.customer ?? null, payment: args.payload.payment ?? null, data: args.payload.data ?? null, status: 'queued', createdAt: now, updatedAt: now })
    transaction.set(activityRef, { storeId: args.payload.storeId, eventType: args.payload.eventType, reference, recipientType: args.recipientType, to: args.to, subject: args.subject, status: 'queued', createdAt: now, updatedAt: now })
    return true
  })
  if (!created) return { created: false, webhook: null }
  let sheetSyncStatus: 'synced_to_sheet' | 'sheet_sync_failed' | 'sheet_sync_skipped' = 'sheet_sync_skipped'
  try {
    await appendNotificationOutboxRow([
      new Date().toISOString(),
      args.payload.storeId,
      args.brand.storeName,
      args.payload.eventType,
      reference,
      args.recipientType,
      args.to,
      args.subject,
      text(args.payload.payment?.status, 80) || '',
      formatMoney(args.payload.payment) || '',
      text(args.payload.payment?.method, 80) || '',
      email(args.payload.customer?.email) || '',
      text(args.payload.customer?.phone, 80) || '',
      text(args.payload.data?.itemName, 220) || '',
      getDefaultSpreadsheetId(),
    ])
    sheetSyncStatus = 'synced_to_sheet'
  } catch (error) {
    sheetSyncStatus = 'sheet_sync_failed'
    await outboxRef.set({ sheetSyncError: error instanceof Error ? error.message : 'sheet-sync-error', updatedAt: now }, { merge: true })
  }
  try {
    const webhook = await postToWebhook({ storeId: args.payload.storeId, eventType: args.payload.eventType, reference, recipientType: args.recipientType, to: args.to, subject: args.subject, html: args.html, text: args.text, brand: args.brand, customer: args.payload.customer ?? null, payment: args.payload.payment ?? null, data: args.payload.data ?? null }, args.settings)
    if (webhook.attempted) {
      const deliveryUpdate = {
        status: webhook.ok ? 'delivery_accepted' : 'delivery_failed',
        webhookStatus: webhook.status,
        deliveryChannel: webhook.channel,
        deliveryStatus: webhook.deliveryStatus,
        senderName: webhook.senderName || null,
        senderEmail: webhook.senderEmail || null,
        replyToEmail: webhook.replyToEmail || null,
        deliveryReason: webhook.reason || null,
        sentToWebhookAt: now,
        sheetSyncStatus,
        updatedAt: now,
      }
      await Promise.all([outboxRef.set(deliveryUpdate, { merge: true }), activityRef.set(deliveryUpdate, { merge: true })])
    }
    if (!webhook.attempted) {
      const deliveryUpdate = {
        status: 'queued_no_live_sender',
        deliveryChannel: webhook.channel,
        deliveryStatus: webhook.deliveryStatus,
        senderName: webhook.senderName || null,
        replyToEmail: webhook.replyToEmail || null,
        deliveryReason: webhook.reason || null,
        sheetSyncStatus,
        updatedAt: now,
      }
      await Promise.all([outboxRef.set(deliveryUpdate, { merge: true }), activityRef.set(deliveryUpdate, { merge: true })])
    }
    return { created: true, webhook }
  } catch (error) {
    const deliveryUpdate = { status: 'webhook_error', errorMessage: error instanceof Error ? error.message : 'webhook-error', sheetSyncStatus, updatedAt: now }
    await Promise.all([outboxRef.set(deliveryUpdate, { merge: true }), activityRef.set(deliveryUpdate, { merge: true })])
    return { created: true, webhook: { attempted: true, ok: false, status: null } }
  }
}

export async function queueBrandedNotification(payload: NotificationPayload) {
  const storeId = text(payload.storeId, 180)
  if (!storeId) return { ok: false, reason: 'missing-store-id' }
  const brand = await fetchStoreBrand(storeId)
  const settings = await ensureNotificationSettings(storeId, brand)
  if (settings.automations[payload.eventType] === false) {
    return { ok: true, deliveries: 0, reference: text(payload.reference ?? payload.payment?.reference, 220) || `${payload.eventType}-${Date.now()}`, skipped: true, reason: 'automation-disabled' }
  }
  const itemName = getDataItemName(payload.data)
  const copy = eventCopy(payload.eventType, brand.storeName, itemName)
  const rows = detailRows(payload, itemName)
  const customerName = text(payload.customer?.name, 160) || 'there'
  const reference = text(payload.reference ?? payload.payment?.reference, 220) || `${payload.eventType}-${Date.now()}`
  const deliveries: Array<Promise<{ created: boolean; webhook: unknown }>> = []
  const customerEmail = email(payload.customer?.email)
  if (settings.customerEmailEnabled && customerEmail) {
    const title = copy.customerTitle
    const intro = `Hello ${customerName}, ${copy.customerIntro}`
    deliveries.push(createDelivery({ payload: { ...payload, reference }, brand, settings, recipientType: 'customer', to: customerEmail, subject: `${title} - ${brand.storeName}`, html: buildHtmlEmail({ brand, title, intro, rows, footerNote: 'Keep this email for your records. If you did not receive this order or there is a problem, contact the store or Sedifex support as soon as possible.' }), text: buildTextEmail(title, intro, rows) }))
  }
  const forceStoreAlert = payload.forceStoreAlert || REQUIRED_STORE_ALERT_EVENTS.has(payload.eventType)
  const adminEmails = settings.adminEmails.length ? settings.adminEmails : [brand.email].filter((value): value is string => Boolean(value))
  if ((settings.storeAlertEnabled || forceStoreAlert) && adminEmails.length) {
    const amount = formatMoney(payload.payment)
    const title = copy.adminTitle
    const intro = amount ? `${title}. Amount: ${amount}.` : title
    for (const to of adminEmails) {
      deliveries.push(createDelivery({ payload: { ...payload, reference }, brand, settings, recipientType: 'store', to, subject: amount ? `${title} - ${amount}` : `${title} - ${brand.storeName}`, html: buildHtmlEmail({ brand, title, intro, rows, actionText: copy.adminAction, footerNote: 'This store alert is enabled automatically for customer and money-related events.' }), text: buildTextEmail(title, intro, rows, copy.adminAction) }))
    }
  }
  const results = await Promise.all(deliveries)
  return { ok: true, deliveries: results.length, reference }
}

export const initializeStoreNotificationDefaults = functions.firestore.document('stores/{storeId}').onWrite(async (_change, context) => { const storeId = text(context.params.storeId, 180); if (storeId) await ensureNotificationSettings(storeId) })
function isSettled(value: unknown) { const normalized = text(value, 80).toLowerCase().replace(/\s+/g, '_'); return ['paid', 'success', 'confirmed', 'captured', 'completed'].includes(normalized) }
function hasAlreadySettled(before: Record<string, unknown> | null) { if (!before) return false; return isSettled(before.paymentStatus) || isSettled(before.payment_status) || isSettled(before.orderStatus) || isSettled(before.order_status) || isSettled(before.status) }
function normalizedStatus(value: unknown) { return text(value, 80).toLowerCase().trim().replace(/[\s-]+/g, '_') }
function isDeliveryTerminalStatus(value: unknown) { return ['delivered', 'delivered_by_store', 'confirmed_by_customer', 'customer_confirmed', 'picked_up', 'pickedup'].includes(normalizedStatus(value)) }
function isFulfillmentCompleteStatus(value: unknown) { return ['completed', 'complete', 'fulfilled', 'delivered', 'picked_up'].includes(normalizedStatus(value)) }
function isOrderDeliveredStatus(value: unknown) { return ['delivered', 'delivered_by_store', 'confirmed_by_customer', 'picked_up'].includes(normalizedStatus(value)) }
function isDeliveredRecord(data: Record<string, unknown> | null) {
  if (!data) return false
  return isDeliveryTerminalStatus(data.deliveryStatus ?? data.delivery_status)
    || isFulfillmentCompleteStatus(data.fulfillmentStatus ?? data.fulfillment_status)
    || isOrderDeliveredStatus(data.orderStatus ?? data.order_status ?? data.status)
}
function hasAlreadyDelivered(before: Record<string, unknown> | null) {
  if (!before) return false
  return before.customerDeliveredEmailSent === true || before.customerDeliveryEmailSent === true || isDeliveredRecord(before)
}
function paymentFromOrder(data: Record<string, unknown>): PaymentInfo { return { status: text(data.paymentStatus ?? data.payment_status ?? data.orderStatus ?? data.order_status ?? data.status, 80) || null, amount: numberValue(data.amountPaid ?? data.amount), currency: text(data.currency, 20) || 'GHS', method: text(data.paymentCollectionMode ?? data.paymentMethod ?? data.sourceChannel, 80) || null, reference: text(data.paymentReference ?? data.payment_reference ?? data.paystackReference ?? data.reference, 220) || null } }
function customerFromRecord(data: Record<string, unknown>): CustomerInfo { const customer = getNestedRecord(data, 'customer'); const person = getNestedRecord(data, 'person'); return { name: text(customer.name ?? person.name ?? data.customerName ?? data.name, 160) || null, email: email(customer.email ?? person.email ?? data.customerEmail ?? data.email) || null, phone: text(customer.phone ?? person.phone ?? data.customerPhone ?? data.phone, 80) || null } }
function isGenericSourceLabel(value: string) {
  const normalized = value.toLowerCase().trim().replace(/\s+/g, ' ')
  return ['sedifex checkout', 'sedifex market', 'checkout', 'marketplace checkout'].includes(normalized)
}

function orderData(data: Record<string, unknown>) {
  const firstItem = Array.isArray(data.items) && data.items.length ? getRecord(data.items[0]) : {}
  const pricingSnapshot = getNestedRecord(data, 'pricingSnapshot')
  const pricingSnapshotLegacy = getNestedRecord(data, 'pricing_snapshot')
  const snapshotItem = Array.isArray(pricingSnapshot.items) && pricingSnapshot.items.length ? getRecord(pricingSnapshot.items[0]) : {}
  const snapshotLegacyItem = Array.isArray(pricingSnapshotLegacy.items) && pricingSnapshotLegacy.items.length ? getRecord(pricingSnapshotLegacy.items[0]) : {}
  const nestedData = getNestedRecord(data, 'data')
  const deliveryProof = getNestedRecord(data, 'deliveryProof')
  const directName = getFirstText(firstItem, ['name', 'title', 'serviceName', 'productName', 'itemName'], 220)
    || getFirstText(snapshotItem, ['name', 'title', 'serviceName', 'productName', 'itemName'], 220)
    || getFirstText(snapshotLegacyItem, ['name', 'title', 'serviceName', 'productName', 'itemName'], 220)
    || getFirstText(data, ['itemName', 'serviceName', 'productName'], 220)
    || getFirstText(nestedData, ['itemName', 'serviceName', 'productName', 'course'], 220)

  const sourceLabel = getFirstText(data, ['sourceLabel', 'source_label'], 220)
  const sourceFallback = sourceLabel && !isGenericSourceLabel(sourceLabel) ? sourceLabel : ''
  const finalFallback = getFirstText(data, ['serviceName'], 220) ? 'your service' : 'your item'

  return {
    itemName: directName || sourceFallback || finalFallback,
    deliveryStatus: text(data.deliveryStatus ?? data.delivery_status, 80),
    fulfillmentStatus: text(data.fulfillmentStatus ?? data.fulfillment_status, 80),
    deliveredAt: text(data.deliveredAt ?? data.delivered_at, 120),
    deliveredBy: text(data.deliveredBy ?? data.delivered_by, 120),
    deliveryNote: getFirstText(data, ['deliveryNote', 'delivery_note'], 1000) || getFirstText(deliveryProof, ['note', 'message'], 1000),
    deliveryReference: getFirstText(data, ['deliveryReference', 'delivery_reference'], 220) || getFirstText(deliveryProof, ['reference', 'code'], 220),
    notes: getFirstText(nestedData, ['notes', 'message'], 1000) || getFirstText(data, ['notes'], 1000),
  }
}

export const notifyIntegrationOrderStatus = functions.firestore.document('integrationOrders/{reference}').onWrite(async (change, context) => {
  if (!change.after.exists) return
  const data = change.after.data() as Record<string, unknown>
  const before = change.before.exists ? change.before.data() as Record<string, unknown> : null
  const storeId = text(data.storeId ?? data.merchantId, 180)
  if (!storeId) return
  const payment = paymentFromOrder(data)
  const reference = text(context.params.reference, 220) || payment.reference
  const orderStatus = text(data.orderStatus ?? data.order_status ?? data.status, 80).toLowerCase()
  const paymentMode = text(data.paymentCollectionMode ?? data.paymentMethod, 80).toLowerCase()

  if (isDeliveredRecord(data) && !hasAlreadyDelivered(before)) {
    const result = await queueBrandedNotification({ eventType: 'order.delivered', storeId, reference, customer: customerFromRecord(data), payment, data: orderData(data), forceStoreAlert: false })
    await change.after.ref.set({
      customerDeliveredEmailSent: true,
      customerDeliveredEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      deliveryConfirmationNotification: {
        eventType: 'order.delivered',
        reference,
        queuedAt: admin.firestore.FieldValue.serverTimestamp(),
        deliveries: result.ok ? result.deliveries : 0,
      },
    }, { merge: true })
    return
  }

  if ((paymentMode.includes('delivery') || orderStatus.includes('cash_collection')) && !change.before.exists) {
    await queueBrandedNotification({ eventType: 'order.pay_on_delivery', storeId, reference, customer: customerFromRecord(data), payment, data: orderData(data), forceStoreAlert: true })
    return
  }
  const nowSettled = isSettled(payment.status) || isSettled(orderStatus)
  if (!nowSettled || hasAlreadySettled(before)) return
  await queueBrandedNotification({ eventType: 'order.confirmed', storeId, reference, customer: customerFromRecord(data), payment, data: orderData(data), forceStoreAlert: true })
})

export const notifyStudentRegistrationCreated = functions.firestore.document('student_registrations/{registrationId}').onCreate(async (snapshot, context) => {
  const data = snapshot.data() as Record<string, unknown>
  const nested = getNestedRecord(data, 'data')
  const payment = getNestedRecord(data, 'payment')
  const storeId = text(data.storeId, 180)
  if (!storeId) return
  await queueBrandedNotification({ eventType: isSettled(payment.status) ? 'student_registration.paid' : 'student_registration.created', storeId, reference: text(payment.reference, 220) || context.params.registrationId, customer: customerFromRecord(data), payment: { status: text(payment.status, 80) || null, amount: numberValue(payment.amount), currency: text(payment.currency, 20) || 'GHS', method: text(payment.mode, 80) || null, reference: text(payment.reference, 220) || null }, data: { course: text(nested.course, 220), preferredClassTime: text(nested.preferredClassTime, 180), branch: text(nested.branch, 180), notes: text(nested.notes, 1000) }, forceStoreAlert: true })
})

export const notifyVolunteerApplicationCreated = functions.firestore.document('volunteer_applications/{applicationId}').onCreate(async (snapshot, context) => {
  const data = snapshot.data() as Record<string, unknown>
  const storeId = text(data.storeId, 180)
  if (!storeId) return
  const details = getNestedRecord(data, 'data')
  await queueBrandedNotification({ eventType: 'volunteer.created', storeId, reference: context.params.applicationId, customer: customerFromRecord(data), data: { skill: text(details.skill, 180), availability: text(details.availability, 180), preferredProject: text(details.preferredProject, 180), location: text(details.location, 180), notes: text(details.notes, 1000) }, forceStoreAlert: true })
})

export const notifySupportRequestCreated = functions.firestore.document('support_requests/{requestId}').onCreate(async (snapshot, context) => {
  const data = snapshot.data() as Record<string, unknown>
  const storeId = text(data.storeId, 180)
  if (!storeId) return
  const details = getNestedRecord(data, 'data')
  await queueBrandedNotification({ eventType: 'support_request.created', storeId, reference: context.params.requestId, customer: customerFromRecord(data), data: { supportType: text(details.supportType, 180), needSummary: text(details.needSummary, 1000), location: text(details.location, 180), notes: text(details.notes, 1000) }, forceStoreAlert: true })
})

export const notifyDonationCaptured = functions.firestore.document('fund_transactions/{transactionId}').onWrite(async (change, context) => {
  if (!change.after.exists) return
  const data = change.after.data() as Record<string, unknown>
  const before = change.before.exists ? change.before.data() as Record<string, unknown> : null
  const storeId = text(data.storeId, 180)
  const direction = text(data.direction, 40).toLowerCase()
  const paymentRecord = getNestedRecord(data, 'payment')
  const status = text(data.status ?? paymentRecord.status, 80)
  if (!storeId || direction === 'outflow') return
  if (!isSettled(status) || hasAlreadySettled(before)) return
  await queueBrandedNotification({ eventType: 'donation.confirmed', storeId, reference: text(data.paymentReference ?? data.providerReference ?? paymentRecord.reference, 220) || context.params.transactionId, customer: customerFromRecord(data), payment: { status, amount: numberValue(data.confirmedAmount ?? data.amount ?? paymentRecord.amountPaid ?? paymentRecord.amount), currency: text(paymentRecord.currency, 20) || 'GHS', method: text(paymentRecord.provider, 80) || 'paystack', reference: text(data.paymentReference ?? data.providerReference ?? paymentRecord.reference, 220) || null }, data: { project: text(data.project, 220), category: text(data.category, 220), notes: text(data.description, 1000) }, forceStoreAlert: true })
})

export const sendBrandedNotificationPreview = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  if (!storeId) throw new functions.https.HttpsError('invalid-argument', 'storeId is required')
  return queueBrandedNotification({ eventType: text(data?.eventType, 100) || 'order.confirmed', storeId, reference: text(data?.reference, 220) || `PREVIEW-${Date.now()}`, customer: { name: text(data?.customerName, 160) || 'Customer', email: email(data?.customerEmail) || null, phone: text(data?.customerPhone, 80) || null }, payment: { status: 'success', amount: numberValue(data?.amount) ?? 100, currency: 'GHS', method: 'online' }, data: { itemName: text(data?.itemName, 220) || 'Sample item', notes: 'This is a branded Sedifex notification preview.' }, forceStoreAlert: true })
})