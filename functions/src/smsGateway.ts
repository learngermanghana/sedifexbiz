import { defineString } from 'firebase-functions/params'
import { defaultDb } from './firestore'
import { normalizePhoneE164 } from './phone'

export type SmsRateTable = {
  defaultGroup: string
  dialCodeToGroup: Record<string, string>
  sms: Record<string, { perSegment: number }>
}

export type StoreSmsGatewayConfig = {
  senderId: string
  clientId: string
  clientSecret: string
}

const HUBTEL_CLIENT_ID = defineString('HUBTEL_CLIENT_ID', { default: '' })
const HUBTEL_CLIENT_SECRET = defineString('HUBTEL_CLIENT_SECRET', { default: '' })
const SMS_SEGMENT_SIZE = 160
const DEFAULT_SMS_CREDITS_PER_SEGMENT = 12

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function firstText(values: unknown[]) {
  for (const value of values) {
    const candidate = text(value)
    if (candidate) return candidate
  }
  return ''
}

function explicitlyDisabled(value: unknown) {
  if (value === false) return true
  const normalized = text(value).toLowerCase()
  return ['false', 'disabled', 'off', 'inactive'].includes(normalized)
}

export function normalizeHubtelSenderId(value: unknown): string | null {
  const candidate = text(value)
  if (!candidate) return null
  return /^[a-zA-Z0-9]{3,11}$/.test(candidate) ? candidate : null
}

function normalizeHubtelCredential(value: unknown): string | null {
  const candidate = text(value)
  return candidate || null
}

function approvedStoreSenderId(storeData: Record<string, unknown>) {
  const hubtel = asRecord(storeData.hubtel)
  const sms = asRecord(storeData.sms)
  const hubtelSms = asRecord(storeData.hubtelSms)
  const candidates = [
    storeData.hubtelApprovedSenderId,
    storeData.hubtelSenderId,
    storeData.hubtelSenderID,
    storeData.hubtelSenderName,
    storeData.hubtelSmsSenderId,
    storeData.smsSenderId,
    storeData.smsSenderName,
    storeData.senderId,
    hubtel.senderId,
    hubtel.senderName,
    sms.hubtelSenderId,
    sms.senderId,
    sms.senderName,
    hubtelSms.senderId,
    hubtelSms.senderName,
  ]

  for (const candidate of candidates) {
    const senderId = normalizeHubtelSenderId(candidate)
    if (senderId) return senderId
  }

  return null
}

export function resolveStoreSmsGateway(
  storeData: Record<string, unknown>,
): StoreSmsGatewayConfig | null {
  const hubtel = asRecord(storeData.hubtel)
  const sms = asRecord(storeData.sms)
  const hubtelSms = asRecord(storeData.hubtelSms)

  if (
    [
      storeData.bookingSmsEnabled,
      storeData.smsEnabled,
      hubtel.enabled,
      sms.enabled,
      hubtelSms.enabled,
    ].some(explicitlyDisabled)
  ) {
    return null
  }

  // Booking automation only runs for stores that have their own approved sender ID.
  const senderId = approvedStoreSenderId(storeData)
  if (!senderId) return null

  const clientId = firstText([
    storeData.hubtelClientId,
    storeData.smsClientId,
    storeData.clientId,
    hubtel.clientId,
    sms.clientId,
    hubtelSms.clientId,
    HUBTEL_CLIENT_ID.value(),
  ])
  const clientSecret = firstText([
    storeData.hubtelClientSecret,
    storeData.smsClientSecret,
    storeData.clientSecret,
    hubtel.clientSecret,
    sms.clientSecret,
    hubtelSms.clientSecret,
    HUBTEL_CLIENT_SECRET.value(),
  ])

  if (!normalizeHubtelCredential(clientId) || !normalizeHubtelCredential(clientSecret)) {
    return null
  }

  return { senderId, clientId, clientSecret }
}

function normalizeRateTable(data: FirebaseFirestore.DocumentData | undefined): SmsRateTable {
  if (!data || typeof data !== 'object') {
    return {
      defaultGroup: 'ROW',
      dialCodeToGroup: { '233': 'GH' },
      sms: {
        GH: { perSegment: DEFAULT_SMS_CREDITS_PER_SEGMENT },
        ROW: { perSegment: DEFAULT_SMS_CREDITS_PER_SEGMENT },
      },
    }
  }

  const defaultGroup =
    typeof data.defaultGroup === 'string' && data.defaultGroup.trim()
      ? data.defaultGroup.trim()
      : 'ROW'
  const dialCodeToGroup: Record<string, string> = {}
  if (data.dialCodeToGroup && typeof data.dialCodeToGroup === 'object') {
    Object.entries(data.dialCodeToGroup as Record<string, unknown>).forEach(
      ([dialCode, group]) => {
        const digits = dialCode.replace(/\D/g, '')
        if (!digits || typeof group !== 'string' || !group.trim()) return
        dialCodeToGroup[digits] = group.trim()
      },
    )
  }

  const sms: Record<string, { perSegment: number }> = {}
  if (data.sms && typeof data.sms === 'object') {
    Object.entries(data.sms as Record<string, unknown>).forEach(([group, rawRate]) => {
      const rate = asRecord(rawRate)
      const perSegment = Number(rate.perSegment)
      if (!group.trim() || !Number.isFinite(perSegment) || perSegment <= 0) return
      sms[group.trim()] = { perSegment }
    })
  }

  if (!sms[defaultGroup]) {
    sms[defaultGroup] = { perSegment: DEFAULT_SMS_CREDITS_PER_SEGMENT }
  }
  if (!Object.keys(dialCodeToGroup).length) dialCodeToGroup['233'] = 'GH'
  if (!sms.GH) sms.GH = { perSegment: DEFAULT_SMS_CREDITS_PER_SEGMENT }

  return { defaultGroup, dialCodeToGroup, sms }
}

export async function loadSmsRateTable(): Promise<SmsRateTable> {
  const current = await defaultDb.collection('config').doc('hubtelRates').get()
  if (current.exists) return normalizeRateTable(current.data())
  const legacy = await defaultDb.collection('config').doc('twilioRates').get()
  return normalizeRateTable(legacy.data())
}

function groupForPhone(phone: string, table: SmsRateTable) {
  const digits = phone.replace(/\D/g, '')
  let bestGroup = table.defaultGroup
  let bestLength = 0
  Object.entries(table.dialCodeToGroup).forEach(([dialCode, group]) => {
    const normalizedDial = dialCode.replace(/\D/g, '')
    if (
      normalizedDial &&
      digits.startsWith(normalizedDial) &&
      normalizedDial.length > bestLength
    ) {
      bestGroup = group
      bestLength = normalizedDial.length
    }
  })
  return bestGroup
}

export function calculateSmsCredits(phone: string, message: string, table: SmsRateTable) {
  const segments = Math.max(1, Math.ceil(message.length / SMS_SEGMENT_SIZE))
  const group = groupForPhone(phone, table)
  const perSegment = table.sms[group]?.perSegment ?? DEFAULT_SMS_CREDITS_PER_SEGMENT
  return { credits: segments * perSegment, segments, group, perSegment }
}

export function formatSmsAddress(phone: string) {
  return normalizePhoneE164(phone) ?? ''
}

export async function sendSmsViaHubtel(options: {
  gateway: StoreSmsGatewayConfig
  to: string
  body: string
}) {
  const { gateway, to, body } = options
  const url = new URL('https://smsc.hubtel.com/v1/messages/send')
  url.search = new URLSearchParams({
    clientid: gateway.clientId,
    clientsecret: gateway.clientSecret,
    from: gateway.senderId,
    to,
    content: body,
  }).toString()

  const response = await fetch(url, { method: 'GET' })
  const responseText = await response.text()
  if (!response.ok) {
    const details = responseText || response.statusText || 'Unknown error'
    throw new Error(`Hubtel error ${response.status}: ${details}`)
  }

  if (!responseText) return { ok: true }
  try {
    return JSON.parse(responseText) as unknown
  } catch (_error) {
    return { ok: true, response: responseText.slice(0, 500) }
  }
}
