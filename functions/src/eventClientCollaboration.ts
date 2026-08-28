import * as functions from 'firebase-functions/v1'
import { randomBytes } from 'crypto'
import { admin, defaultDb } from './firestore'
import { sendEventContractEmail } from './eventContractEmail'
import { hashPublicContractToken } from './eventContractSigningCore'
import { eventClientPortalHtml, type EventClientPortalPageData } from './eventClientPortalPage'
import { loadClientProgramForPortal } from './eventProgramCollaboration'
import {
  effectiveClientTaskState,
  visibleClientActivityIds,
} from './eventClientCollaborationCore'

type RecordMap = Record<string, unknown>

type ClientPortalLink = {
  storeId: string
  eventId: string
  recipientName: string
  recipientEmail: string
  status: 'active' | 'revoked'
  expiresAt: FirebaseFirestore.Timestamp
  brandSnapshot: RecordMap
}

const LINK_LIFETIME_DAYS = 180

function text(value: unknown, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function email(value: unknown) {
  const valueText = text(value, 220).toLowerCase()
  return valueText.includes('@') ? valueText : ''
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

function clientBriefFields(value: unknown) {
  const brief = record(value)
  return {
    requirements: text(brief.requirements, 5000),
    themeColours: text(brief.themeColours, 3000),
    venueRequirements: text(brief.venueRequirements, 3000),
    catering: text(brief.catering, 3000),
    decor: text(brief.decor, 3000),
    entertainment: text(brief.entertainment, 3000),
    photography: text(brief.photography, 3000),
    transport: text(brief.transport, 3000),
    accommodation: text(brief.accommodation, 3000),
    specialInstructions: text(brief.specialInstructions, 5000),
  }
}

function escapeHtml(value: unknown) {
  return text(value, 10000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function createToken() {
  return randomBytes(32).toString('base64url')
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
  return storeData
}

function brandSnapshot(storeData: RecordMap) {
  return {
    storeName: text(storeData.displayName, 160) || text(storeData.businessName, 160) || text(storeData.name, 160) || 'Sedifex Store',
    email: email(storeData.email) || email(storeData.ownerEmail) || email(storeData.firstSignupEmail),
    phone: text(storeData.phone, 80),
    logoUrl: text(storeData.logoUrl, 900),
    brandColor: text(storeData.brandColor, 40) || '#4f46e5',
  }
}

function functionPortalBaseUrl() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || ''
  const region = process.env.FUNCTION_REGION || 'us-central1'
  if (!projectId) throw new functions.https.HttpsError('internal', 'Client portal URL is not configured')
  return `https://${region}-${projectId}.cloudfunctions.net/eventClientPortal`
}

async function loadPortalLink(rawToken: string) {
  const token = text(rawToken, 300)
  if (!token) throw new Error('INVALID_LINK')
  const hash = hashPublicContractToken(token)
  const linkRef = defaultDb.collection('eventClientLinks').doc(hash)
  const linkSnapshot = await linkRef.get()
  if (!linkSnapshot.exists) throw new Error('INVALID_LINK')
  const link = linkSnapshot.data() as unknown as ClientPortalLink
  if (link.status !== 'active') throw new Error('LINK_REVOKED')
  if (!link.expiresAt?.toMillis || link.expiresAt.toMillis() < Date.now()) throw new Error('LINK_EXPIRED')
  const eventRef = defaultDb.collection('stores').doc(link.storeId).collection('events').doc(link.eventId)
  const eventSnapshot = await eventRef.get()
  if (!eventSnapshot.exists) throw new Error('EVENT_NOT_FOUND')
  const eventData = eventSnapshot.data() as RecordMap
  const clientPortal = record(eventData.clientPortal)
  if (text(clientPortal.publicLinkHash, 100) !== hash || text(clientPortal.status, 40) !== 'active') throw new Error('LINK_REVOKED')
  return { token, hash, linkRef, link, eventRef, eventSnapshot, eventData }
}

async function portalData(rawToken: string): Promise<EventClientPortalPageData & { ok: true; expiresAt: string | null }> {
  const loaded = await loadPortalLink(rawToken)
  const [taskSnapshot, activitySnapshot, program] = await Promise.all([
    loaded.eventRef.collection('tasks').get(),
    loaded.eventRef.collection('clientActivity').orderBy('at', 'desc').limit(30).get(),
    loadClientProgramForPortal(loaded.eventRef, loaded.eventData),
  ])

  const tasks = taskSnapshot.docs
    .filter(item => item.data().clientVisible === true)
    .map(item => {
      const data = item.data() as RecordMap
      return {
        id: item.id,
        title: text(data.title, 240) || 'Event task',
        category: text(data.category, 100) || 'General',
        dueDate: text(data.dueDate, 40),
        priority: text(data.priority, 40) || 'normal',
        status: text(data.status, 40) || 'todo',
        clientState: effectiveClientTaskState(data),
        clientSubmissionNote: text(data.clientSubmissionNote, 3000),
        clientStaffNote: text(data.clientStaffNote, 3000),
        submittedAt: isoDate(data.clientSubmittedAt),
        verifiedAt: isoDate(data.clientVerifiedAt),
        sortOrder: numberValue(data.sortOrder),
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))

  const visibleTaskIds = tasks.map(task => task.id)
  const rawActivities = activitySnapshot.docs.map(item => {
    const data = item.data() as RecordMap
    return {
      id: item.id,
      taskId: text(data.taskId, 220),
      type: text(data.type, 80),
      taskTitle: text(data.taskTitle, 240),
      note: text(data.note, 3000),
      actor: text(data.actor, 180),
      at: isoDate(data.at),
    }
  })
  const visibleActivityIndexes = new Set(visibleClientActivityIds(rawActivities, visibleTaskIds))
  const activities = rawActivities
    .filter((_, index) => visibleActivityIndexes.has(index))
    .map(({ taskId: _taskId, ...activity }) => activity)

  const brand = record(loaded.link.brandSnapshot)
  const visibleDone = tasks.filter(item => item.clientState === 'verified').length
  const clientBrief = record(loaded.eventData.clientBrief)

  return {
    ok: true,
    event: {
      title: text(loaded.eventData.title, 220) || text(loaded.eventData.eventType, 160) || 'Event',
      eventCode: text(loaded.eventData.eventCode, 80),
      eventDate: text(loaded.eventData.eventDate, 40),
      venue: text(loaded.eventData.venue, 220),
      clientName: text(loaded.eventData.clientName, 180) || loaded.link.recipientName || 'Client',
    },
    brand: {
      storeName: text(brand.storeName, 180) || 'Event team',
      phone: text(brand.phone, 80),
      email: email(brand.email),
      brandColor: text(brand.brandColor, 40) || '#4f46e5',
    },
    brief: clientBriefFields(clientBrief),
    briefUpdatedAt: isoDate(clientBrief.clientUpdatedAt),
    program,
    tasks,
    activities,
    progress: tasks.length ? Math.round(visibleDone / tasks.length * 100) : 0,
    expiresAt: isoDate(loaded.link.expiresAt),
  }
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'LINK_EXPIRED') return 'This client portal link has expired. Ask the event team to share a new link.'
  if (message === 'LINK_REVOKED') return 'This client portal link is no longer active. Ask the event team for the latest link.'
  if (message === 'EVENT_NOT_FOUND') return 'This event is no longer available.'
  if (message === 'TASK_NOT_SHARED') return 'This task is no longer shared with you.'
  if (message === 'TASK_ALREADY_DONE') return 'This task has already been verified as done.'
  if (message === 'TASK_NOT_STARTED') return 'Start this task before submitting it as completed.'
  if (message === 'PROGRAM_NOT_APPROVED') return 'The event team is currently preparing a program revision. You can request another change after the new revision is approved.'
  if (message === 'PROGRAM_CHANGE_ALREADY_OPEN') return 'You already have a program change request awaiting the event team.'
  if (message === 'PROGRAM_CHANGE_REQUIRED') return 'Describe the program change you want the event team to make.'
  return 'This client portal link is invalid or no longer available.'
}

export const shareEventClientPortal = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  const eventId = text(data?.eventId, 220)
  if (!storeId || !eventId) throw new functions.https.HttpsError('invalid-argument', 'storeId and eventId are required')

  const storeData = await assertStoreAccess(storeId, context.auth.uid)
  const eventRef = defaultDb.collection('stores').doc(storeId).collection('events').doc(eventId)
  const [eventSnapshot, visibleTasks] = await Promise.all([
    eventRef.get(),
    eventRef.collection('tasks').where('clientVisible', '==', true).get(),
  ])
  if (!eventSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Event not found')

  const eventData = eventSnapshot.data() as RecordMap
  const recipientEmail = email(eventData.clientEmail)
  const recipientName = text(eventData.clientName, 180) || 'Client'
  if (!recipientEmail) throw new functions.https.HttpsError('failed-precondition', 'Add the client email before sharing the client portal')

  const token = createToken()
  const tokenHash = hashPublicContractToken(token)
  const portalUrl = `${functionPortalBaseUrl()}?token=${encodeURIComponent(token)}`
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + LINK_LIFETIME_DAYS * 86400000)
  const linkRef = defaultDb.collection('eventClientLinks').doc(tokenHash)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const brand = brandSnapshot(storeData)
  const programApproval = record(eventData.programApproval)
  const hasApprovedProgram = text(programApproval.status, 40) === 'approved'

  await defaultDb.runTransaction(async transaction => {
    const current = await transaction.get(eventRef)
    if (!current.exists) throw new functions.https.HttpsError('not-found', 'Event not found')

    const currentData = current.data() as RecordMap
    const currentPortal = record(currentData.clientPortal)
    const currentHash = text(currentPortal.publicLinkHash, 100)
    if (currentHash && currentHash !== tokenHash) {
      const currentLinkRef = defaultDb.collection('eventClientLinks').doc(currentHash)
      transaction.set(currentLinkRef, { status: 'revoked', revokedAt: now, updatedAt: now }, { merge: true })
    }

    transaction.set(linkRef, {
      storeId,
      eventId,
      recipientName,
      recipientEmail,
      status: 'active',
      expiresAt,
      brandSnapshot: brand,
      createdAt: now,
      updatedAt: now,
      createdBy: context.auth?.uid || null,
    })
    transaction.update(eventRef, {
      clientPortal: {
        status: 'active',
        publicLinkHash: tokenHash,
        publicUrl: portalUrl,
        expiresAt,
        sharedAt: now,
        sharedBy: context.auth?.uid || null,
      },
      updatedAt: now,
    })
  })

  const delivery = await sendEventContractEmail({
    storeId,
    eventType: 'event.client_portal_shared',
    reference: `${eventId}-client-portal-${tokenHash.slice(0, 12)}`,
    recipientType: 'customer',
    to: recipientEmail,
    subject: `Your event planning portal - ${text(brand.storeName, 180) || 'Event team'}`,
    title: 'Your event planning portal is ready',
    intro: `Hello ${recipientName}, your event team has shared a secure planning portal with you. You can update your event brief, review approved program information and work on any checklist tasks the team has shared.`,
    brand: {
      storeName: text(brand.storeName, 180) || 'Event team',
      email: email(brand.email),
      phone: text(brand.phone, 80),
      logoUrl: text(brand.logoUrl, 900),
      brandColor: text(brand.brandColor, 40) || '#4f46e5',
    },
    rows: [
      ['Event', text(eventData.title, 180) || text(eventData.eventType, 140) || 'Event'],
      ['Live brief', 'Editable by client'],
      ['Program', hasApprovedProgram ? 'Approved program available for review' : 'Not yet published'],
      ['Client tasks', String(visibleTasks.size)],
    ],
    primaryAction: { label: 'Open client portal', url: portalUrl },
    footerNote: `Sensitive approved documents stay read-only in the portal. Request a change and the event team can open a new revision. This secure link expires in ${LINK_LIFETIME_DAYS} days.`,
    customer: { name: recipientName, email: recipientEmail, phone: text(eventData.clientPhone, 80) },
    data: { eventId, portalUrl, clientTaskCount: visibleTasks.size, liveClientBrief: true, protectedProgramReview: true },
  })

  return { ok: true, portalUrl, expiresAt: expiresAt.toDate().toISOString(), deliveries: delivery.ok ? 1 : 0 }
})

export const eventClientPortal = functions.https.onRequest(async (req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0')
  res.set('X-Content-Type-Options', 'nosniff')
  const rawToken = text(req.method === 'POST' ? req.body?.token : req.query.token, 300)

  try {
    if (req.method === 'POST') {
      const action = text(req.body?.action, 40)
      const loaded = await loadPortalLink(rawToken)
      const now = admin.firestore.FieldValue.serverTimestamp()

      if (action === 'save_brief') {
        const brief = clientBriefFields(req.body?.brief)
        await defaultDb.runTransaction(async transaction => {
          const linkSnapshot = await transaction.get(loaded.linkRef)
          const eventSnapshot = await transaction.get(loaded.eventRef)
          if (!linkSnapshot.exists || !eventSnapshot.exists) throw new Error('INVALID_LINK')

          const link = linkSnapshot.data() as unknown as ClientPortalLink
          if (link.status !== 'active' || link.expiresAt.toMillis() < Date.now()) throw new Error('LINK_EXPIRED')
          const eventData = eventSnapshot.data() as RecordMap
          const livePortal = record(eventData.clientPortal)
          if (text(livePortal.publicLinkHash, 100) !== linkSnapshot.id || text(livePortal.status, 40) !== 'active') throw new Error('LINK_REVOKED')

          transaction.update(loaded.eventRef, {
            'clientBrief.requirements': brief.requirements,
            'clientBrief.themeColours': brief.themeColours,
            'clientBrief.venueRequirements': brief.venueRequirements,
            'clientBrief.catering': brief.catering,
            'clientBrief.decor': brief.decor,
            'clientBrief.entertainment': brief.entertainment,
            'clientBrief.photography': brief.photography,
            'clientBrief.transport': brief.transport,
            'clientBrief.accommodation': brief.accommodation,
            'clientBrief.specialInstructions': brief.specialInstructions,
            'clientBrief.clientUpdatedAt': now,
            'clientBrief.clientUpdatedBy': link.recipientEmail || link.recipientName || 'Client',
            updatedAt: now,
          })
        })
        res.json({ ok: true })
        return
      }

      if (action === 'request_program_change') {
        const note = text(req.body?.note, 3000)
        if (!note) throw new Error('PROGRAM_CHANGE_REQUIRED')
        const requestRef = loaded.eventRef.collection('programChangeRequests').doc()
        await defaultDb.runTransaction(async transaction => {
          const linkSnapshot = await transaction.get(loaded.linkRef)
          const eventSnapshot = await transaction.get(loaded.eventRef)
          if (!linkSnapshot.exists || !eventSnapshot.exists) throw new Error('INVALID_LINK')

          const link = linkSnapshot.data() as unknown as ClientPortalLink
          if (link.status !== 'active' || link.expiresAt.toMillis() < Date.now()) throw new Error('LINK_EXPIRED')
          const eventData = eventSnapshot.data() as RecordMap
          const livePortal = record(eventData.clientPortal)
          if (text(livePortal.publicLinkHash, 100) !== linkSnapshot.id || text(livePortal.status, 40) !== 'active') throw new Error('LINK_REVOKED')

          const approval = record(eventData.programApproval)
          if (text(approval.status, 40) !== 'approved') throw new Error('PROGRAM_NOT_APPROVED')
          const revision = Math.max(1, Math.floor(numberValue(approval.revision, 1)))
          const currentRequest = record(eventData.programChangeRequest)
          if (text(currentRequest.status, 40) === 'open') throw new Error('PROGRAM_CHANGE_ALREADY_OPEN')
          const requestedBy = link.recipientName || link.recipientEmail || 'Client'

          transaction.set(requestRef, {
            status: 'open',
            message: note,
            requestedBy,
            requestedByEmail: link.recipientEmail || '',
            requestedAt: now,
            revision,
            programApprovedAt: approval.approvedAt || null,
          })
          transaction.update(loaded.eventRef, {
            programChangeRequest: {
              id: requestRef.id,
              status: 'open',
              message: note,
              requestedBy,
              requestedAt: now,
              revision,
            },
            updatedAt: now,
          })
        })
        res.json({ ok: true, requestId: requestRef.id })
        return
      }

      const taskId = text(req.body?.taskId, 220)
      const note = text(req.body?.note, 3000)
      if (!['start', 'submit'].includes(action) || !taskId) {
        res.status(400).json({ error: 'Choose a valid client portal action.' })
        return
      }

      const taskRef = loaded.eventRef.collection('tasks').doc(taskId)
      const activityRef = loaded.eventRef.collection('clientActivity').doc()

      await defaultDb.runTransaction(async transaction => {
        const linkSnapshot = await transaction.get(loaded.linkRef)
        const eventSnapshot = await transaction.get(loaded.eventRef)
        const taskSnapshot = await transaction.get(taskRef)
        if (!linkSnapshot.exists || !eventSnapshot.exists || !taskSnapshot.exists) throw new Error('INVALID_LINK')

        const link = linkSnapshot.data() as unknown as ClientPortalLink
        if (link.status !== 'active' || link.expiresAt.toMillis() < Date.now()) throw new Error('LINK_EXPIRED')
        const eventData = eventSnapshot.data() as RecordMap
        const livePortal = record(eventData.clientPortal)
        if (text(livePortal.publicLinkHash, 100) !== linkSnapshot.id || text(livePortal.status, 40) !== 'active') throw new Error('LINK_REVOKED')

        const taskData = taskSnapshot.data() as RecordMap
        if (taskData.clientVisible !== true) throw new Error('TASK_NOT_SHARED')
        if (effectiveClientTaskState(taskData) === 'verified') throw new Error('TASK_ALREADY_DONE')
        const taskTitle = text(taskData.title, 240) || 'Event task'
        const currentStatus = text(taskData.status, 40) || 'todo'

        if (action === 'start') {
          if (effectiveClientTaskState(taskData) === 'submitted') return
          transaction.update(taskRef, {
            status: 'in_progress',
            clientState: effectiveClientTaskState(taskData) === 'changes_requested' ? 'changes_requested' : 'open',
            clientStartedAt: now,
            updatedAt: now,
          })
          transaction.set(activityRef, {
            type: 'client_started',
            taskId,
            taskTitle,
            note: 'Client started this task.',
            actor: link.recipientName || link.recipientEmail || 'Client',
            at: now,
            public: true,
          })
        } else {
          if (currentStatus === 'todo') throw new Error('TASK_NOT_STARTED')
          transaction.update(taskRef, {
            status: 'in_progress',
            clientState: 'submitted',
            clientSubmissionNote: note,
            clientSubmittedAt: now,
            clientStaffNote: '',
            updatedAt: now,
          })
          transaction.set(activityRef, {
            type: 'client_submitted',
            taskId,
            taskTitle,
            note,
            actor: link.recipientName || link.recipientEmail || 'Client',
            at: now,
            public: true,
          })
        }
        transaction.update(loaded.eventRef, { updatedAt: now })
      })

      res.json({ ok: true })
      return
    }

    const data = await portalData(rawToken)
    if (String(req.query.json || '') === '1') {
      res.json(data)
      return
    }
    res.status(200).type('html').send(eventClientPortalHtml(data, rawToken))
  } catch (error) {
    const message = errorMessage(error)
    if (String(req.query.json || '') === '1' || req.method === 'POST') {
      res.status(410).json({ error: message })
      return
    }
    res.status(410).type('html').send(`<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f7faf8;padding:40px"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #dfe8e2;border-radius:18px;padding:28px"><h1>Client portal unavailable</h1><p>${escapeHtml(message)}</p></div></body></html>`)
  }
})
