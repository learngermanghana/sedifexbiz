import { onDocumentWrittenWithAuthContext } from 'firebase-functions/v2/firestore'
import { admin, defaultDb } from './firestore'
import {
  changedEventFields,
  getEventAuditAction,
  isAuditMetadataOnlyUpdate,
} from './eventAuditCore'

type RecordMap = Record<string, unknown>

function text(value: unknown, max = 220) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function numberOrNull(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function auditDocumentId(eventId: string) {
  const normalized = eventId.replace(/\//g, '_').replace(/[^A-Za-z0-9._-]/g, '_')
  return `audit_${normalized.slice(0, 1400) || Date.now()}`
}

export const auditEventPlanningWrite = onDocumentWrittenWithAuthContext(
  'stores/{storeId}/events/{eventId}',
  async event => {
    const beforeSnapshot = event.data?.before
    const afterSnapshot = event.data?.after
    const before = beforeSnapshot?.exists ? beforeSnapshot.data() as RecordMap : null
    const after = afterSnapshot?.exists ? afterSnapshot.data() as RecordMap : null
    const action = getEventAuditAction(before, after)

    if (!action) return
    if (isAuditMetadataOnlyUpdate(before, after)) return

    const storeId = event.params.storeId
    const eventId = event.params.eventId
    const actorId = event.authId || null
    const actorType = event.authType || 'unknown'
    const current = after ?? before ?? {}
    const changedFields = changedEventFields(before, after)
    const now = admin.firestore.FieldValue.serverTimestamp()

    const activityRef = defaultDb
      .collection('stores')
      .doc(storeId)
      .collection('eventActivity')
      .doc(auditDocumentId(event.id))

    const batch = defaultDb.batch()

    batch.set(activityRef, {
      storeId,
      eventId,
      eventCode: text(current.eventCode, 80) || null,
      eventTitle: text(current.title, 180) || text(current.eventType, 120) || 'Untitled event',
      action,
      actorId,
      actorType,
      changedFields,
      statusBefore: text(before?.status, 80) || null,
      statusAfter: text(after?.status, 80) || null,
      progressBefore: numberOrNull(before?.progress),
      progressAfter: numberOrNull(after?.progress),
      occurredAt: now,
      source: 'firestore-auth-context',
    })

    if (afterSnapshot?.exists) {
      const metadata: RecordMap = {
        updatedBy: actorId,
        updatedByType: actorType,
        auditUpdatedAt: now,
      }

      if (action === 'created') {
        metadata.createdBy = actorId
        metadata.createdByType = actorType
      }

      batch.set(afterSnapshot.ref, metadata, { merge: true })
    }

    await batch.commit()
  },
)
