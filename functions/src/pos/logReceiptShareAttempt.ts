import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from '../firestore'

const VALID_ROLES = new Set(['owner', 'staff'])
const RECEIPT_CHANNELS = new Set(['email', 'sms', 'whatsapp'])
const RECEIPT_STATUSES = new Set(['attempt', 'failed', 'sent'])

function getRoleFromToken(token: Record<string, unknown> | undefined) {
  const role = typeof token?.role === 'string' ? (token.role as string) : null
  return role && VALID_ROLES.has(role) ? (role as 'owner' | 'staff') : null
}

function assertStaffAccess(context: functions.https.CallableContext) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required')
  }

  const role = getRoleFromToken(context.auth.token as Record<string, unknown>)
  if (!role) {
    throw new functions.https.HttpsError('permission-denied', 'Staff access required')
  }
}

export const logReceiptShareAttempt = functions.https.onCall(async (data, context) => {
  assertStaffAccess(context)

  const storeId = typeof data?.storeId === 'string' ? data.storeId.trim() : ''
  const saleId = typeof data?.saleId === 'string' ? data.saleId.trim() : ''
  const channel = typeof data?.channel === 'string' ? data.channel.trim() : ''
  const statusRaw = typeof data?.status === 'string' ? data.status.trim() : ''
  const status = statusRaw || 'attempt'

  if (!storeId || !saleId) {
    throw new functions.https.HttpsError('invalid-argument', 'storeId and saleId are required')
  }

  if (!RECEIPT_CHANNELS.has(channel)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid channel')
  }

  if (!RECEIPT_STATUSES.has(status)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid status')
  }

  const contactRaw = data?.contact
  const contact =
    contactRaw === null || contactRaw === undefined
      ? null
      : typeof contactRaw === 'string'
        ? contactRaw.trim() || null
        : (() => {
            throw new functions.https.HttpsError(
              'invalid-argument',
              'contact must be a string when provided',
            )
          })()

  const customerIdRaw = data?.customerId
  const customerId =
    customerIdRaw === null || customerIdRaw === undefined
      ? null
      : typeof customerIdRaw === 'string'
        ? customerIdRaw.trim() || null
        : (() => {
            throw new functions.https.HttpsError(
              'invalid-argument',
              'customerId must be a string when provided',
            )
          })()

  const customerNameRaw = data?.customerName
  const customerName =
    customerNameRaw === null || customerNameRaw === undefined
      ? null
      : typeof customerNameRaw === 'string'
        ? customerNameRaw.trim() || null
        : (() => {
            throw new functions.https.HttpsError(
              'invalid-argument',
              'customerName must be a string when provided',
            )
          })()

  const errorMessageRaw = data?.errorMessage
  const errorMessage =
    errorMessageRaw === null || errorMessageRaw === undefined
      ? null
      : typeof errorMessageRaw === 'string'
        ? errorMessageRaw.trim() || null
        : (() => {
            throw new functions.https.HttpsError(
              'invalid-argument',
              'errorMessage must be a string when provided',
            )
          })()

  const timestamp = admin.firestore.FieldValue.serverTimestamp()
  const payload: admin.firestore.DocumentData = {
    storeId,
    saleId,
    channel,
    status,
    contact,
    customerId,
    customerName,
    errorMessage,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  const ref = await defaultDb.collection('receiptShareLogs').add(payload)

  return { ok: true, shareId: ref.id }
})
