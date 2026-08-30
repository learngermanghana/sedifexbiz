import * as functions from 'firebase-functions/v1'
import { defineString } from 'firebase-functions/params'
import { admin, defaultDb } from './firestore'
import { appendNotificationOutboxRow, getDefaultSpreadsheetId } from './googleSheets'
import { deliverTransactionalEmail } from './emailDelivery'
import {
  calculateSmsCredits,
  formatSmsAddress,
  loadSmsRateTable,
  resolveStoreSmsGateway,
  sendSmsViaHubtel,
} from './smsGateway'

const TIME_ZONE = 'Africa/Accra'
const SEDIFEX_NOTIFICATION_WEBHOOK_URL = defineString('SEDIFEX_NOTIFICATION_WEBHOOK_URL', { default: '' })
const SEDIFEX_NOTIFICATION_SHARED_SECRET = defineString('SEDIFEX_NOTIFICATION_SHARED_SECRET', { default: '' })
const PAYMENT_REMINDER_DAYS = new Set([14, 7, 3, 1])
const APPROVAL_REMINDER_DAYS = new Set([7, 3, 1])
const SMS_RETRY_MINUTES = 60
const SMS_MAX_ATTEMPTS = 3

type RecordMap = Record<string, unknown>
type RecipientKind = 'client' | 'vendor' | 'staff'
type CommunicationStage =
  | 'approval_request'
  | 'approval_reminder'
  | 'payment_reminder'
  | 'vendor_confirmation'
  | 'vendor_event_reminder'
  | 'staff_assignment'
  | 'staff_assignment_updated'
  | 'staff_event_reminder'
  | 'client_event_reminder'
  | 'client_thank_you'
  | 'vendor_thank_you'

type Recipient = {
  id: string
  kind: RecipientKind
  name: string
  email: string
  phone: string
  role?: string
  callTime?: string
}

type CommunicationSettings = {
  enabled: boolean
  emailEnabled: boolean
  smsEnabled: boolean
  paymentRemindersEnabled: boolean
  approvalRemindersEnabled: boolean
  vendorNotificationsEnabled: boolean
  staffNotificationsEnabled: boolean
  eventRemindersEnabled: boolean
  postEventThanksEnabled: boolean
  recommendationRequestEnabled: boolean
}

type StoreBrand = {
  storeId: string
  storeName: string
  logoUrl: string | null
  brandColor: string
  email: string | null
  phone: string | null
}

type NotificationSettings = {
  customerEmailEnabled: boolean
  customWebhookEnabled: boolean
  customWebhookUrl: string | null
}

type EventContext = {
  ref: FirebaseFirestore.DocumentReference
  storeId: string
  eventId: string
  data: RecordMap
  storeData: RecordMap
  settings: CommunicationSettings
  brand: StoreBrand
}

function text(value: unknown, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function firstText(values: unknown[], max = 500) {
  for (const value of values) {
    const candidate = text(value, max)
    if (candidate) return candidate
  }
  return ''
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function bool(value: unknown, fallback = true) {
  return typeof value === 'boolean' ? value : fallback
}

function email(value: unknown) {
  const candidate = text(value, 220).toLowerCase()
  return candidate.includes('@') ? candidate : ''
}

function normalizeStatus(value: unknown) {
  return text(value, 80).toLowerCase().replace(/[\s-]+/g, '_')
}

function formatDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function shiftDate(key: string, days: number) {
  const date = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dayDiff(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00.000Z`)
  const b = Date.parse(`${to}T00:00:00.000Z`)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null
}

function displayDate(key: string) {
  if (!key) return 'date to be confirmed'
  const date = new Date(`${key}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return key
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function displayTime(raw: string) {
  const value = raw.trim()
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return value
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return value
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`
}

function money(value: number) {
  return `GHS ${value.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function eventTitle(data: RecordMap) {
  return firstText([data.title, data.eventType], 160) || 'your event'
}

function eventCode(data: RecordMap) {
  return text(data.eventCode, 80)
}

function eventDate(data: RecordMap) {
  return text(data.eventDate, 40)
}

function eventTime(data: RecordMap) {
  return text(data.startTime, 40)
}

function eventVenue(data: RecordMap) {
  return text(data.venue, 220)
}

function eventStatus(data: RecordMap) {
  return normalizeStatus(data.status)
}

function integrations(data: RecordMap) {
  return record(data.integrations)
}

function communicationSettings(eventData: RecordMap, storeData: RecordMap): CommunicationSettings {
  const eventSettings = record(eventData.communicationSettings)
  const storeSettings = record(storeData.eventCommunicationSettings)
  const resolved = (key: string, fallback = true) => {
    if (typeof eventSettings[key] === 'boolean') return eventSettings[key] as boolean
    if (typeof storeSettings[key] === 'boolean') return storeSettings[key] as boolean
    return fallback
  }
  return {
    enabled: resolved('enabled'),
    emailEnabled: resolved('emailEnabled'),
    smsEnabled: resolved('smsEnabled'),
    paymentRemindersEnabled: resolved('paymentRemindersEnabled'),
    approvalRemindersEnabled: resolved('approvalRemindersEnabled'),
    vendorNotificationsEnabled: resolved('vendorNotificationsEnabled'),
    staffNotificationsEnabled: resolved('staffNotificationsEnabled'),
    eventRemindersEnabled: resolved('eventRemindersEnabled'),
    postEventThanksEnabled: resolved('postEventThanksEnabled'),
    recommendationRequestEnabled: resolved('recommendationRequestEnabled'),
  }
}

function storeBrand(storeId: string, data: RecordMap): StoreBrand {
  return {
    storeId,
    storeName: firstText([data.displayName, data.businessName, data.name], 160) || 'Sedifex Store',
    logoUrl: text(data.logoUrl, 900) || null,
    brandColor: text(data.brandColor, 40) || '#4f46e5',
    email: email(data.email) || email(data.ownerEmail) || email(data.firstSignupEmail) || null,
    phone: text(data.phone, 80) || null,
  }
}

async function notificationSettings(storeId: string): Promise<NotificationSettings> {
  const snapshot = await defaultDb.collection('storeSettings').doc(storeId).get()
  const notifications = record(snapshot.data()?.notifications)
  return {
    customerEmailEnabled: notifications.customerEmailEnabled !== false,
    customWebhookEnabled: notifications.customWebhookEnabled === true,
    customWebhookUrl: text(notifications.customWebhookUrl, 1000) || null,
  }
}

function vendorAssignments(data: RecordMap) {
  const raw = integrations(data).vendors
  if (!Array.isArray(raw)) return []
  return raw.flatMap(value => {
    const item = record(value)
    const customerId = text(item.customerId, 220)
    if (!customerId) return []
    return [{
      customerId,
      category: text(item.category, 120) || 'Vendor',
      status: normalizeStatus(item.status) || 'planned',
      notes: text(item.notes, 800),
    }]
  })
}

function staffAssignments(data: RecordMap) {
  const raw = integrations(data).staff
  if (!Array.isArray(raw)) return []
  return raw.flatMap(value => {
    const item = record(value)
    const memberId = text(item.memberId, 220)
    if (!memberId) return []
    return [{
      memberId,
      eventRole: text(item.eventRole, 140) || 'Event support',
      callTime: text(item.callTime, 40),
      notes: text(item.notes, 800),
    }]
  })
}

async function loadClient(context: EventContext): Promise<Recipient | null> {
  const linkedId = text(integrations(context.data).clientCustomerId, 220)
  if (linkedId) {
    const snapshot = await defaultDb.collection('customers').doc(linkedId).get()
    if (snapshot.exists) {
      const data = snapshot.data() as RecordMap
      if (text(data.storeId, 180) === context.storeId) {
        return {
          id: linkedId,
          kind: 'client',
          name: firstText([data.displayName, data.name, context.data.clientName], 160) || 'Client',
          email: email(data.email) || email(context.data.clientEmail),
          phone: text(data.phone, 80) || text(context.data.clientPhone, 80),
        }
      }
      functions.logger.warn('event client link belongs to another store; ignoring linked contact', {
        storeId: context.storeId,
        eventId: context.eventId,
        customerId: linkedId,
      })
    }
  }
  const directName = text(context.data.clientName, 160)
  const directEmail = email(context.data.clientEmail)
  const directPhone = text(context.data.clientPhone, 80)
  if (!directEmail && !directPhone) return null
  return {
    id: `event-client-${context.eventId}`,
    kind: 'client',
    name: directName || 'Client',
    email: directEmail,
    phone: directPhone,
  }
}

async function loadVendor(context: EventContext, customerId: string, role: string): Promise<Recipient | null> {
  const snapshot = await defaultDb.collection('customers').doc(customerId).get()
  if (!snapshot.exists) return null
  const data = snapshot.data() as RecordMap
  if (text(data.storeId, 180) !== context.storeId) {
    functions.logger.warn('event vendor belongs to another store; communication blocked', {
      storeId: context.storeId,
      eventId: context.eventId,
      customerId,
    })
    return null
  }
  return {
    id: customerId,
    kind: 'vendor',
    name: firstText([data.displayName, data.name, data.email, data.phone], 160) || 'Vendor',
    email: email(data.email),
    phone: text(data.phone, 80),
    role,
  }
}

async function loadStaff(context: EventContext, memberId: string, role: string, callTime: string): Promise<Recipient | null> {
  const snapshot = await defaultDb.collection('teamMembers').doc(memberId).get()
  if (!snapshot.exists) return null
  const data = snapshot.data() as RecordMap
  if (text(data.storeId, 180) !== context.storeId) {
    functions.logger.warn('event staff member belongs to another store; communication blocked', {
      storeId: context.storeId,
      eventId: context.eventId,
      memberId,
    })
    return null
  }
  return {
    id: memberId,
    kind: 'staff',
    name: firstText([data.displayName, data.name, data.email], 160) || 'Team member',
    email: email(data.email),
    phone: text(data.phone, 80),
    role,
    callTime,
  }
}

function stageTitle(stage: CommunicationStage) {
  const titles: Record<CommunicationStage, string> = {
    approval_request: 'Agreement ready for your review',
    approval_reminder: 'Agreement approval reminder',
    payment_reminder: 'Event payment reminder',
    vendor_confirmation: 'Event vendor confirmation',
    vendor_event_reminder: 'Event coordination reminder',
    staff_assignment: 'Event staff assignment',
    staff_assignment_updated: 'Event assignment updated',
    staff_event_reminder: 'Event team reminder',
    client_event_reminder: 'Your event reminder',
    client_thank_you: 'Thank you for choosing us',
    vendor_thank_you: 'Thank you for your event support',
  }
  return titles[stage]
}

function introFor(
  stage: CommunicationStage,
  context: EventContext,
  recipient: Recipient,
  extra: { daysUntil?: number; outstanding?: number } = {},
) {
  const title = eventTitle(context.data)
  const date = displayDate(eventDate(context.data))
  const business = context.brand.storeName
  const role = recipient.role ? ` as ${recipient.role}` : ''
  const callTime = recipient.callTime ? ` Your call time is ${displayTime(recipient.callTime)}.` : ''
  switch (stage) {
    case 'approval_request':
      return `${business} has prepared the agreement for ${title}. Please review the terms and contact us if anything needs to be changed before approval.`
    case 'approval_reminder':
      return `This is a reminder that the agreement for ${title} is still awaiting your approval. The event is scheduled for ${date}.`
    case 'payment_reminder':
      return `This is a reminder about the outstanding balance for ${title}. ${extra.outstanding ? `${money(extra.outstanding)} remains to be paid.` : 'A balance remains outstanding.'}`
    case 'vendor_confirmation':
      return `You are confirmed to support ${title}${role} on ${date}. Please review the event details below and contact ${business} if anything needs clarification.`
    case 'vendor_event_reminder':
      return `${title} is ${extra.daysUntil === 0 ? 'today' : 'tomorrow'}. You are scheduled to support the event${role}. Please confirm that your team and deliverables are ready.`
    case 'staff_assignment':
      return `You have been assigned to ${title}${role} on ${date}.${callTime}`
    case 'staff_assignment_updated':
      return `Your assignment for ${title} has been updated${role}.${callTime} Please review the event details below.`
    case 'staff_event_reminder':
      return `${title} is ${extra.daysUntil === 0 ? 'today' : 'tomorrow'}.${role ? ` Your role is ${recipient.role}.` : ''}${callTime}`
    case 'client_event_reminder':
      return `${title} is ${extra.daysUntil === 0 ? 'today' : 'tomorrow'}. We are looking forward to supporting you and have included the latest event details below.`
    case 'client_thank_you':
      return `Thank you for choosing ${business} for ${title}. We appreciate the opportunity to support your event.${context.settings.recommendationRequestEnabled ? ' If you were happy with the experience, we would be grateful if you replied with a recommendation or review.' : ''}`
    case 'vendor_thank_you':
      return `Thank you for supporting ${title}. ${business} appreciates your contribution and coordination with the event team.`
  }
}

function smsFor(
  stage: CommunicationStage,
  context: EventContext,
  recipient: Recipient,
  extra: { daysUntil?: number; outstanding?: number } = {},
) {
  const firstName = recipient.name.split(/\s+/)[0] || 'there'
  const title = eventTitle(context.data).slice(0, 55)
  const date = displayDate(eventDate(context.data)).replace(/,? \d{4}$/, '')
  const venue = eventVenue(context.data).slice(0, 45)
  const business = context.brand.storeName.slice(0, 35)
  if (stage === 'approval_request') return `Hi ${firstName}, ${business} sent the agreement for ${title}. Please review it and contact us with any questions.`
  if (stage === 'approval_reminder') return `Hi ${firstName}, reminder from ${business}: the agreement for ${title} is still awaiting approval. Event: ${date}.`
  if (stage === 'payment_reminder') return `Hi ${firstName}, ${business} reminder: ${extra.outstanding ? `${money(extra.outstanding)} remains for ` : 'a balance remains for '}${title} on ${date}. Please arrange payment or contact us.`
  if (stage === 'vendor_confirmation') return `Hi ${firstName}, you are confirmed for ${title} on ${date}${recipient.role ? ` as ${recipient.role}` : ''}. ${venue ? `Venue: ${venue}. ` : ''}Thank you, ${business}.`
  if (stage === 'vendor_event_reminder') return `Hi ${firstName}, ${title} is ${extra.daysUntil === 0 ? 'today' : 'tomorrow'}${recipient.role ? `; role: ${recipient.role}` : ''}. ${venue ? `Venue: ${venue}. ` : ''}Please confirm readiness.`
  if (stage === 'staff_assignment' || stage === 'staff_assignment_updated') return `Hi ${firstName}, ${stage === 'staff_assignment_updated' ? 'updated assignment' : 'assignment'}: ${title}, ${date}${recipient.role ? `, role ${recipient.role}` : ''}${recipient.callTime ? `, call ${displayTime(recipient.callTime)}` : ''}. ${venue ? `Venue: ${venue}.` : ''}`
  if (stage === 'staff_event_reminder') return `Hi ${firstName}, team reminder: ${title} is ${extra.daysUntil === 0 ? 'today' : 'tomorrow'}${recipient.callTime ? `; call ${displayTime(recipient.callTime)}` : ''}. ${venue ? `Venue: ${venue}.` : ''}`
  if (stage === 'client_event_reminder') return `Hi ${firstName}, ${business} reminder: ${title} is ${extra.daysUntil === 0 ? 'today' : 'tomorrow'}${eventTime(context.data) ? ` at ${displayTime(eventTime(context.data))}` : ''}. ${venue ? `Venue: ${venue}.` : ''}`
  if (stage === 'client_thank_you') return `Hi ${firstName}, thank you for choosing ${business} for ${title}. We appreciate you.${context.settings.recommendationRequestEnabled ? ' If you were happy, please reply with a recommendation or review.' : ''}`
  return `Hi ${firstName}, thank you for supporting ${title}. ${business} appreciates your work and coordination with the event team.`
}

function communicationRows(context: EventContext, recipient: Recipient, extra: { outstanding?: number } = {}) {
  const rows: Array<[string, string]> = []
  const code = eventCode(context.data)
  if (code) rows.push(['Event reference', code])
  rows.push(['Event', eventTitle(context.data)])
  if (eventDate(context.data)) rows.push(['Date', displayDate(eventDate(context.data))])
  if (eventTime(context.data)) rows.push(['Start time', displayTime(eventTime(context.data))])
  if (eventVenue(context.data)) rows.push(['Venue', eventVenue(context.data)])
  if (recipient.role) rows.push(['Role / service', recipient.role])
  if (recipient.callTime) rows.push(['Call time', displayTime(recipient.callTime)])
  if (typeof extra.outstanding === 'number') rows.push(['Outstanding balance', money(extra.outstanding)])
  return rows
}

function escapeHtml(value: unknown) {
  return text(value, 4000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function emailHtml(context: EventContext, title: string, intro: string, rows: Array<[string, string]>) {
  const brand = context.brand
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.storeName)}" style="height:42px;max-width:180px;object-fit:contain;display:block;margin-bottom:12px;" />`
    : `<div style="font-weight:900;font-size:24px;letter-spacing:-0.04em;margin-bottom:8px;">${escapeHtml(brand.storeName)}</div>`
  const rowHtml = rows.map(([label, value]) => `<tr><td style="padding:9px 0;color:#64748b;font-size:13px;width:38%;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:9px 0;color:#111827;font-size:14px;font-weight:700;vertical-align:top;">${escapeHtml(value)}</td></tr>`).join('')
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;"><div style="padding:28px 16px;"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:22px;overflow:hidden;box-shadow:0 24px 80px rgba(15,23,42,.08);"><div style="background:${escapeHtml(brand.brandColor)};padding:24px 26px;color:#fff;">${logo}<p style="margin:0;color:rgba(255,255,255,.82);font-size:13px;font-weight:700;">Powered by Sedifex</p></div><div style="padding:28px 26px;"><h1 style="margin:0 0 10px;font-size:26px;line-height:1.15;color:#111827;">${escapeHtml(title)}</h1><p style="margin:0;color:#475569;font-size:15px;line-height:1.7;">${escapeHtml(intro)}</p><div style="margin:22px 0;border:1px solid #e5e7eb;background:#f8fafc;border-radius:16px;padding:14px 18px;"><table style="width:100%;border-collapse:collapse;">${rowHtml}</table></div><p style="margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.6;">Reply to this email or contact ${escapeHtml(brand.storeName)} if you need to clarify any event detail.</p></div><div style="padding:18px 26px;background:#f8fafc;border-top:1px solid #e5e7eb;color:#64748b;font-size:12px;line-height:1.55;"><p style="margin:0;">This message was sent by ${escapeHtml(brand.storeName)} through Sedifex.</p>${brand.email ? `<p style="margin:4px 0 0;">Contact: ${escapeHtml(brand.email)}${brand.phone ? ` · ${escapeHtml(brand.phone)}` : ''}</p>` : ''}</div></div></div></body></html>`
}

function emailText(title: string, intro: string, rows: Array<[string, string]>) {
  return [title, '', intro, '', ...rows.map(([label, value]) => `${label}: ${value}`)].join('\n')
}

function safeId(value: string) {
  return value.replace(/\//g, '_').slice(0, 1400)
}

async function postEmailWebhook(payload: RecordMap, settings: NotificationSettings) {
  void settings
  return deliverTransactionalEmail({
    storeId: text(payload.storeId, 180),
    eventType: text(payload.eventType, 100),
    reference: text(payload.reference, 220),
    recipientType: text(payload.recipientType, 80),
    to: email(payload.to),
    subject: text(payload.subject, 500),
    html: text(payload.html, 200000),
    text: text(payload.text, 200000),
    brand: record(payload.brand),
    customer: record(payload.customer),
    payment: record(payload.payment),
    data: record(payload.data),
  })
}

async function queueEventEmail(
  context: EventContext,
  stage: CommunicationStage,
  recipient: Recipient,
  reference: string,
  extra: { daysUntil?: number; outstanding?: number } = {},
) {
  if (!context.settings.emailEnabled || !recipient.email) return { sent: false, reason: 'email-disabled-or-missing' }
  const settings = await notificationSettings(context.storeId)
  if (!settings.customerEmailEnabled) return { sent: false, reason: 'store-customer-email-disabled' }

  const title = stageTitle(stage)
  const intro = `Hello ${recipient.name || 'there'}, ${introFor(stage, context, recipient, extra)}`
  const rows = communicationRows(context, recipient, extra)
  const subject = `${title} - ${context.brand.storeName}`
  const html = emailHtml(context, title, intro, rows)
  const plainText = emailText(title, intro, rows)
  const eventType = `event.${stage}`
  const logKey = safeId(`${context.storeId}|${eventType}|${reference}|customer|${recipient.email}`)
  const deliveryLogRef = defaultDb.collection('notification_delivery_log').doc(logKey)
  const outboxRef = defaultDb.collection('notification_outbox').doc()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const created = await defaultDb.runTransaction(async transaction => {
    const existing = await transaction.get(deliveryLogRef)
    if (existing.exists) return false
    transaction.set(deliveryLogRef, {
      storeId: context.storeId,
      eventType,
      reference,
      recipientType: 'customer',
      recipientKind: recipient.kind,
      eventId: context.eventId,
      to: recipient.email,
      outboxId: outboxRef.id,
      createdAt: now,
    })
    transaction.set(outboxRef, {
      storeId: context.storeId,
      eventType,
      reference,
      recipientType: 'customer',
      recipientKind: recipient.kind,
      eventId: context.eventId,
      to: recipient.email,
      subject,
      html,
      text: plainText,
      brand: context.brand,
      customer: { name: recipient.name, email: recipient.email, phone: recipient.phone || null },
      data: {
        itemName: eventTitle(context.data),
        eventId: context.eventId,
        eventCode: eventCode(context.data),
        eventDate: eventDate(context.data),
        eventTime: eventTime(context.data),
        venue: eventVenue(context.data),
        role: recipient.role || null,
        callTime: recipient.callTime || null,
        stage,
        outstandingBalance: extra.outstanding ?? null,
      },
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    return true
  })
  if (!created) return { sent: false, reason: 'duplicate' }

  let sheetSyncStatus = 'sheet_sync_skipped'
  try {
    await appendNotificationOutboxRow([
      new Date().toISOString(),
      context.storeId,
      context.brand.storeName,
      eventType,
      reference,
      'customer',
      recipient.email,
      subject,
      stage === 'payment_reminder' ? 'pending' : '',
      typeof extra.outstanding === 'number' ? money(extra.outstanding) : '',
      '',
      recipient.email,
      recipient.phone,
      eventTitle(context.data),
      getDefaultSpreadsheetId(),
    ])
    sheetSyncStatus = 'synced_to_sheet'
  } catch (error) {
    sheetSyncStatus = 'sheet_sync_failed'
    await outboxRef.set({ sheetSyncError: error instanceof Error ? error.message : 'sheet-sync-error', updatedAt: now }, { merge: true })
  }

  try {
    const webhook = await postEmailWebhook({
      storeId: context.storeId,
      eventType,
      reference,
      recipientType: 'customer',
      recipientKind: recipient.kind,
      to: recipient.email,
      subject,
      html,
      text: plainText,
      brand: context.brand,
      customer: { name: recipient.name, email: recipient.email, phone: recipient.phone || null },
      data: {
        itemName: eventTitle(context.data),
        eventId: context.eventId,
        eventCode: eventCode(context.data),
        eventDate: eventDate(context.data),
        eventTime: eventTime(context.data),
        venue: eventVenue(context.data),
        role: recipient.role || null,
        callTime: recipient.callTime || null,
        stage,
        outstandingBalance: extra.outstanding ?? null,
      },
    }, settings)
    await outboxRef.set({
      status: webhook.attempted ? (webhook.ok ? 'delivery_accepted' : 'delivery_failed') : 'queued_no_live_sender',
      webhookStatus: webhook.status,
      deliveryChannel: webhook.channel,
      deliveryStatus: webhook.deliveryStatus,
      senderName: webhook.senderName || null,
      senderEmail: webhook.senderEmail || null,
      replyToEmail: webhook.replyToEmail || null,
      deliveryReason: webhook.reason || null,
      sentToWebhookAt: webhook.attempted ? now : null,
      sheetSyncStatus,
      updatedAt: now,
    }, { merge: true })
    return { sent: true, reason: webhook.attempted ? 'webhook' : 'outbox' }
  } catch (error) {
    await outboxRef.set({
      status: 'webhook_error',
      errorMessage: error instanceof Error ? error.message : 'webhook-error',
      sheetSyncStatus,
      updatedAt: now,
    }, { merge: true })
    return { sent: true, reason: 'outbox-webhook-error' }
  }
}

async function eventSmsRunLog(
  context: EventContext,
  stage: CommunicationStage,
  recipient: Recipient,
  message: string,
  phone: string,
  debit: number,
  refund: number,
  status: 'sent' | 'failed',
  error = '',
) {
  try {
    await defaultDb.collection('stores').doc(context.storeId).collection('bulkMessageRuns').add({
      storeId: context.storeId,
      channel: 'sms',
      source: 'event_automation',
      eventId: context.eventId,
      eventCode: eventCode(context.data),
      stage,
      message,
      attempted: 1,
      sent: status === 'sent' ? 1 : 0,
      failed: status === 'failed' ? 1 : 0,
      deliveryStatus: status === 'sent' ? 'all_sent' : 'all_failed',
      creditsDebited: debit,
      creditsRefunded: refund,
      recipients: [{ id: recipient.id, name: recipient.name || null, phone, kind: recipient.kind }],
      failures: error ? [{ phone, error }] : [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  } catch (logError) {
    functions.logger.warn('event SMS audit log failed', {
      storeId: context.storeId,
      eventId: context.eventId,
      error: logError instanceof Error ? logError.message : String(logError),
    })
  }
}

async function sendEventSms(
  context: EventContext,
  stage: CommunicationStage,
  recipient: Recipient,
  reference: string,
  extra: { daysUntil?: number; outstanding?: number } = {},
) {
  if (!context.settings.smsEnabled || !recipient.phone) return { sent: false, reason: 'sms-disabled-or-missing' }
  const phone = formatSmsAddress(recipient.phone)
  if (!phone) return { sent: false, reason: 'invalid-phone' }
  const gateway = resolveStoreSmsGateway(context.storeData)
  if (!gateway) return { sent: false, reason: 'sms-not-configured' }
  const message = smsFor(stage, context, recipient, extra)
  const rates = await loadSmsRateTable()
  const cost = calculateSmsCredits(phone, message, rates)
  const logRef = context.ref.collection('communicationLog').doc(safeId(`${reference}|${recipient.kind}|${recipient.id}|sms`))
  const storeRef = defaultDb.collection('stores').doc(context.storeId)
  const claimId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  let claimed = false
  let claimReason = 'not-claimed'

  await defaultDb.runTransaction(async transaction => {
    const [existing, storeSnapshot] = await Promise.all([transaction.get(logRef), transaction.get(storeRef)])
    const previous = existing.exists ? existing.data() as RecordMap : {}
    const previousStatus = normalizeStatus(previous.status)
    const attempts = Number(previous.attemptCount) || 0
    if (previousStatus === 'sent' || previousStatus === 'sending' || previousStatus === 'unknown') {
      claimReason = 'duplicate-or-in-flight'
      return
    }
    const nextRetryAt = previous.nextRetryAt && typeof (previous.nextRetryAt as { toDate?: () => Date }).toDate === 'function'
      ? (previous.nextRetryAt as { toDate: () => Date }).toDate()
      : null
    if (previousStatus === 'failed' && (attempts >= SMS_MAX_ATTEMPTS || (nextRetryAt && nextRetryAt.getTime() > Date.now()))) {
      claimReason = attempts >= SMS_MAX_ATTEMPTS ? 'max-attempts' : 'backoff'
      return
    }
    if (!storeSnapshot.exists) {
      claimReason = 'store-not-found'
      return
    }
    const currentStore = storeSnapshot.data() as RecordMap
    if (!resolveStoreSmsGateway(currentStore)) {
      claimReason = 'sms-not-configured'
      return
    }
    const balance = typeof currentStore.bulkMessagingCredits === 'number' && Number.isFinite(currentStore.bulkMessagingCredits)
      ? currentStore.bulkMessagingCredits
      : 0
    if (balance < cost.credits) {
      claimReason = 'insufficient-credits'
      return
    }
    transaction.update(storeRef, {
      bulkMessagingCredits: balance - cost.credits,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    transaction.set(logRef, {
      storeId: context.storeId,
      eventId: context.eventId,
      eventCode: eventCode(context.data),
      stage,
      reference,
      channel: 'sms',
      recipientId: recipient.id,
      recipientKind: recipient.kind,
      recipientName: recipient.name || null,
      phone,
      message,
      status: 'sending',
      claimId,
      creditsDebited: cost.credits,
      smsSegments: cost.segments,
      rateGroup: cost.group,
      senderId: gateway.senderId,
      attemptCount: attempts + 1,
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      nextRetryAt: null,
      lastError: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: existing.exists ? previous.createdAt || admin.firestore.FieldValue.serverTimestamp() : admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
    claimed = true
    claimReason = 'claimed'
  })

  if (!claimed) return { sent: false, reason: claimReason }

  try {
    const receipt = await sendSmsViaHubtel({ gateway, to: phone, body: message })
    await logRef.set({
      status: 'sent',
      provider: 'hubtel',
      providerMessageId: receipt.messageId,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true })
    await eventSmsRunLog(context, stage, recipient, message, phone, cost.credits, 0, 'sent')
    return { sent: true, reason: 'sent' }
  } catch (sendError) {
    const safeError = (sendError instanceof Error ? sendError.message : 'event-sms-send-failed').slice(0, 500)
    await defaultDb.runTransaction(async transaction => {
      const current = await transaction.get(logRef)
      if (!current.exists) return
      const data = current.data() as RecordMap
      if (text(data.claimId, 200) !== claimId || normalizeStatus(data.status) !== 'sending') return
      transaction.update(storeRef, {
        bulkMessagingCredits: admin.firestore.FieldValue.increment(cost.credits),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      transaction.set(logRef, {
        status: 'failed',
        lastError: safeError,
        creditsRefunded: cost.credits,
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        nextRetryAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + SMS_RETRY_MINUTES * 60000)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    })
    await eventSmsRunLog(context, stage, recipient, message, phone, cost.credits, cost.credits, 'failed', safeError)
    return { sent: false, reason: 'failed' }
  }
}

async function dispatch(
  context: EventContext,
  stage: CommunicationStage,
  recipient: Recipient | null,
  reference: string,
  extra: { daysUntil?: number; outstanding?: number } = {},
) {
  if (!context.settings.enabled || !recipient || (!recipient.email && !recipient.phone)) return
  const results = await Promise.allSettled([
    queueEventEmail(context, stage, recipient, reference, extra),
    sendEventSms(context, stage, recipient, reference, extra),
  ])
  functions.logger.info('event communication dispatched', {
    storeId: context.storeId,
    eventId: context.eventId,
    stage,
    recipientKind: recipient.kind,
    recipientId: recipient.id,
    results: results.map(result => result.status === 'fulfilled' ? result.value : { error: result.reason instanceof Error ? result.reason.message : String(result.reason) }),
  })
}

async function loadContext(storeId: string, eventId: string, data: RecordMap): Promise<EventContext | null> {
  const storeRef = defaultDb.collection('stores').doc(storeId)
  const storeSnapshot = await storeRef.get()
  if (!storeSnapshot.exists) return null
  const storeData = storeSnapshot.data() as RecordMap
  return {
    ref: storeRef.collection('events').doc(eventId),
    storeId,
    eventId,
    data,
    storeData,
    settings: communicationSettings(data, storeData),
    brand: storeBrand(storeId, storeData),
  }
}

function assignmentFingerprint(value: { eventRole: string; callTime: string; notes: string }) {
  return `${value.eventRole}|${value.callTime}|${value.notes}`
}

async function handleImmediateCommunications(storeId: string, eventId: string, before: RecordMap, after: RecordMap) {
  const context = await loadContext(storeId, eventId, after)
  if (!context || !context.settings.enabled) return
  const tasks: Promise<unknown>[] = []

  const beforeContract = record(before.contractApproval)
  const afterContract = record(after.contractApproval)
  const beforeContractStatus = normalizeStatus(beforeContract.status)
  const afterContractStatus = normalizeStatus(afterContract.status)
  if (context.settings.approvalRemindersEnabled && afterContractStatus === 'sent' && beforeContractStatus !== 'sent') {
    const revision = Math.max(1, Number(afterContract.revision) || 1)
    tasks.push(loadClient(context).then(recipient => dispatch(context, 'approval_request', recipient, `${eventId}-approval-r${revision}`)))
  }

  if (context.settings.vendorNotificationsEnabled) {
    const beforeVendors = new Map(vendorAssignments(before).map(item => [item.customerId, item]))
    for (const vendor of vendorAssignments(after)) {
      const previous = beforeVendors.get(vendor.customerId)
      if (vendor.status === 'confirmed' && previous?.status !== 'confirmed') {
        tasks.push(loadVendor(context, vendor.customerId, vendor.category).then(recipient => dispatch(context, 'vendor_confirmation', recipient, `${eventId}-vendor-confirmed-${vendor.customerId}`)))
      }
    }
  }

  if (context.settings.staffNotificationsEnabled) {
    const beforeStaff = new Map(staffAssignments(before).map(item => [item.memberId, item]))
    for (const assignment of staffAssignments(after)) {
      const previous = beforeStaff.get(assignment.memberId)
      const stage: CommunicationStage | null = !previous
        ? 'staff_assignment'
        : assignmentFingerprint(previous) !== assignmentFingerprint(assignment)
          ? 'staff_assignment_updated'
          : null
      if (stage) {
        const version = safeId(`${assignment.eventRole}-${assignment.callTime}-${assignment.notes}`)
        tasks.push(loadStaff(context, assignment.memberId, assignment.eventRole, assignment.callTime).then(recipient => dispatch(context, stage, recipient, `${eventId}-${stage}-${assignment.memberId}-${version}`)))
      }
    }
  }

  if (context.settings.postEventThanksEnabled && eventStatus(after) === 'completed' && eventStatus(before) !== 'completed') {
    tasks.push(loadClient(context).then(recipient => dispatch(context, 'client_thank_you', recipient, `${eventId}-client-thank-you`)))
    if (context.settings.vendorNotificationsEnabled) {
      for (const vendor of vendorAssignments(after).filter(item => !['cancelled'].includes(item.status))) {
        tasks.push(loadVendor(context, vendor.customerId, vendor.category).then(recipient => dispatch(context, 'vendor_thank_you', recipient, `${eventId}-vendor-thank-you-${vendor.customerId}`)))
      }
    }
  }

  await Promise.allSettled(tasks)
}

export const automateEventCommunicationsOnWrite = functions.firestore
  .document('stores/{storeId}/events/{eventId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null
    const storeId = text(context.params.storeId, 180)
    const eventId = text(context.params.eventId, 220)
    if (!storeId || !eventId) return null
    const before = change.before.exists ? change.before.data() as RecordMap : {}
    const after = change.after.data() as RecordMap
    try {
      await handleImmediateCommunications(storeId, eventId, before, after)
    } catch (error) {
      functions.logger.error('event immediate communications failed', {
        storeId,
        eventId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  })

async function eventReceivedAmount(storeId: string, eventId: string) {
  const snapshot = await defaultDb.collection('stores').doc(storeId).collection('receipts').where('eventId', '==', eventId).get()
  return snapshot.docs.reduce((sum, document) => {
    const value = numberValue(document.data().amountPaid)
    return sum + Math.max(0, value ?? 0)
  }, 0)
}

async function scheduledEvent(context: EventContext, today: string) {
  if (!context.settings.enabled) return
  const status = eventStatus(context.data)
  const date = eventDate(context.data)
  const daysUntil = date ? dayDiff(today, date) : null
  if (daysUntil === null) return

  if (!['cancelled', 'completed'].includes(status) && PAYMENT_REMINDER_DAYS.has(daysUntil) && context.settings.paymentRemindersEnabled) {
    const contractValue = numberValue(record(integrations(context.data).finance).contractValue)
    if (contractValue && contractValue > 0) {
      const received = await eventReceivedAmount(context.storeId, context.eventId)
      const outstanding = Math.max(contractValue - received, 0)
      if (outstanding > 0.005) {
        const client = await loadClient(context)
        await dispatch(context, 'payment_reminder', client, `${context.eventId}-payment-${daysUntil}d`, { daysUntil, outstanding })
      }
    }
  }

  if (!['cancelled', 'completed'].includes(status) && APPROVAL_REMINDER_DAYS.has(daysUntil) && context.settings.approvalRemindersEnabled) {
    const approval = record(context.data.contractApproval)
    if (normalizeStatus(approval.status) === 'sent') {
      const revision = Math.max(1, Number(approval.revision) || 1)
      const client = await loadClient(context)
      await dispatch(context, 'approval_reminder', client, `${context.eventId}-approval-reminder-r${revision}-${daysUntil}d`, { daysUntil })
    }
  }

  if (!['cancelled', 'completed'].includes(status) && (daysUntil === 1 || daysUntil === 0) && context.settings.eventRemindersEnabled) {
    const suffix = daysUntil === 0 ? 'today' : '1d'
    const client = await loadClient(context)
    await dispatch(context, 'client_event_reminder', client, `${context.eventId}-client-event-${suffix}`, { daysUntil })

    if (context.settings.vendorNotificationsEnabled) {
      for (const vendor of vendorAssignments(context.data).filter(item => item.status === 'confirmed')) {
        const recipient = await loadVendor(context, vendor.customerId, vendor.category)
        await dispatch(context, 'vendor_event_reminder', recipient, `${context.eventId}-vendor-event-${suffix}-${vendor.customerId}`, { daysUntil })
      }
    }

    if (context.settings.staffNotificationsEnabled) {
      for (const assignment of staffAssignments(context.data)) {
        const recipient = await loadStaff(context, assignment.memberId, assignment.eventRole, assignment.callTime)
        await dispatch(context, 'staff_event_reminder', recipient, `${context.eventId}-staff-event-${suffix}-${assignment.memberId}`, { daysUntil })
      }
    }
  }

  if (daysUntil === -1 && status === 'completed' && context.settings.postEventThanksEnabled) {
    const client = await loadClient(context)
    await dispatch(context, 'client_thank_you', client, `${context.eventId}-client-thank-you`)
    if (context.settings.vendorNotificationsEnabled) {
      for (const vendor of vendorAssignments(context.data).filter(item => item.status !== 'cancelled')) {
        const recipient = await loadVendor(context, vendor.customerId, vendor.category)
        await dispatch(context, 'vendor_thank_you', recipient, `${context.eventId}-vendor-thank-you-${vendor.customerId}`)
      }
    }
  }
}

async function runScheduledCommunications() {
  const today = formatDateKey(new Date())
  const start = shiftDate(today, -1)
  const end = shiftDate(today, 14)
  const stores = await defaultDb.collection('stores').get()
  const results = { stores: stores.size, events: 0, errors: 0 }

  for (const storeSnapshot of stores.docs) {
    const storeId = storeSnapshot.id
    const storeData = storeSnapshot.data() as RecordMap
    try {
      const events = await storeSnapshot.ref.collection('events')
        .where('eventDate', '>=', start)
        .where('eventDate', '<=', end)
        .get()
      results.events += events.size
      for (const eventSnapshot of events.docs) {
        const data = eventSnapshot.data() as RecordMap
        const context: EventContext = {
          ref: eventSnapshot.ref,
          storeId,
          eventId: eventSnapshot.id,
          data,
          storeData,
          settings: communicationSettings(data, storeData),
          brand: storeBrand(storeId, storeData),
        }
        try {
          await scheduledEvent(context, today)
        } catch (error) {
          results.errors += 1
          functions.logger.error('event scheduled communication failed', {
            storeId,
            eventId: eventSnapshot.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    } catch (error) {
      results.errors += 1
      functions.logger.error('event communication store scan failed', {
        storeId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  functions.logger.info('event communications automation run complete', { today, ...results })
}

export const processEventCommunications = functions.pubsub
  .schedule('0 7 * * *')
  .timeZone(TIME_ZONE)
  .onRun(async () => {
    await runScheduledCommunications()
    return null
  })

export const runEventCommunicationsNow = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  const eventId = text(data?.eventId, 220)
  if (!storeId || !eventId) throw new functions.https.HttpsError('invalid-argument', 'storeId and eventId are required')

  const membership = await defaultDb.collection('teamMembers')
    .where('storeId', '==', storeId)
    .where('uid', '==', context.auth.uid)
    .limit(1)
    .get()
  const storeSnapshot = await defaultDb.collection('stores').doc(storeId).get()
  const storeData = storeSnapshot.data() as RecordMap | undefined
  const ownerUid = text(storeData?.ownerUid, 220)
  if (membership.empty && ownerUid !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to this workspace')
  }

  const eventSnapshot = await defaultDb.collection('stores').doc(storeId).collection('events').doc(eventId).get()
  if (!eventSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Event not found')
  const resolvedStoreData = storeData ?? {}
  const eventData = eventSnapshot.data() as RecordMap
  const eventContext: EventContext = {
    ref: eventSnapshot.ref,
    storeId,
    eventId,
    data: eventData,
    storeData: resolvedStoreData,
    settings: communicationSettings(eventData, resolvedStoreData),
    brand: storeBrand(storeId, resolvedStoreData),
  }
  await scheduledEvent(eventContext, formatDateKey(new Date()))
  return { ok: true }
})
