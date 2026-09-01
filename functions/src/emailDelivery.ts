import { defineString } from 'firebase-functions/params'
import { defaultDb } from './firestore'
import { isEmailAutomationEnabled, loadAutomationSettings } from './automationSettings'

const SEDIFEX_NOTIFICATION_WEBHOOK_URL = defineString('SEDIFEX_NOTIFICATION_WEBHOOK_URL', { default: '' })
const SEDIFEX_NOTIFICATION_SHARED_SECRET = defineString('SEDIFEX_NOTIFICATION_SHARED_SECRET', { default: '' })

type RecordMap = Record<string, unknown>

type DeliveryChannel =
  | 'apps_script_gmail'
  | 'custom_webhook'
  | 'sedifex_notification'
  | 'outbox_only'

export type TransactionalEmailDeliveryInput = {
  storeId: string
  eventType: string
  reference: string
  recipientType: string
  to: string
  subject: string
  html: string
  text: string
  brand?: RecordMap | null
  customer?: RecordMap | null
  payment?: RecordMap | null
  data?: RecordMap | null
  webhookPayload?: RecordMap | null
}

export type TransactionalEmailDeliveryResult = {
  attempted: boolean
  ok: boolean
  status: number | null
  channel: DeliveryChannel
  deliveryStatus: 'sent' | 'queued' | 'duplicate' | 'failed' | 'outbox'
  senderName: string
  senderEmail: string
  replyToEmail: string
  reason?: string
}

function text(value: unknown, max = 1200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function email(value: unknown) {
  const cleaned = text(value, 220).toLowerCase()
  return cleaned.includes('@') ? cleaned : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function firstText(source: RecordMap, keys: string[], max = 500) {
  for (const key of keys) {
    const value = text(source[key], max)
    if (value) return value
  }
  return ''
}

function buildCompatibleWebhookPayload(input: TransactionalEmailDeliveryInput): RecordMap {
  const data = record(input.data)
  const customer = record(input.customer)
  const payment = record(input.payment)
  const bookingId = firstText(data, ['bookingId', 'booking_id', 'id'], 220)
  const bookingStatus = firstText(data, ['bookingStatus', 'booking_status', 'status'], 80)
    || (input.eventType === 'booking.confirmed' ? 'confirmed' : input.eventType === 'booking.created' || input.eventType === 'booking.received' ? 'pending_approval' : '')

  return {
    storeId: input.storeId,
    eventType: input.eventType,
    reference: input.reference,
    recipientType: input.recipientType,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    brand: input.brand ?? null,
    customer: input.customer ?? null,
    payment: input.payment ?? null,
    data: input.data ?? null,
    bookingId: bookingId || undefined,
    booking_id: bookingId || undefined,
    bookingStatus: bookingStatus || undefined,
    booking_status: bookingStatus || undefined,
    status: bookingStatus || undefined,
    serviceId: firstText(data, ['serviceId', 'service_id'], 220) || undefined,
    serviceName: firstText(data, ['serviceName', 'service_name', 'itemName', 'productName'], 240) || undefined,
    bookingDate: firstText(data, ['bookingDate', 'booking_date', 'preferredDate', 'date'], 80) || undefined,
    bookingTime: firstText(data, ['bookingTime', 'booking_time', 'preferredTime', 'time'], 80) || undefined,
    notes: firstText(data, ['notes', 'message', 'details'], 2000) || undefined,
    quantity: firstText(data, ['quantity'], 20) || undefined,
    customerName: text(customer.name, 240) || undefined,
    customerPhone: text(customer.phone, 80) || undefined,
    customerEmail: email(customer.email) || undefined,
    paymentStatus: firstText(payment, ['status'], 80) || undefined,
    payment_status: firstText(payment, ['status'], 80) || undefined,
    paymentMethod: firstText(payment, ['method'], 80) || undefined,
    paymentAmount: numberValue(payment.amount) || undefined,
    paymentReference: firstText(payment, ['reference'], 220) || undefined,
    paymentConfirmed: input.eventType === 'booking.confirmed' || ['paid', 'confirmed', 'success', 'succeeded', 'captured', 'complete', 'completed'].includes(text(payment.status, 80).toLowerCase().replace(/[\s-]+/g, '_')),
  }
}

function safeUrl(value: unknown) {
  const candidate = text(value, 1200)
  return /^https:\/\//i.test(candidate) ? candidate : ''
}

function safeId(value: string) {
  return value.replace(/\//g, '_').replace(/[^A-Za-z0-9._|@+-]/g, '_').slice(0, 1400)
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function resolveSettings(storeId: string) {
  const [storeSnapshot, settingsSnapshot, automation] = await Promise.all([
    defaultDb.collection('stores').doc(storeId).get(),
    defaultDb.collection('storeSettings').doc(storeId).get(),
    loadAutomationSettings(storeId),
  ])

  const store = record(storeSnapshot.data())
  const settings = record(settingsSnapshot.data())
  const notifications = record(settings.notifications)
  const integration = {
    ...record(store.bulkEmailIntegration),
    ...record(settings.bulkEmailIntegration),
  }

  const storeName = text(store.displayName, 180)
    || text(store.businessName, 180)
    || text(store.name, 180)
    || 'Sedifex Store'
  const storeEmail = email(store.email) || email(store.ownerEmail) || email(store.firstSignupEmail)
  const replyToEmail = email(notifications.replyToEmail) || storeEmail

  const appsScriptUrl = safeUrl(integration.webAppUrl)
  const appsScriptToken = text(integration.sharedToken, 1200)
  const appsScriptFromName = text(integration.fromName, 180) || storeName
  const appsScriptSenderEmail = email(integration.senderEmail)

  const customEnabled = notifications.customWebhookEnabled === true
  const customUrl = customEnabled ? safeUrl(notifications.customWebhookUrl) : ''
  const centralUrl = SEDIFEX_NOTIFICATION_WEBHOOK_URL.value()?.trim()
    || process.env.SEDIFEX_NOTIFICATION_WEBHOOK_URL?.trim()
    || ''
  const secret = SEDIFEX_NOTIFICATION_SHARED_SECRET.value()?.trim()
    || process.env.SEDIFEX_NOTIFICATION_SHARED_SECRET?.trim()
    || ''

  return {
    storeName,
    replyToEmail,
    appsScript: {
      configured: Boolean(appsScriptUrl && appsScriptToken),
      url: appsScriptUrl,
      token: appsScriptToken,
      fromName: appsScriptFromName,
      senderEmail: appsScriptSenderEmail,
    },
    customUrl,
    centralUrl: safeUrl(centralUrl),
    secret,
    automation,
    deliveryPreference: automation.deliveryPreference,
    fallbackToSedifex: automation.fallbackToSedifex,
  }
}

async function sendAppsScript(
  input: TransactionalEmailDeliveryInput,
  settings: Awaited<ReturnType<typeof resolveSettings>>,
): Promise<TransactionalEmailDeliveryResult> {
  try {
    const campaignId = safeId(`transactional-${input.storeId}-${input.eventType}-${input.reference}-${input.to}`)
    const response = await fetch(settings.appsScript.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: settings.appsScript.token,
        campaignId,
        fromName: settings.appsScript.fromName,
        replyTo: settings.replyToEmail || undefined,
        subject: input.subject,
        html: input.html,
        recipients: [{
          id: text(input.data?.bookingId, 220) || input.reference,
          name: text(input.customer?.name, 180) || input.to,
          email: input.to,
        }],
      }),
    })
    const body = await response.json().catch(() => ({})) as RecordMap
    const sent = Math.max(0, numberValue(body.sent))
    const queuedForRetry = Math.max(0, numberValue(body.queuedForRetry))
    const duplicate = body.duplicate === true
    const accepted = response.ok && body.ok !== false && (sent > 0 || duplicate)
    const deliveryStatus = duplicate
      ? 'duplicate'
      : sent > 0
        ? 'sent'
        : 'failed'

    return {
      attempted: true,
      ok: accepted,
      status: response.status,
      channel: 'apps_script_gmail',
      deliveryStatus,
      senderName: settings.appsScript.fromName,
      senderEmail: settings.appsScript.senderEmail,
      replyToEmail: settings.replyToEmail,
      reason: accepted
        ? undefined
        : queuedForRetry > 0
          ? 'apps-script-quota-deferred-without-durable-retry'
          : text(body.error, 500) || `apps-script-http-${response.status}`,
    }
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      status: null,
      channel: 'apps_script_gmail',
      deliveryStatus: 'failed',
      senderName: settings.appsScript.fromName,
      senderEmail: settings.appsScript.senderEmail,
      replyToEmail: settings.replyToEmail,
      reason: error instanceof Error ? error.message : 'apps-script-error',
    }
  }
}

async function sendWebhook(
  input: TransactionalEmailDeliveryInput,
  settings: Awaited<ReturnType<typeof resolveSettings>>,
  url: string,
  channel: 'custom_webhook' | 'sedifex_notification',
): Promise<TransactionalEmailDeliveryResult> {
  const payload: RecordMap = {
    ...(input.webhookPayload ? record(input.webhookPayload) : buildCompatibleWebhookPayload(input)),
    senderName: settings.storeName,
    replyToEmail: settings.replyToEmail || null,
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.secret ? { 'x-sedifex-notification-secret': settings.secret } : {}),
      },
      body: JSON.stringify(settings.secret ? { ...payload, secret: settings.secret } : payload),
    })
    return {
      attempted: true,
      ok: response.ok,
      status: response.status,
      channel,
      deliveryStatus: response.ok ? 'sent' : 'failed',
      senderName: settings.storeName,
      senderEmail: '',
      replyToEmail: settings.replyToEmail,
      reason: response.ok ? undefined : `${channel}-http-${response.status}`,
    }
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      status: null,
      channel,
      deliveryStatus: 'failed',
      senderName: settings.storeName,
      senderEmail: '',
      replyToEmail: settings.replyToEmail,
      reason: error instanceof Error ? error.message : `${channel}-error`,
    }
  }
}

function noSenderResult(settings: Awaited<ReturnType<typeof resolveSettings>>, reason: string): TransactionalEmailDeliveryResult {
  return {
    attempted: false,
    ok: true,
    status: null,
    channel: 'outbox_only',
    deliveryStatus: 'outbox',
    senderName: settings.storeName,
    senderEmail: '',
    replyToEmail: settings.replyToEmail,
    reason,
  }
}

export async function deliverTransactionalEmail(
  input: TransactionalEmailDeliveryInput,
): Promise<TransactionalEmailDeliveryResult> {
  const settings = await resolveSettings(input.storeId)
  if (!isEmailAutomationEnabled(settings.automation, input.eventType)) {
    return noSenderResult(settings, 'automation-disabled')
  }

  const preference = settings.deliveryPreference
  let lastFailure: TransactionalEmailDeliveryResult | null = null
  let attemptedCustomUrl = ''

  const shouldTryStoreEmail = preference === 'automatic' || preference === 'store_email'
  if (shouldTryStoreEmail && settings.appsScript.configured) {
    const appsScript = await sendAppsScript(input, settings)
    if (appsScript.ok || appsScript.deliveryStatus === 'duplicate') return appsScript
    lastFailure = appsScript
  }

  if (preference === 'store_email' && !settings.fallbackToSedifex) {
    return lastFailure || noSenderResult(settings, 'store-email-not-configured')
  }

  const shouldTryCustom = preference === 'automatic' || preference === 'custom_webhook'
  if (shouldTryCustom && settings.customUrl) {
    attemptedCustomUrl = settings.customUrl
    const custom = await sendWebhook(input, settings, settings.customUrl, 'custom_webhook')
    if (custom.ok) return custom
    lastFailure = custom
  }

  if (preference === 'custom_webhook' && !settings.fallbackToSedifex) {
    return lastFailure || noSenderResult(settings, 'custom-webhook-not-configured')
  }

  const shouldTrySedifex = preference === 'sedifex' || settings.fallbackToSedifex
  if (shouldTrySedifex && settings.centralUrl && settings.centralUrl !== attemptedCustomUrl) {
    const sedifex = await sendWebhook(input, settings, settings.centralUrl, 'sedifex_notification')
    if (sedifex.ok) return sedifex
    lastFailure = sedifex
  }

  if (lastFailure) return lastFailure
  return noSenderResult(
    settings,
    preference === 'sedifex' ? 'sedifex-live-sender-not-configured' : 'no-live-email-sender-configured',
  )
}
