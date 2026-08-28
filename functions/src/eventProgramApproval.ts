import { createHash } from 'crypto'
import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'

type RecordMap = Record<string, unknown>

type StoredProgramItem = {
  id: string
  time: string
  title: string
  participant: string
  notes: string
  sortOrder: number
}

function text(value: unknown, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function fingerprintText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function compareCodeUnits(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function mapProgramSnapshot(snapshot: FirebaseFirestore.QuerySnapshot): StoredProgramItem[] {
  return snapshot.docs
    .map(item => {
      const value = item.data() as RecordMap
      return {
        id: item.id,
        time: fingerprintText(value.time),
        title: fingerprintText(value.title) || 'Untitled program item',
        participant: fingerprintText(value.participant),
        notes: fingerprintText(value.notes),
        sortOrder: numberValue(value.sortOrder),
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || compareCodeUnits(a.time, b.time) || compareCodeUnits(a.id, b.id))
}

function programFingerprint(items: StoredProgramItem[]) {
  const canonical = items.map(item => ({
    id: item.id,
    time: item.time,
    title: item.title,
    participant: item.participant,
    notes: item.notes,
    sortOrder: item.sortOrder,
  }))
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
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

export const approveEventProgram = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')

  const storeId = text(data?.storeId, 180)
  const eventId = text(data?.eventId, 220)
  const approverName = text(data?.approverName, 220)
  const rawExpectedRevision = Number(data?.expectedRevision)
  const expectedFingerprint = text(data?.expectedFingerprint, 64).toLowerCase()

  if (
    !storeId
    || !eventId
    || !approverName
    || !Number.isInteger(rawExpectedRevision)
    || rawExpectedRevision < 1
    || !/^[a-f0-9]{64}$/.test(expectedFingerprint)
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Event, approver, a valid expected revision and the reviewed program fingerprint are required',
    )
  }

  const expectedRevision = rawExpectedRevision
  await assertStoreAccess(storeId, context.auth.uid)
  const eventRef = defaultDb.collection('stores').doc(storeId).collection('events').doc(eventId)
  const now = admin.firestore.FieldValue.serverTimestamp()

  const result = await defaultDb.runTransaction(async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    if (!eventSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Event not found')

    const programSnapshot = await transaction.get(eventRef.collection('program'))
    if (programSnapshot.empty) {
      throw new functions.https.HttpsError('failed-precondition', 'Add at least one program item before recording client approval')
    }

    const eventData = eventSnapshot.data() as RecordMap
    const approval = record(eventData.programApproval)
    const currentRevision = Math.max(1, Math.floor(numberValue(approval.revision, 1)))
    if (currentRevision !== expectedRevision) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Program revision changed from ${expectedRevision} to ${currentRevision}. Refresh and review the latest draft before approving.`,
      )
    }

    const currentFingerprint = programFingerprint(mapProgramSnapshot(programSnapshot))
    if (currentFingerprint !== expectedFingerprint) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'The program content changed after this page loaded. Refresh and review the latest draft before approving.',
      )
    }

    if (text(approval.status, 40) === 'approved') {
      throw new functions.https.HttpsError('failed-precondition', 'This program was already approved in another session. Refresh to see the latest status.')
    }

    transaction.update(eventRef, {
      'programApproval.status': 'approved',
      'programApproval.approvedBy': approverName,
      'programApproval.approvedAt': now,
      'programApproval.revision': currentRevision,
      'programApproval.fingerprint': currentFingerprint,
      updatedAt: now,
    })

    return { revision: currentRevision, fingerprint: currentFingerprint }
  })

  return { ok: true, ...result }
})
