import { defineString } from 'firebase-functions/params'
import { admin, defaultDb } from './firestore'

const SEDIFEX_NOTIFICATION_WEBHOOK_URL = defineString('SEDIFEX_NOTIFICATION_WEBHOOK_URL', { default: '' })
const SEDIFEX_NOTIFICATION_SHARED_SECRET = defineString('SEDIFEX_NOTIFICATION_SHARED_SECRET', { default: '' })

type RecordMap = Record<string, unknown>

type ContractEmailBrand = {
  storeName: string
  logoUrl?: string
  brandColor?: string
  email?: string
  phone?: string
}

type ContractEmailAction = {
  label: string
  url: string
}

export type EventEmailDeliveryProfile = {
  channel: 'apps_script_gmail' | 'sedifex_notification'
  senderName: string
  senderEmail: string
  configured: boolean
  label: string
}

export type ContractEmailInput = {
  storeId: string
  eventType: string
  reference: string
  recipientType: 'customer' | 'store'
  to: string
  subject: string
  title: string
  intro: string
  brand: ContractEmailBrand
  rows?: string[][]
  primaryAction?: ContractEmailAction
  secondaryAction?: ContractEmailAction
  footerNote?: string
  customer?: { name?: string; email?: string; phone?: string }
  data?: RecordMap
}

function text(value: unknown, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function email(value: unknown) {
  const cleaned = text(value, 220).toLowerCase()
  return cleaned.includes('@') ? cleaned : ''
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function escapeHtml(value: unknown) {
  return text(value, 5000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function safeUrl(value: unknown) {
  const candidate = text(value, 1200)
  return /^https:\/\//i.test(candidate) ? candidate : ''
}

function safeId(value: string) {
  return value.replace(/\//g, '_').replace(/[^A-Za-z0-9._|@+-]/g, '_').slice(0, 1400)
}

function buildHtml(input: ContractEmailInput) {
  const brandColor = text(input.brand.brandColor, 40) || '#4f46e5'
  const storeName = text(input.brand.storeName, 180) || 'Sedifex Store'
  const logoUrl = safeUrl(input.brand.logoUrl)
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(storeName)}" style="height:42px;max-width:180px;object-fit:contain;display:block;margin-bottom:12px;" />`
    : `<div style="font-weight:900;font-size:24px;letter-spacing:-0.04em;margin-bottom:8px;">${escapeHtml(storeName)}</div>`
  const rowHtml = (input.rows ?? []).map(([label, value]) => `<tr><td style="padding:9px 0;color:#64748b;font-size:13px;width:38%;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:9px 0;color:#111827;font-size:14px;font-weight:700;vertical-align:top;">${escapeHtml(value)}</td></tr>`).join('')
  const primaryUrl = safeUrl(input.primaryAction?.url)
  const secondaryUrl = safeUrl(input.secondaryAction?.url)
  const actions = primaryUrl || secondaryUrl
    ? `<div style="margin:24px 0 6px;display:block;">${primaryUrl ? `<a href="${escapeHtml(primaryUrl)}" style="display:inline-block;margin:0 10px 10px 0;padding:13px 18px;border-radius:12px;background:${escapeHtml(brandColor)};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;">${escapeHtml(input.primaryAction?.label || 'Open')}</a>` : ''}${secondaryUrl ? `<a href="${escapeHtml(secondaryUrl)}" style="display:inline-block;margin:0 10px 10px 0;padding:12px 18px;border-radius:12px;border:1px solid #cbd5e1;background:#ffffff;color:#334155;text-decoration:none;font-weight:800;font-size:14px;">${escapeHtml(input.secondaryAction?.label || 'View')}</a>` : ''}</div>`
    : ''
  const contact = [email(input.brand.email), text(input.brand.phone, 80)].filter(Boolean).join(' · ')
  const headerLabel = input.eventType === 'event.client_portal_shared'
    ? 'Event collaboration · Powered by Sedifex'
    : 'Event agreement · Powered by Sedifex'
  return `<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;"><div style="padding:28px 16px;"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:22px;overflow:hidden;box-shadow:0 24px 80px rgba(15,23,42,.08);"><div style="background:${escapeHtml(brandColor)};padding:24px 26px;color:#fff;">${logo}<p style="margin:0;color:rgba(255,255,255,.82);font-size:13px;font-weight:700;">${escapeHtml(headerLabel)}</p></div><div style="padding:28px 26px;"><h1 style="margin:0 0 10px;font-size:26px;line-height:1.15;color:#111827;">${escapeHtml(input.title)}</h1><p style="margin:0;color:#475569;font-size:15px;line-height:1.7;">${escapeHtml(input.intro)}</p>${rowHtml ? `<div style="margin:22px 0;border:1px solid #e5e7eb;background:#f8fafc;border-radius:16px;padding:14px 18px;"><table style="width:100%;border-collapse:collapse;">${rowHtml}</table></div>` : ''}${actions}<p style="margin:16px 0 0;color:#64748b;font-size:13px;line-height:1.6;">${escapeHtml(input.footerNote || 'Keep this email with your event records. Contact the event team if anything is unclear.')}</p></div><div style="padding:18px 26px;background:#f8fafc;border-top:1px solid #e5e7eb;color:#64748b;font-size:12px;line-height:1.55;"><p style="margin:0;">This message was sent by ${escapeHtml(storeName)} through Sedifex.</p>${contact ? `<p style="margin:4px 0 0;">Contact: ${escapeHtml(contact)}</p>` : ''}</div></div></div></body></html>`
}

function buildText(input: ContractEmailInput) {
  const lines = [input.title, '', input.intro, '']
  for (const [label, value] of input.rows ?? []) lines.push(`${label}: ${value}`)
  if (input.primaryAction?.url) lines.push('', `${input.primaryAction.label}: ${input.primaryAction.url}`)
  if (input.secondaryAction?.url) lines.push(`${input.secondaryAction.label}: ${input.secondaryAction.url}`)
  lines.push('', input.footerNote || 'Keep this email with your event records.')
  return lines.join('\n')
}

async function deliverySettings(storeId: string) {
  const [storeSnapshot, settingsSnapshot] = await Promise.all([
    defaultDb.collection('stores').doc(storeId).get(),
    defaultDb.collection('storeSettings').doc(storeId).get(),
  ])
  const storeData = record(storeSnapshot.data())
  const settingsData = record(settingsSnapshot.data())
  const notifications = record(settingsData.notifications)
  const emailIntegration = {
    ...record(storeData.bulkEmailIntegration),
    ...record(settingsData.bulkEmailIntegration),
  }
  const appsScriptUrl = safeUrl(emailIntegration.webAppUrl)
  const appsScriptToken = text(emailIntegration.sharedToken, 1200)
  const appsScriptFromName = text(emailIntegration.fromName, 180)
    || text(storeData.displayName, 180)
    || text(storeData.businessName, 180)
    || text(storeData.name, 180)
    || 'Sedifex Store'
  const appsScriptSenderEmail = email(emailIntegration.senderEmail)
  const centralUrl = SEDIFEX_NOTIFICATION_WEBHOOK_URL.value()?.trim() || process.env.SEDIFEX_NOTIFICATION_WEBHOOK_URL?.trim() || ''
  const customEnabled = notifications.customWebhookEnabled === true
  const customUrl = safeUrl(notifications.customWebhookUrl)
  const url = customEnabled && customUrl ? customUrl : centralUrl
  const secret = SEDIFEX_NOTIFICATION_SHARED_SECRET.value()?.trim() || process.env.SEDIFEX_NOTIFICATION_SHARED_SECRET?.trim() || ''
  const adminEmails = Array.isArray(notifications.adminEmails)
    ? notifications.adminEmails.map(email).filter(Boolean)
    : []
  return {
    url,
    secret,
    adminEmails,
    appsScript: {
      configured: Boolean(appsScriptUrl && appsScriptToken),
      url: appsScriptUrl,
      token: appsScriptToken,
      fromName: appsScriptFromName,
      senderEmail: appsScriptSenderEmail,
    },
  }
}

export async function eventEmailDeliveryProfile(storeId: string): Promise<EventEmailDeliveryProfile> {
  const settings = await deliverySettings(storeId)
  if (settings.appsScript.configured) {
    const senderDetail = settings.appsScript.senderEmail || settings.appsScript.fromName
    return {
      channel: 'apps_script_gmail',
      senderName: settings.appsScript.fromName,
      senderEmail: settings.appsScript.senderEmail,
      configured: true,
      label: `Google Apps Script / Gmail · ${senderDetail}`,
    }
  }
  return {
    channel: 'sedifex_notification',
    senderName: 'Sedifex notification sender',
    senderEmail: '',
    configured: true,
    label: 'Sedifex notification sender',
  }
}

export async function eventContractAdminEmails(storeId: string, fallback?: string) {
  const settings = await deliverySettings(storeId)
  const values = [...settings.adminEmails, email(fallback)].filter(Boolean)
  return Array.from(new Set(values))
}

async function updateDeliveryRecords(
  outboxRef: FirebaseFirestore.DocumentReference,
  logRef: FirebaseFirestore.DocumentReference,
  values: RecordMap,
) {
  const now = admin.firestore.FieldValue.serverTimestamp()
  await Promise.all([
    outboxRef.set({ ...values, updatedAt: now }, { merge: true }),
    logRef.set({ ...values, updatedAt: now }, { merge: true }),
  ])
}

export async function sendEventContractEmail(input: ContractEmailInput) {
  const to = email(input.to)
  if (!to) return { ok: false, reason: 'missing-recipient', channel: 'none' as const, deliveryStatus: 'failed' }
  const settings = await deliverySettings(input.storeId)
  const profile = settings.appsScript.configured
    ? {
        channel: 'apps_script_gmail' as const,
        senderName: settings.appsScript.fromName,
        senderEmail: settings.appsScript.senderEmail,
      }
    : {
        channel: 'sedifex_notification' as const,
        senderName: 'Sedifex notification sender',
        senderEmail: '',
      }
  const logKey = safeId(`${input.storeId}|${input.eventType}|${input.reference}|${input.recipientType}|${to}`)
  const logRef = defaultDb.collection('notification_delivery_log').doc(logKey)
  const outboxRef = defaultDb.collection('notification_outbox').doc()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const html = buildHtml(input)
  const plainText = buildText(input)
  const created = await defaultDb.runTransaction(async transaction => {
    const existing = await transaction.get(logRef)
    if (existing.exists) return false
    transaction.set(logRef, {
      storeId: input.storeId,
      eventType: input.eventType,
      reference: input.reference,
      recipientType: input.recipientType,
      to,
      outboxId: outboxRef.id,
      deliveryChannel: profile.channel,
      senderName: profile.senderName,
      senderEmail: profile.senderEmail || null,
      deliveryStatus: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    transaction.set(outboxRef, {
      storeId: input.storeId,
      eventType: input.eventType,
      reference: input.reference,
      recipientType: input.recipientType,
      to,
      subject: input.subject,
      html,
      text: plainText,
      brand: input.brand,
      customer: input.customer ?? null,
      data: input.data ?? null,
      status: 'queued',
      deliveryChannel: profile.channel,
      senderName: profile.senderName,
      senderEmail: profile.senderEmail || null,
      deliveryStatus: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    return true
  })
  if (!created) {
    return {
      ok: true,
      duplicate: true,
      channel: profile.channel,
      senderName: profile.senderName,
      senderEmail: profile.senderEmail,
      deliveryStatus: 'duplicate',
    }
  }

  if (settings.appsScript.configured) {
    try {
      const campaignId = safeId(`event-${input.storeId}-${input.eventType}-${input.reference}-${to}`)
      const response = await fetch(settings.appsScript.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: settings.appsScript.token,
          campaignId,
          fromName: settings.appsScript.fromName,
          subject: input.subject,
          html,
          recipients: [{
            id: text(input.data?.eventId, 220) || input.reference,
            name: text(input.customer?.name, 180) || to,
            email: to,
          }],
        }),
      })
      const body = await response.json().catch(() => ({})) as RecordMap
      const sent = Math.max(0, numberValue(body.sent))
      const queuedForRetry = Math.max(0, numberValue(body.queuedForRetry))
      const duplicate = body.duplicate === true
      const accepted = response.ok && body.ok !== false && (sent > 0 || queuedForRetry > 0 || duplicate)
      const deliveryStatus = duplicate
        ? 'duplicate'
        : sent > 0
          ? 'sent'
          : queuedForRetry > 0
            ? 'queued'
            : 'failed'
      await updateDeliveryRecords(outboxRef, logRef, {
        status: accepted ? 'apps_script_accepted' : 'apps_script_failed',
        deliveryStatus,
        deliveryChannel: 'apps_script_gmail',
        appsScriptStatus: response.status,
        appsScriptSent: sent,
        appsScriptQueuedForRetry: queuedForRetry,
        appsScriptFailed: Math.max(0, numberValue(body.failed)),
        appsScriptError: accepted ? null : text(body.error, 1200) || `HTTP ${response.status}`,
        senderName: settings.appsScript.fromName,
        senderEmail: settings.appsScript.senderEmail || null,
        sentAt: sent > 0 ? now : null,
      })
      return {
        ok: accepted,
        channel: 'apps_script_gmail' as const,
        senderName: settings.appsScript.fromName,
        senderEmail: settings.appsScript.senderEmail,
        deliveryStatus,
        sent,
        queuedForRetry,
        duplicate,
        reason: accepted ? undefined : text(body.error, 1200) || `apps-script-http-${response.status}`,
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'apps-script-error'
      await updateDeliveryRecords(outboxRef, logRef, {
        status: 'apps_script_error',
        deliveryStatus: 'failed',
        deliveryChannel: 'apps_script_gmail',
        errorMessage: reason,
        senderName: settings.appsScript.fromName,
        senderEmail: settings.appsScript.senderEmail || null,
      })
      return {
        ok: false,
        channel: 'apps_script_gmail' as const,
        senderName: settings.appsScript.fromName,
        senderEmail: settings.appsScript.senderEmail,
        deliveryStatus: 'failed',
        reason,
      }
    }
  }

  if (!settings.url) {
    await updateDeliveryRecords(outboxRef, logRef, {
      status: 'queued_no_webhook',
      deliveryStatus: 'queued',
      deliveryChannel: 'sedifex_notification',
    })
    return {
      ok: true,
      queued: true,
      webhook: false,
      channel: 'sedifex_notification' as const,
      senderName: profile.senderName,
      senderEmail: '',
      deliveryStatus: 'queued',
    }
  }

  try {
    const payload: RecordMap = {
      storeId: input.storeId,
      eventType: input.eventType,
      reference: input.reference,
      recipientType: input.recipientType,
      to,
      subject: input.subject,
      html,
      text: plainText,
      brand: input.brand,
      customer: input.customer ?? null,
      data: input.data ?? null,
    }
    const response = await fetch(settings.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.secret ? { 'x-sedifex-notification-secret': settings.secret } : {}),
      },
      body: JSON.stringify(settings.secret ? { ...payload, secret: settings.secret } : payload),
    })
    const deliveryStatus = response.ok ? 'sent' : 'failed'
    await updateDeliveryRecords(outboxRef, logRef, {
      status: response.ok ? 'sent_to_webhook' : 'webhook_failed',
      deliveryStatus,
      deliveryChannel: 'sedifex_notification',
      webhookStatus: response.status,
      sentToWebhookAt: now,
    })
    return {
      ok: response.ok,
      webhook: true,
      status: response.status,
      channel: 'sedifex_notification' as const,
      senderName: profile.senderName,
      senderEmail: '',
      deliveryStatus,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'webhook-error'
    await updateDeliveryRecords(outboxRef, logRef, {
      status: 'webhook_error',
      deliveryStatus: 'failed',
      deliveryChannel: 'sedifex_notification',
      errorMessage: reason,
    })
    return {
      ok: false,
      webhook: true,
      reason,
      channel: 'sedifex_notification' as const,
      senderName: profile.senderName,
      senderEmail: '',
      deliveryStatus: 'failed',
    }
  }
}
