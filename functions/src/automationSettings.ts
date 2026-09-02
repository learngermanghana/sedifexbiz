import { defaultDb } from './firestore'

export type DeliveryPreference = 'automatic' | 'sedifex' | 'store_email' | 'custom_webhook'
export type SmsAutomationStage =
  | 'booking_received'
  | 'booking_confirmed'
  | 'booking_rescheduled'
  | 'booking_cancelled'
  | 'payment_confirmation'
  | 'reminder_3d'
  | 'reminder_2d'
  | 'reminder_1d'
  | 'thank_you'
export type AutomationChannelRule = { email: boolean; sms: boolean }
export type AutomationSettings = {
  emailEnabled: boolean
  smsEnabled: boolean
  deliveryPreference: DeliveryPreference
  fallbackToSedifex: boolean
  channels: Record<string, AutomationChannelRule>
}

type RecordMap = Record<string, unknown>

export const AUTOMATION_EMAIL_EVENTS = [
  'booking.received',
  'booking.confirmed',
  'booking.rescheduled',
  'booking.cancelled',
  'booking.completed',
  'booking.payment_submitted',
  'booking.payment_received',
  'booking.payment_confirmed',
  'booking.reminder_3d',
  'booking.reminder_2d',
  'booking.reminder_1d',
] as const

export const SMS_STAGE_TO_EVENT: Record<SmsAutomationStage, string> = {
  booking_received: 'booking.received',
  booking_confirmed: 'booking.confirmed',
  booking_rescheduled: 'booking.rescheduled',
  booking_cancelled: 'booking.cancelled',
  payment_confirmation: 'booking.payment_confirmed',
  reminder_3d: 'booking.reminder_3d',
  reminder_2d: 'booking.reminder_2d',
  reminder_1d: 'booking.reminder_1d',
  thank_you: 'booking.completed',
}

export const AUTOMATION_SMS_EVENTS = Object.values(SMS_STAGE_TO_EVENT)

const EMAIL_EVENT_SET = new Set<string>(AUTOMATION_EMAIL_EVENTS)
const SMS_EVENT_SET = new Set<string>(AUTOMATION_SMS_EVENTS)
const OPT_IN_SMS_EVENT_SET = new Set<string>([
  'booking.received',
  'booking.confirmed',
  'booking.rescheduled',
  'booking.cancelled',
])

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function deliveryPreference(value: unknown): DeliveryPreference {
  return ['automatic', 'sedifex', 'store_email', 'custom_webhook'].includes(String(value || ''))
    ? value as DeliveryPreference
    : 'automatic'
}

export function defaultAutomationSettings(): AutomationSettings {
  const channels: Record<string, AutomationChannelRule> = {}
  for (const eventType of AUTOMATION_EMAIL_EVENTS) {
    channels[eventType] = {
      email: true,
      sms: SMS_EVENT_SET.has(eventType) && !OPT_IN_SMS_EVENT_SET.has(eventType),
    }
  }
  return {
    emailEnabled: true,
    smsEnabled: true,
    deliveryPreference: 'automatic',
    fallbackToSedifex: true,
    channels,
  }
}

export function parseAutomationSettings(value: unknown): AutomationSettings {
  const defaults = defaultAutomationSettings()
  const source = record(value)
  const rawChannels = record(source.channels)
  const channels: Record<string, AutomationChannelRule> = {}

  for (const eventType of AUTOMATION_EMAIL_EVENTS) {
    const rawRule = record(rawChannels[eventType])
    channels[eventType] = {
      email: typeof rawRule.email === 'boolean' ? rawRule.email : defaults.channels[eventType].email,
      sms: SMS_EVENT_SET.has(eventType)
        ? (typeof rawRule.sms === 'boolean' ? rawRule.sms : defaults.channels[eventType].sms)
        : false,
    }
  }

  return {
    emailEnabled: source.emailEnabled !== false,
    smsEnabled: source.smsEnabled !== false,
    deliveryPreference: deliveryPreference(source.deliveryPreference),
    fallbackToSedifex: source.fallbackToSedifex !== false,
    channels,
  }
}

export function sanitizeAutomationSettings(value: unknown): AutomationSettings {
  return parseAutomationSettings(value)
}

export function isKnownEmailAutomationEvent(eventType: string) {
  return EMAIL_EVENT_SET.has(eventType)
}

export function isSmsAutomationEvent(eventType: string) {
  return SMS_EVENT_SET.has(eventType)
}

export function isEmailAutomationEnabled(settings: AutomationSettings, eventType: string) {
  if (!isKnownEmailAutomationEvent(eventType)) return true
  return settings.emailEnabled && settings.channels[eventType]?.email !== false
}

export function isSmsAutomationEnabledForEvent(settings: AutomationSettings, eventType: string) {
  return isSmsAutomationEvent(eventType)
    && settings.smsEnabled
    && settings.channels[eventType]?.sms !== false
}

export function isSmsAutomationEnabledForStage(settings: AutomationSettings, stage: SmsAutomationStage) {
  return isSmsAutomationEnabledForEvent(settings, SMS_STAGE_TO_EVENT[stage])
}

export function automationSettingsRef(storeId: string) {
  return defaultDb.collection('stores').doc(storeId).collection('automationSettings').doc('config')
}

export async function loadAutomationSettings(storeId: string): Promise<AutomationSettings> {
  const snapshot = await automationSettingsRef(storeId).get()
  return parseAutomationSettings(snapshot.data())
}
