import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'
import { fingerprintProgramSnapshot } from './eventProgramApproval'

type RecordMap = Record<string, unknown>

type PortalProgramItem = {
  id: string
  time: string
  title: string
  participant: string
  notes: string
}

type StoredProgramItem = PortalProgramItem & { sortOrder: number }

export type ClientPortalProgramData = {
  status: 'draft' | 'approved'
  publishedAt: string | null
  requireClientApproval: boolean
  clientApproved: boolean
  clientApprovedBy: string
  clientApprovedAt: string | null
  approvedBy: string
  approvedAt: string | null
  revision: number
  fingerprint: string
  canApprove: boolean
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

function mapProgramItem(id: string, value: RecordMap): StoredProgramItem {
  return {
    id,
    time: text(value.time, 40),
    title: text(value.title, 240) || 'Program item',
    participant: text(value.participant, 240),
    notes: text(value.notes, 3000),
    sortOrder: numberValue(value.sortOrder),
  }
}

function mapArchivedProgramItem(value: unknown, index: number): StoredProgramItem {
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

function mapProgramSnapshot(snapshot: FirebaseFirestore.QuerySnapshot): StoredProgramItem[] {
  return snapshot.docs
    .map(item => mapProgramItem(item.id, item.data() as RecordMap))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.time.localeCompare(b.time))
}

function publicationState(source: RecordMap) {
  const hasExplicitClientApproval = typeof source.clientApproved === 'boolean'
  const legacyApproved = !hasExplicitClientApproval && Boolean(text(source.approvedBy, 220))
  const clientApproved = source.clientApproved === true || legacyApproved
  const requireClientApproval = source.requireClientApproval === true || (source.requireClientApproval === undefined && legacyApproved)
  return {
    publishedAt: isoDate(source.publishedAt) || isoDate(source.approvedAt),
    requireClientApproval,
    clientApproved,
    clientApprovedBy: text(source.clientApprovedBy, 220) || (clientApproved ? text(source.approvedBy, 220) : ''),
    clientApprovedAt: isoDate(source.clientApprovedAt) || (clientApproved ? isoDate(source.approvedAt) : null),
    approvedBy: text(source.approvedBy, 220),
    approvedAt: isoDate(source.approvedAt),
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

async function assertArchiveSlotAvailable(
  transaction: FirebaseFirestore.Transaction,
  eventRef: FirebaseFirestore.DocumentReference,
  revision: number,
) {
  const archiveRef = eventRef.collection('programRevisions').doc(`revision-${revision}`)
  const archiveSnapshot = await transaction.get(archiveRef)
  if (archiveSnapshot.exists) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Published program revision ${revision} is already archived. Refresh before making more changes.`,
    )
  }
  return archiveRef
}

function archivePublishedProgram(
  transaction: FirebaseFirestore.Transaction,
  archiveRef: FirebaseFirestore.DocumentReference,
  eventRef: FirebaseFirestore.DocumentReference,
  approval: RecordMap,
  revision: number,
  programItems: StoredProgramItem[],
  now: FirebaseFirestore.FieldValue,
  actor: string,
  reason: string,
  extraArchiveFields: RecordMap = {},
) {
  const publication = publicationState(approval)
  transaction.set(archiveRef, {
    revision,
    status: 'approved',
    publishedAt: approval.publishedAt || approval.approvedAt || null,
    publishedBy: text(approval.publishedBy, 220),
    requireClientApproval: publication.requireClientApproval,
    clientApproved: publication.clientApproved,
    clientApprovedBy: publication.clientApprovedBy,
    clientApprovedAt: approval.clientApprovedAt || approval.approvedAt || null,
    approvedBy: publication.approvedBy,
    approvedAt: approval.approvedAt || null,
    fingerprint: text(approval.fingerprint, 64),
    items: programItems,
    archivedAt: now,
    archivedBy: actor,
    reason,
    ...extraArchiveFields,
  })
  transaction.update(eventRef, {
    'programApproval.status': 'draft',
    'programApproval.publishedAt': null,
    'programApproval.publishedBy': '',
    'programApproval.requireClientApproval': false,
    'programApproval.clientApproved': false,
    'programApproval.clientApprovedBy': '',
    'programApproval.clientApprovedAt': null,
    'programApproval.approvedBy': '',
    'programApproval.approvedAt': null,
    'programApproval.fingerprint': '',
    'programApproval.revision': revision + 1,
    updatedAt: now,
  })
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
  const hasOpenRequest = changeRequests.some(request => request.status === 'open')

  if (currentStatus === 'approved') {
    const programSnapshot = await eventRef.collection('program').get()
    const items = mapProgramSnapshot(programSnapshot).map(({ sortOrder: _sortOrder, ...item }) => item)
    const publication = publicationState(approval)
    const fingerprint = programSnapshot.empty ? '' : fingerprintProgramSnapshot(programSnapshot)
    return {
      status: items.length ? 'approved' : 'draft',
      ...publication,
      revision: currentRevision,
      fingerprint,
      canApprove: items.length > 0 && publication.requireClientApproval && !publication.clientApproved && !hasOpenRequest,
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
      const publication = publicationState(archive)
      return {
        status: items.length ? 'approved' : 'draft',
        ...publication,
        revision: previousRevision,
        fingerprint: text(archive.fingerprint, 64),
        canApprove: false,
        canRequestChanges: false,
        preparingRevision: currentRevision,
        items,
        changeRequests,
      }
    }
  }

  return {
    status: 'draft',
    publishedAt: null,
    requireClientApproval: false,
    clientApproved: false,
    clientApprovedBy: '',
    clientApprovedAt: null,
    approvedBy: '',
    approvedAt: null,
    revision: currentRevision,
    fingerprint: '',
    canApprove: false,
    canRequestChanges: false,
    preparingRevision: null,
    items: [],
    changeRequests,
  }
}

export const prepareEventProgramRevision = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  const eventId = text(data?.eventId, 220)
  if (!storeId || !eventId) {
    throw new functions.https.HttpsError('invalid-argument', 'Store and event are required')
  }

  await assertStoreAccess(storeId, context.auth.uid)
  const eventRef = defaultDb.collection('stores').doc(storeId).collection('events').doc(eventId)
  const actor = text(context.auth.token.email, 220) || text(context.auth.token.name, 220) || context.auth.uid
  const now = admin.firestore.FieldValue.serverTimestamp()

  const result = await defaultDb.runTransaction(async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    if (!eventSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Event not found')

    const eventData = eventSnapshot.data() as RecordMap
    const approval = record(eventData.programApproval)
    const revision = Math.max(1, Math.floor(numberValue(approval.revision, 1)))
    if (text(approval.status, 40) !== 'approved') {
      return { archivedRevision: null, nextRevision: revision, alreadyDraft: true }
    }

    const programSnapshot = await transaction.get(eventRef.collection('program'))
    const programItems = mapProgramSnapshot(programSnapshot)
    if (!programItems.length) {
      throw new functions.https.HttpsError('failed-precondition', 'The published program has no items to archive')
    }
    const archiveRef = await assertArchiveSlotAvailable(transaction, eventRef, revision)

    archivePublishedProgram(transaction, archiveRef, eventRef, approval, revision, programItems, now, actor, 'staff_reopen')
    return { archivedRevision: revision, nextRevision: revision + 1, alreadyDraft: false }
  })

  return { ok: true, ...result }
})

export const mutateEventProgram = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  const eventId = text(data?.eventId, 220)
  const action = text(data?.action, 40)
  const requestedItemId = text(data?.itemId, 220)
  if (!storeId || !eventId || !['upsert', 'delete'].includes(action)) {
    throw new functions.https.HttpsError('invalid-argument', 'Choose a valid program mutation')
  }

  const itemPayload = record(data?.item)
  const title = text(itemPayload.title, 240)
  const time = text(itemPayload.time, 40)
  const participant = text(itemPayload.participant, 240)
  const notes = text(itemPayload.notes, 3000)
  if (action === 'upsert' && !title) {
    throw new functions.https.HttpsError('invalid-argument', 'Program item title is required')
  }
  if (action === 'delete' && !requestedItemId) {
    throw new functions.https.HttpsError('invalid-argument', 'Program item is required')
  }

  await assertStoreAccess(storeId, context.auth.uid)
  const eventRef = defaultDb.collection('stores').doc(storeId).collection('events').doc(eventId)
  const itemRef = requestedItemId
    ? eventRef.collection('program').doc(requestedItemId)
    : eventRef.collection('program').doc()
  const actor = text(context.auth.token.email, 220) || text(context.auth.token.name, 220) || context.auth.uid
  const now = admin.firestore.FieldValue.serverTimestamp()

  const result = await defaultDb.runTransaction(async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    if (!eventSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Event not found')
    const programSnapshot = await transaction.get(eventRef.collection('program'))
    const existingItem = programSnapshot.docs.find(item => item.id === itemRef.id)
    if (requestedItemId && !existingItem) {
      throw new functions.https.HttpsError('not-found', 'This program item changed or was removed. Refresh and try again.')
    }

    const eventData = eventSnapshot.data() as RecordMap
    const approval = record(eventData.programApproval)
    const revision = Math.max(1, Math.floor(numberValue(approval.revision, 1)))
    const published = text(approval.status, 40) === 'approved'
    let archivedRevision: number | null = null
    let nextRevision = revision

    if (published) {
      const programItems = mapProgramSnapshot(programSnapshot)
      if (!programItems.length) {
        throw new functions.https.HttpsError('failed-precondition', 'The published program has no items to archive')
      }
      const archiveRef = await assertArchiveSlotAvailable(transaction, eventRef, revision)
      archivePublishedProgram(transaction, archiveRef, eventRef, approval, revision, programItems, now, actor, 'staff_program_mutation')
      archivedRevision = revision
      nextRevision = revision + 1
    } else {
      transaction.update(eventRef, { updatedAt: now })
    }

    if (action === 'delete') {
      transaction.delete(itemRef)
    } else {
      const existing = existingItem ? existingItem.data() as RecordMap : {}
      transaction.set(itemRef, {
        time,
        title,
        participant,
        notes,
        sortOrder: numberValue(existing.sortOrder, Number(time.replace(':', '')) || Date.now()),
        ...(existingItem ? {} : { createdAt: now }),
        updatedAt: now,
      }, { merge: true })
    }

    return {
      itemId: itemRef.id,
      archivedRevision,
      nextRevision,
      wasApproved: published,
    }
  })

  return { ok: true, ...result }
})

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
    const programSnapshot = decision === 'accept' ? await transaction.get(eventRef.collection('program')) : null

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
        throw new functions.https.HttpsError('failed-precondition', 'The published program changed before this request was accepted. Refresh and review the latest revision.')
      }
      const programItems = programSnapshot ? mapProgramSnapshot(programSnapshot) : []
      if (!programItems.length) {
        throw new functions.https.HttpsError('failed-precondition', 'The published program has no items to archive')
      }
      const archiveRef = await assertArchiveSlotAvailable(transaction, eventRef, requestRevision)

      archivePublishedProgram(
        transaction,
        archiveRef,
        eventRef,
        approval,
        requestRevision,
        programItems,
        now,
        actor,
        'client_change_request',
        { requestId },
      )
      if (text(summary.id, 220) === requestId) {
        transaction.update(eventRef, {
          'programChangeRequest.status': 'accepted',
          'programChangeRequest.resolvedAt': now,
          'programChangeRequest.resolutionNote': resolutionNote,
          updatedAt: now,
        })
      }
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
