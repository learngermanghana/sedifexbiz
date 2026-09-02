import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'
import { resolveStoreSmsGateway } from './smsGateway'
import {
  automationSettingsRef,
  isSmsAutomationEnabledForStage,
  loadAutomationSettings,
  sanitizeAutomationSettings,
  type AutomationSettings,
  type SmsAutomationStage,
} from './automationSettings'

type RecordMap = Record<string, unknown>

const SMS_STAGES = new Set<SmsAutomationStage>([
  'booking_received',
  'booking_confirmed',
  'booking_rescheduled',
  'booking_cancelled',
  'payment_confirmation',
  'reminder_3d',
  'reminder_2d',
  'reminder_1d',
  'thank_you',
])

function text(value: unknown, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function normalized(value: unknown) {
  return text(value, 100).toLowerCase().replace(/[\s-]+/g, '_')
}

async function assertOwnerAccess(storeId: string, context: functions.https.CallableContext) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const uid = context.auth.uid
  const [storeSnapshot, memberSnapshot] = await Promise.all([
    defaultDb.collection('stores').doc(storeId).get(),
    defaultDb.collection('teamMembers').doc(uid).get(),
  ])
  if (!storeSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Store not found')

  const store = storeSnapshot.data() as RecordMap
  const member = memberSnapshot.exists ? memberSnapshot.data() as RecordMap : {}
  const memberRole = text(member.role, 40).toLowerCase()
  const memberStoreId = text(member.storeId, 180)
  const memberUid = text(member.uid, 220)
  const directOwner = memberUid === uid && memberRole === 'owner' && memberStoreId === storeId
  const linkedOwner = memberUid === uid
    && memberRole === 'owner'
    && Boolean(memberStoreId)
    && text(store.parentStoreId, 180) === memberStoreId
  const legacyOwner = storeId === uid
    || text(store.ownerUid, 220) === uid
    || text(store.ownerId, 220) === uid

  if (!directOwner && !linkedOwner && !legacyOwner) {
    throw new functions.https.HttpsError('permission-denied', 'Only the store owner can manage automations')
  }

  return store
}

async function channelReadiness(storeId: string, store: RecordMap) {
  const settingsSnapshot = await defaultDb.collection('storeSettings').doc(storeId).get()
  const settings = record(settingsSnapshot.data())
  const notifications = record(settings.notifications)
  const integration = {
    ...record(store.bulkEmailIntegration),
    ...record(settings.bulkEmailIntegration),
  }
  const gateway = resolveStoreSmsGateway(store)
  const balance = typeof store.bulkMessagingCredits === 'number' && Number.isFinite(store.bulkMessagingCredits)
    ? Math.max(0, store.bulkMessagingCredits)
    : 0

  return {
    email: {
      storeEmailConfigured: Boolean(text(integration.webAppUrl, 1200) && text(integration.sharedToken, 1200)),
      customWebhookConfigured: notifications.customWebhookEnabled === true && Boolean(text(notifications.customWebhookUrl, 1200)),
    },
    sms: {
      configured: Boolean(gateway),
      senderId: gateway?.senderId || null,
      creditBalance: balance,
    },
  }
}

function responseSettings(settings: AutomationSettings) {
  return {
    emailEnabled: settings.emailEnabled,
    smsEnabled: settings.smsEnabled,
    deliveryPreference: settings.deliveryPreference,
    fallbackToSedifex: settings.fallbackToSedifex,
    channels: settings.channels,
  }
}

function queueStageDisabled(document: FirebaseFirestore.QueryDocumentSnapshot, settings: AutomationSettings) {
  const data = document.data() as RecordMap
  const stage = normalized(data.stage) as SmsAutomationStage
  if (!SMS_STAGES.has(stage)) return false
  if (normalized(data.status) === 'sending') return false
  return !isSmsAutomationEnabledForStage(settings, stage)
}

async function purgeDisabledSmsQueues(storeId: string, settings: AutomationSettings) {
  const [reminderSnapshot, lifecycleSnapshot] = await Promise.all([
    defaultDb.collection('bookingSmsQueue').where('storeId', '==', storeId).get(),
    defaultDb.collection('bookingLifecycleSmsQueue').where('storeId', '==', storeId).get(),
  ])

  const reminderRefs = reminderSnapshot.docs.filter(document => queueStageDisabled(document, settings)).map(document => document.ref)
  const lifecycleDocs = lifecycleSnapshot.docs.filter(document => queueStageDisabled(document, settings))
  const total = reminderRefs.length + lifecycleDocs.length

  for (let offset = 0; offset < reminderRefs.length; offset += 450) {
    const batch = defaultDb.batch()
    reminderRefs.slice(offset, offset + 450).forEach(ref => batch.delete(ref))
    await batch.commit()
  }

  for (let offset = 0; offset < lifecycleDocs.length; offset += 200) {
    const batch = defaultDb.batch()
    lifecycleDocs.slice(offset, offset + 200).forEach(document => {
      batch.delete(document.ref)
      batch.set(defaultDb.collection('bookingLifecycleSmsEvents').doc(document.id), {
        status: 'disabled',
        disabledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
    })
    await batch.commit()
  }

  return total
}

export const getAutomationCenterState = functions.https.onCall(async (data, context) => {
  const storeId = text(data?.storeId, 180)
  if (!storeId) throw new functions.https.HttpsError('invalid-argument', 'storeId is required')
  const store = await assertOwnerAccess(storeId, context)
  const [settings, readiness] = await Promise.all([
    loadAutomationSettings(storeId),
    channelReadiness(storeId, store),
  ])
  return { settings: responseSettings(settings), readiness }
})

export const saveAutomationCenterSettings = functions.https.onCall(async (data, context) => {
  const storeId = text(data?.storeId, 180)
  if (!storeId) throw new functions.https.HttpsError('invalid-argument', 'storeId is required')
  const store = await assertOwnerAccess(storeId, context)
  const rawSettings = data?.settings
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
    throw new functions.https.HttpsError('invalid-argument', 'settings are required')
  }

  const settings = sanitizeAutomationSettings(rawSettings)
  const now = admin.firestore.FieldValue.serverTimestamp()
  await automationSettingsRef(storeId).set({
    ...responseSettings(settings),
    updatedAt: now,
    updatedBy: context.auth?.uid || null,
  }, { merge: true })

  const [readiness, clearedSmsQueues] = await Promise.all([
    channelReadiness(storeId, store),
    purgeDisabledSmsQueues(storeId, settings),
  ])
  return { ok: true, settings: responseSettings(settings), readiness, clearedSmsQueues }
})
