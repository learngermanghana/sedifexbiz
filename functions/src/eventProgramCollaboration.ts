import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'

type RecordMap = Record<string, unknown>

type PortalProgramItem = {
  id: string
  time: string
  title: string
  participant: string
  notes: string
}

export type ClientPortalProgramData = {
  status: 'draft' | 'approved'
  approvedBy: string
  approvedAt: string | null
  revision: number
  canRequestChanges: boolean
  preparingRevision: number | null
  items: PortalProgramItem[]
  changeRequests: Array<{
    id: string
    status: string
    message: string
    requestedBy: string
    requestedAt: string | null
    resolutionNote: string
    resolvedAt: string | null
    revision: number
  }>
}

function text(value: unknown, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isoDate(value: unknown) {
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  return null
}

function mapProgramItem(id: string, value: RecordMap): PortalProgramItem & { sortOrder: number } {
  return {
    id,
    time: text(value.time, 40),
    title: text(value.title, 240) || 'Program item',
    participant: text(value.participant, 240),
    notes: text(value.notes, 3000),
    sortOrder: numberValue(value.sortOrder),
  }
}

function mapArchivedProgramItem(value: unknown, index: number): PortalProgramItem & { sortOrder: number } {
  const item = record(value)
  return {
    id: text(item.id, 220) || `program-${index + 1}`,
    time: text(item.time, 40),
    title: text(item.title, 240) || 'Program item',
    participant: text(item.participant, 240),
    notes: text(item.notes, 3000),
    sortOrder: numberValue(item.sortOrder, index + 1),
  }
}

async function assertStoreAccess(storeId: string, uid: string) {
  const [storeSnapshot, memberSnapshot] = await Promise.all([
    defaultDb.collection('stores').doc(storeId).get(),
    defaultDb.collection('teamMembers').doc(uid).get(),
  ])
  if (!storeSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Store not found')
  const storeData = storeSnapshot.data() as RecordMap
  const memberData = memberSnapshot.exists ? memberSnapshot.data() as RecordMap : {}
  const direct = text(memberData.uid, 220) === uid && text(memberData.storeId, 180) === storeId
  const linkedOwner = text(memberData.uid, 220) === uid
    && text(memberData.role, 40) === 'owner'
    && Boolean(text(memberData.storeId, 180))
    && text(storeData.parentStoreId, 180) === text(memberData.storeId, 180)
  const ownerUid = text(storeData.ownerUid, 220) === uid
  if (!direct && !linkedOwner && !ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to this event')
  }
}

export async function loadClientProgramForPortal(
  eventRef: FirebaseFirestore.DocumentReference,
  eventData: RecordMap,
): Promise<ClientPortalProgramData> {
  const approval = record(eventData.programApproval)
  const currentStatus = text(approval.status, 40) === 'approved' ? 'approved' : 'draft'
  const currentRevision = Math.max(1, Math.floor(numberValue(approval.revision, 1)))

  const requestSnapshot = await eventRef.collection('programChangeRequests').orderBy('requestedAt', 'desc').limit(10).get()
  const changeRequests = requestSnapshot.docs.map(item => {
    const data = item.data() as RecordMap
    return {
      id: item.id,
      status: text(data.status, 40) || 'open',
      message: text(data.message, 3000),
      requestedBy: text(data.requestedBy, 220),
      requestedAt: isoDate(data.requestedAt),
      resolutionNote: text(data.resolutionNote, 3000),
      resolvedAt: isoDate(data.resolvedAt),
      revision: Math.max(1, Math.floor(numberValue(data.revision, 1))),
    }
  })

  if (currentStatus === 'approved') {
    const programSnapshot = await eventRef.collection('program').get()
    const items = programSnapshot.docs
      .map(item => mapProgramItem(item.id, item.data() as RecordMap))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.time.localeCompare(b.time))
      .map(({ sortOrder: _sortOrder, ...item }) => item)
    return {
      status: items.length ? 'approved' : 'draft',
      approvedBy: text(approval.approvedBy, 220),
      approvedAt: isoDate(approval.approvedAt),
      revision: currentRevision,
      canRequestChanges: items.length > 0,
      preparingRevision: null,
      items,
      changeRequests,
    }
  }

  const previousRevision = currentRevision - 1
  if (previousRevision >= 1) {
    const archiveSnapshot = await eventRef.collection('programRevisions').doc(`revision-${previousRevision}`).get()
    if (archiveSnapshot.exists) {
      const archive = archiveSnapshot.data() as RecordMap
      const rawItems = Array.isArray(archive.items) ? archive.items : []
      const items = rawItems
        .map(mapArchivedProgramItem)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.time.localeCompare(b.time))
        .map(({ sortOrder: _sortOrder, ...item }) => item)
      return {
        status: items.length ? 'approved' : 'draft',
        approvedBy: text(archive.approvedBy, 220),
        approvedAt: isoDate(archive.approvedAt),
        revision: previousRevision,
        canRequestChanges: false,
        preparingRevision: currentRevision,
        items,
        changeRequests,
      }
    }
  }

  return {
    status: 'draft',
    approvedBy: '',
    approvedAt: null,
    revision: currentRevision,
    canRequestChanges: false,
    preparingRevision: null,
    items: [],
    changeRequests,
  }
}

export const resolveEventProgramChangeRequest = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  const eventId = text(data?.eventId, 220)
  const requestId = text(data?.requestId, 220)
  const decision = text(data?.decision, 40)
  const resolutionNote = text(data?.note, 3000)
  if (!storeId || !eventId || !requestId || !['accept', 'decline'].includes(decision)) {
    throw new functions.https.HttpsError('invalid-argument', 'Choose a valid program change request decision')
  }

  await assertStoreAccess(storeId, context.auth.uid)
  const eventRef = defaultDb.collection('stores').doc(storeId).collection('events').doc(eventId)
  const requestRef = eventRef.collection('programChangeRequests').doc(requestId)
  const programSnapshot = decision === 'accept' ? await eventRef.collection('program').get() : null
  const programItems = programSnapshot
    ? programSnapshot.docs.map(item => {
        const value = item.data() as RecordMap
        return {
          id: item.id,
          time: text(value.time, 40),
          title: text(value.title, 240) || 'Program item',
          participant: text(value.participant, 240),
          notes: text(value.notes, 3000),
          sortOrder: numberValue(value.sortOrder),
        }
      }).sort((a, b) => a.sortOrder - b.sortOrder || a.time.localeCompare(b.time))
    : []
  const now = admin.firestore.FieldValue.serverTimestamp()
  const actor = text(context.auth.token.email, 220) || text(context.auth.token.name, 220) || context.auth.uid

  const result = await defaultDb.runTransaction(async transaction => {
    const [eventSnapshot, requestSnapshot] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(requestRef),
    ])
    if (!eventSnapshot.exists || !requestSnapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Program change request not found')
    }

    const eventData = eventSnapshot.data() as RecordMap
    const requestData = requestSnapshot.data() as RecordMap
    if (text(requestData.status, 40) !== 'open') {
      throw new functions.https.HttpsError('failed-precondition', 'This program change request has already been resolved')
    }
    const requestRevision = Math.max(1, Math.floor(numberValue(requestData.revision, 1)))
    const summary = record(eventData.programChangeRequest)

    if (decision === 'accept') {
      const approval = record(eventData.programApproval)
      const approvalRevision = Math.max(1, Math.floor(numberValue(approval.revision, 1)))
      if (text(approval.status, 40) !== 'approved' || approvalRevision !== requestRevision) {
        throw new functions.https.HttpsError('failed-precondition', 'The approved program changed before this request was accepted. Refresh and review the latest revision.')
      }
      if (!programItems.length) {
        throw new functions.https.HttpsError('failed-precondition', 'The approved program has no items to archive')
      }

      const archiveRef = eventRef.collection('programRevisions').doc(`revision-${requestRevision}`)
      transaction.set(archiveRef, {
        revision: requestRevision,
        status: 'approved',
        approvedBy: text(approval.approvedBy, 220),
        approvedAt: approval.approvedAt || null,
        items: programItems,
        archivedAt: now,
        archivedBy: actor,
        reason: 'client_change_request',
        requestId,
      }, { merge: true })
      transaction.update(eventRef, {
        'programApproval.status': 'draft',
        'programApproval.approvedBy': '',
        'programApproval.approvedAt': null,
        'programApproval.revision': requestRevision + 1,
        ...(text(summary.id, 220) === requestId ? {
          'programChangeRequest.status': 'accepted',
          'programChangeRequest.resolvedAt': now,
          'programChangeRequest.resolutionNote': resolutionNote,
        } : {}),
        updatedAt: now,
      })
      transaction.update(requestRef, {
        status: 'accepted',
        resolutionNote,
        resolvedAt: now,
        resolvedBy: actor,
        nextRevision: requestRevision + 1,
      })
      return { status: 'accepted', nextRevision: requestRevision + 1 }
    }

    transaction.update(requestRef, {
      status: 'declined',
      resolutionNote,
      resolvedAt: now,
      resolvedBy: actor,
    })
    if (text(summary.id, 220) === requestId) {
      transaction.update(eventRef, {
        'programChangeRequest.status': 'declined',
        'programChangeRequest.resolvedAt': now,
        'programChangeRequest.resolutionNote': resolutionNote,
        updatedAt: now,
      })
    }
    return { status: 'declined', nextRevision: null }
  })

  return { ok: true, ...result }
})
