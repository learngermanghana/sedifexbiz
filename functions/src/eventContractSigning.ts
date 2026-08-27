import * as functions from 'firebase-functions/v1'
import { defineString } from 'firebase-functions/params'
import { randomBytes } from 'crypto'
import { admin, defaultDb } from './firestore'
import { eventContractAdminEmails, sendEventContractEmail } from './eventContractEmail'
import {
  buildEventContractPdf,
  hashPublicContractToken,
  signatureMatchesSigner,
  type EventContractPdfInput,
} from './eventContractSigningCore'

const SEDIFEX_PUBLIC_BASE_URL = defineString('SEDIFEX_PUBLIC_BASE_URL', { default: 'https://sedifex.com' })
const LINK_LIFETIME_DAYS = 30

type RecordMap = Record<string, unknown>

type ContractLinkRecord = {
  storeId: string
  eventId: string
  revision: number
  recipientEmail: string
  recipientName: string
  status: 'active' | 'changes_requested' | 'signed' | 'revoked'
  reviewUrl: string
  pdfUrl: string
  expiresAt: FirebaseFirestore.Timestamp
  eventSnapshot: RecordMap
  contractSnapshot: RecordMap
  brandSnapshot: RecordMap
  signerName?: string
  signerEmail?: string
  signatureText?: string
  signedAt?: FirebaseFirestore.Timestamp
}

function text(value: unknown, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function email(value: unknown) {
  const cleaned = text(value, 220).toLowerCase()
  return cleaned.includes('@') ? cleaned : ''
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

function publicBaseUrl() {
  return (SEDIFEX_PUBLIC_BASE_URL.value()?.trim() || process.env.SEDIFEX_PUBLIC_BASE_URL?.trim() || 'https://sedifex.com').replace(/\/$/, '')
}

function createPublicToken() {
  return randomBytes(32).toString('base64url')
}

async function assertStoreAccess(storeId: string, uid: string) {
  const [storeSnapshot, memberSnapshot] = await Promise.all([
    defaultDb.collection('stores').doc(storeId).get(),
    defaultDb.collection('teamMembers').doc(uid).get(),
  ])
  if (!storeSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'Store not found')
  }
  const storeData = storeSnapshot.data() as RecordMap
  const memberData = memberSnapshot.exists ? memberSnapshot.data() as RecordMap : {}
  const direct = text(memberData.uid, 220) === uid && text(memberData.storeId, 180) === storeId
  const linkedOwner = text(memberData.uid, 220) === uid
    && text(memberData.role, 40) === 'owner'
    && Boolean(text(memberData.storeId, 180))
    && text(storeData.parentStoreId, 180) === text(memberData.storeId, 180)
  const ownerUid = text(storeData.ownerUid, 220) === uid
  if (!direct && !linkedOwner && !ownerUid) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to this event workspace')
  }
  return storeData
}

function brandSnapshot(storeData: RecordMap) {
  return {
    storeName: text(storeData.displayName, 160) || text(storeData.businessName, 160) || text(storeData.name, 160) || 'Sedifex Store',
    email: email(storeData.email) || email(storeData.ownerEmail) || email(storeData.firstSignupEmail) || '',
    phone: text(storeData.phone, 80),
    logoUrl: text(storeData.logoUrl, 900),
    brandColor: text(storeData.brandColor, 40) || '#4f46e5',
  }
}

function emailBrand(value: RecordMap) {
  return {
    storeName: text(value.storeName, 180) || 'Sedifex Store',
    email: email(value.email),
    phone: text(value.phone, 80),
    logoUrl: text(value.logoUrl, 900),
    brandColor: text(value.brandColor, 40) || '#4f46e5',
  }
}

function eventSnapshot(eventData: RecordMap) {
  return {
    title: text(eventData.title, 180) || text(eventData.eventType, 140) || 'Event',
    eventCode: text(eventData.eventCode, 80),
    eventDate: text(eventData.eventDate, 40),
    startTime: text(eventData.startTime, 40),
    venue: text(eventData.venue, 220),
    clientName: text(eventData.clientName, 180) || 'Client',
    clientEmail: email(eventData.clientEmail),
  }
}

function contractSnapshot(eventData: RecordMap) {
  const approval = record(eventData.contractApproval)
  return {
    serviceAgreement: text(approval.serviceAgreement, 20000),
    scopeOfWork: text(approval.scopeOfWork, 20000),
    paymentTerms: text(approval.paymentTerms, 12000),
    cancellationPolicy: text(approval.cancellationPolicy, 12000),
    clientNotes: text(approval.clientNotes, 6000),
  }
}

function hasContractTerms(snapshot: RecordMap) {
  return Boolean(
    text(snapshot.serviceAgreement)
      || text(snapshot.scopeOfWork)
      || text(snapshot.paymentTerms)
      || text(snapshot.cancellationPolicy),
  )
}

function legacyApprovalDeliveryLogId(storeId: string, eventId: string, revision: number, recipientEmail: string) {
  return `${storeId}|event.approval_request|${eventId}-approval-r${revision}|customer|${recipientEmail}`.replace(/\//g, '_')
}

async function loadLink(token: string) {
  const cleaned = text(token, 300)
  if (!cleaned) throw new functions.https.HttpsError('invalid-argument', 'Contract link is required')
  const tokenHash = hashPublicContractToken(cleaned)
  const linkRef = defaultDb.collection('eventContractLinks').doc(tokenHash)
  const snapshot = await linkRef.get()
  if (!snapshot.exists) throw new functions.https.HttpsError('not-found', 'This contract link is invalid or no longer available')
  return { tokenHash, linkRef, data: snapshot.data() as unknown as ContractLinkRecord }
}

function ensureLinkUsable(link: ContractLinkRecord, allowSigned = true) {
  if (link.status === 'revoked') throw new functions.https.HttpsError('failed-precondition', 'This contract link has been replaced by a newer revision')
  if (link.status === 'signed' && allowSigned) return
  if (link.expiresAt?.toMillis && link.expiresAt.toMillis() < Date.now()) {
    throw new functions.https.HttpsError('deadline-exceeded', 'This contract link has expired. Ask the event team to resend it.')
  }
}

async function assertPublicLinkStillCurrent(tokenHash: string, link: ContractLinkRecord) {
  const eventSnapshot = await defaultDb.collection('stores').doc(link.storeId).collection('events').doc(link.eventId).get()
  if (!eventSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Event not found')
  const eventData = eventSnapshot.data() as RecordMap
  const approval = record(eventData.contractApproval)
  const currentRevision = Math.max(1, Math.floor(numberValue(approval.revision, 1)))
  if (currentRevision !== link.revision || text(approval.publicLinkHash, 100) !== tokenHash) {
    throw new functions.https.HttpsError('failed-precondition', 'A newer contract revision is available')
  }
  const approvalStatus = text(approval.status, 40).toLowerCase()
  if (link.status === 'active' && approvalStatus !== 'sent') {
    throw new functions.https.HttpsError('failed-precondition', 'This contract is no longer awaiting client review')
  }
  if (link.status === 'signed' && approvalStatus !== 'approved') {
    throw new functions.https.HttpsError('failed-precondition', 'This signed contract record is no longer current')
  }
}

function pdfInput(link: ContractLinkRecord): EventContractPdfInput {
  const eventData = record(link.eventSnapshot)
  const contract = record(link.contractSnapshot)
  const brand = record(link.brandSnapshot)
  return {
    storeName: text(brand.storeName, 160) || 'Sedifex Store',
    storeEmail: email(brand.email),
    storePhone: text(brand.phone, 80),
    eventTitle: text(eventData.title, 180) || 'Event',
    eventCode: text(eventData.eventCode, 80),
    eventDate: text(eventData.eventDate, 40),
    eventTime: text(eventData.startTime, 40),
    venue: text(eventData.venue, 220),
    clientName: text(eventData.clientName, 180) || link.recipientName || 'Client',
    clientEmail: email(eventData.clientEmail) || link.recipientEmail,
    revision: Math.max(1, Math.floor(numberValue(link.revision, 1))),
    serviceAgreement: text(contract.serviceAgreement, 20000),
    scopeOfWork: text(contract.scopeOfWork, 20000),
    paymentTerms: text(contract.paymentTerms, 12000),
    cancellationPolicy: text(contract.cancellationPolicy, 12000),
    signerName: text(link.signerName, 180),
    signerEmail: email(link.signerEmail),
    signatureText: text(link.signatureText, 180),
    signedAt: isoDate(link.signedAt) || undefined,
  }
}

function fileNameFor(link: ContractLinkRecord) {
  const eventData = record(link.eventSnapshot)
  const raw = text(eventData.eventCode, 80) || text(eventData.title, 120) || 'event-contract'
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'event-contract'
  return `${safe}-revision-${Math.max(1, Math.floor(numberValue(link.revision, 1)))}${link.status === 'signed' ? '-signed' : ''}.pdf`
}

function emailRows(link: ContractLinkRecord) {
  const eventData = record(link.eventSnapshot)
  const rows: Array<[string, string]> = [
    ['Event', text(eventData.title, 180) || 'Event'],
    ['Contract revision', String(link.revision)],
  ]
  if (text(eventData.eventCode, 80)) rows.push(['Event reference', text(eventData.eventCode, 80)])
  if (text(eventData.eventDate, 40)) rows.push(['Event date', text(eventData.eventDate, 40)])
  if (text(eventData.venue, 220)) rows.push(['Venue', text(eventData.venue, 220)])
  return rows
}

export const sendEventContractForSignature = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required')
  const storeId = text(data?.storeId, 180)
  const eventId = text(data?.eventId, 220)
  if (!storeId || !eventId) throw new functions.https.HttpsError('invalid-argument', 'storeId and eventId are required')

  const storeData = await assertStoreAccess(storeId, context.auth.uid)
  const eventRef = defaultDb.collection('stores').doc(storeId).collection('events').doc(eventId)
  const eventDoc = await eventRef.get()
  if (!eventDoc.exists) throw new functions.https.HttpsError('not-found', 'Event not found')
  const eventData = eventDoc.data() as RecordMap
  const approval = record(eventData.contractApproval)
  const revision = Math.max(1, Math.floor(numberValue(approval.revision, 1)))
  const contract = contractSnapshot(eventData)
  if (!hasContractTerms(contract)) {
    throw new functions.https.HttpsError('failed-precondition', 'Save the contract terms before sending it to the client')
  }
  const recipientEmail = email(approval.signerEmail) || email(eventData.clientEmail)
  const recipientName = text(approval.signerName, 180) || text(eventData.clientName, 180) || 'Client'
  if (!recipientEmail) throw new functions.https.HttpsError('failed-precondition', 'Add the client email before sending the contract')

  const token = createPublicToken()
  const tokenHash = hashPublicContractToken(token)
  const reviewUrl = `${publicBaseUrl()}/event-contract/${encodeURIComponent(token)}`
  const pdfUrl = `${reviewUrl}?download=1`
  const linkRef = defaultDb.collection('eventContractLinks').doc(tokenHash)
  const historyRef = eventRef.collection('contractApprovalHistory').doc()
  const previousHash = text(approval.publicLinkHash, 100)
  const previousRef = previousHash ? defaultDb.collection('eventContractLinks').doc(previousHash) : null
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + LINK_LIFETIME_DAYS * 86400000)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const eventCopy = eventSnapshot(eventData)
  const brandCopy = brandSnapshot(storeData)
  const legacyLogRef = defaultDb.collection('notification_delivery_log').doc(
    legacyApprovalDeliveryLogId(storeId, eventId, revision, recipientEmail),
  )

  await defaultDb.runTransaction(async transaction => {
    const currentEvent = await transaction.get(eventRef)
    if (!currentEvent.exists) throw new functions.https.HttpsError('not-found', 'Event not found')
    const currentData = currentEvent.data() as RecordMap
    const currentApproval = record(currentData.contractApproval)
    const currentRevision = Math.max(1, Math.floor(numberValue(currentApproval.revision, 1)))
    if (currentRevision !== revision) {
      throw new functions.https.HttpsError('aborted', 'The contract changed. Reload it before sending.')
    }
    if (email(currentApproval.signerEmail) !== recipientEmail || (text(currentApproval.signerName, 180) || text(currentData.clientName, 180) || 'Client') !== recipientName) {
      throw new functions.https.HttpsError('aborted', 'The contract recipient changed. Reload it before sending.')
    }
    if (previousRef && previousHash !== tokenHash) {
      transaction.set(previousRef, { status: 'revoked', revokedAt: now, replacedByHash: tokenHash }, { merge: true })
    }
    transaction.set(linkRef, {
      storeId,
      eventId,
      revision,
      recipientEmail,
      recipientName,
      status: 'active',
      reviewUrl,
      pdfUrl,
      expiresAt,
      eventSnapshot: eventCopy,
      contractSnapshot: contract,
      brandSnapshot: brandCopy,
      createdAt: now,
      updatedAt: now,
      createdBy: context.auth?.uid || null,
    })
    transaction.set(legacyLogRef, {
      storeId,
      eventType: 'event.approval_request',
      reference: `${eventId}-approval-r${revision}`,
      recipientType: 'customer',
      to: recipientEmail,
      suppressedBy: 'event_contract_signing',
      createdAt: now,
    }, { merge: true })
    transaction.update(eventRef, {
      'contractApproval.status': 'sent',
      'contractApproval.sentAt': now,
      'contractApproval.approvedAt': null,
      'contractApproval.signedAt': null,
      'contractApproval.signatureText': '',
      'contractApproval.signatureConsent': false,
      'contractApproval.signerName': text(currentApproval.signerName, 180) || recipientName,
      'contractApproval.signerEmail': recipientEmail,
      'contractApproval.publicLinkHash': tokenHash,
      'contractApproval.publicReviewUrl': reviewUrl,
      'contractApproval.publicPdfUrl': pdfUrl,
      'contractApproval.publicLinkExpiresAt': expiresAt,
      'contractApproval.deliveryManagedBy': 'event_contract_signing',
      updatedAt: now,
    })
    transaction.set(historyRef, {
      action: 'sent_to_client',
      status: 'sent',
      at: now,
      note: `Revision ${revision} emailed to the client with a secure review and PDF link.`,
      actor: 'Sedifex staff',
      revision,
    })
  })

  const brand = emailBrand(brandCopy)
  const sendResult = await sendEventContractEmail({
    storeId,
    eventType: 'event.contract_sent',
    reference: `${eventId}-contract-r${revision}-${tokenHash.slice(0, 12)}`,
    recipientType: 'customer',
    to: recipientEmail,
    subject: `Contract ready for review - ${brand.storeName}`,
    title: 'Your event contract is ready',
    intro: `Hello ${recipientName}, ${brand.storeName} has prepared revision ${revision} of your event agreement. Review the terms, download the PDF and sign online when you are ready.`,
    brand,
    rows: emailRows({
      storeId,
      eventId,
      revision,
      recipientEmail,
      recipientName,
      status: 'active',
      reviewUrl,
      pdfUrl,
      expiresAt,
      eventSnapshot: eventCopy,
      contractSnapshot: contract,
      brandSnapshot: brandCopy,
    }),
    primaryAction: { label: 'Review & sign contract', url: reviewUrl },
    secondaryAction: { label: 'Download contract PDF', url: pdfUrl },
    footerNote: `This secure link expires in ${LINK_LIFETIME_DAYS} days. If you need changes, use the request-changes option on the contract page.`,
    customer: { name: recipientName, email: recipientEmail, phone: text(eventData.clientPhone, 80) },
    data: { eventId, eventCode: text(eventCopy.eventCode, 80), revision, reviewUrl, pdfUrl },
  })

  await eventRef.set({
    contractApproval: {
      emailQueuedAt: admin.firestore.FieldValue.serverTimestamp(),
      emailDeliveries: sendResult.ok ? 1 : 0,
      emailDeliveryStatus: sendResult.ok ? 'queued' : 'failed',
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })

  return { ok: true, revision, reviewUrl, pdfUrl, deliveries: sendResult.ok ? 1 : 0 }
})

export const getPublicEventContract = functions.https.onCall(async data => {
  const { tokenHash, data: link } = await loadLink(text(data?.token, 300))
  ensureLinkUsable(link)
  await assertPublicLinkStillCurrent(tokenHash, link)
  return {
    ok: true,
    status: link.status,
    revision: link.revision,
    expiresAt: isoDate(link.expiresAt),
    event: link.eventSnapshot,
    contract: link.contractSnapshot,
    brand: link.brandSnapshot,
    signer: link.status === 'signed' ? {
      name: text(link.signerName, 180),
      email: email(link.signerEmail),
      signatureText: text(link.signatureText, 180),
      signedAt: isoDate(link.signedAt),
    } : null,
  }
})

export const getPublicEventContractPdf = functions.https.onCall(async data => {
  const { tokenHash, data: link } = await loadLink(text(data?.token, 300))
  ensureLinkUsable(link)
  await assertPublicLinkStillCurrent(tokenHash, link)
  const pdf = buildEventContractPdf(pdfInput(link))
  return {
    ok: true,
    mimeType: 'application/pdf',
    fileName: fileNameFor(link),
    base64: pdf.toString('base64'),
  }
})

export const requestPublicEventContractChanges = functions.https.onCall(async data => {
  const token = text(data?.token, 300)
  const note = text(data?.note, 4000)
  if (note.length < 3) throw new functions.https.HttpsError('invalid-argument', 'Tell the event team what should be changed')
  const { linkRef, data: initialLink } = await loadLink(token)
  ensureLinkUsable(initialLink, false)
  if (initialLink.status !== 'active') throw new functions.https.HttpsError('failed-precondition', 'This contract is not awaiting changes')
  const eventRef = defaultDb.collection('stores').doc(initialLink.storeId).collection('events').doc(initialLink.eventId)
  const historyRef = eventRef.collection('contractApprovalHistory').doc()
  const now = admin.firestore.FieldValue.serverTimestamp()

  await defaultDb.runTransaction(async transaction => {
    const linkSnapshot = await transaction.get(linkRef)
    const eventSnapshot = await transaction.get(eventRef)
    if (!linkSnapshot.exists || !eventSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Contract record not found')
    const link = linkSnapshot.data() as unknown as ContractLinkRecord
    if (link.status !== 'active') throw new functions.https.HttpsError('failed-precondition', 'This contract is no longer awaiting review')
    const eventData = eventSnapshot.data() as RecordMap
    const approval = record(eventData.contractApproval)
    if (text(approval.status, 40).toLowerCase() !== 'sent') {
      throw new functions.https.HttpsError('failed-precondition', 'This contract is no longer awaiting client review')
    }
    if (Math.max(1, Math.floor(numberValue(approval.revision, 1))) !== link.revision || text(approval.publicLinkHash, 100) !== linkSnapshot.id) {
      throw new functions.https.HttpsError('failed-precondition', 'A newer contract revision is available')
    }
    transaction.set(linkRef, { status: 'changes_requested', changeRequest: note, changesRequestedAt: now, updatedAt: now }, { merge: true })
    transaction.update(eventRef, {
      'contractApproval.status': 'changes_requested',
      'contractApproval.clientNotes': note,
      'contractApproval.changesRequestedAt': now,
      updatedAt: now,
    })
    transaction.set(historyRef, {
      action: 'changes_requested',
      status: 'changes_requested',
      at: now,
      note,
      actor: initialLink.recipientName || initialLink.recipientEmail || 'Client',
      revision: link.revision,
    })
  })

  const brand = emailBrand(initialLink.brandSnapshot)
  const rows = emailRows(initialLink)
  const reference = `${initialLink.eventId}-contract-r${initialLink.revision}-changes-${Date.now()}`
  const clientResult = await sendEventContractEmail({
    storeId: initialLink.storeId,
    eventType: 'event.contract_changes_requested',
    reference,
    recipientType: 'customer',
    to: initialLink.recipientEmail,
    subject: `Contract change request received - ${brand.storeName}`,
    title: 'Your change request was recorded',
    intro: `Hello ${initialLink.recipientName || 'there'}, your requested changes were sent to ${brand.storeName}. The team will revise the agreement and send you a new secure link when it is ready.`,
    brand,
    rows,
    primaryAction: { label: 'View current contract', url: initialLink.reviewUrl },
    customer: { name: initialLink.recipientName, email: initialLink.recipientEmail },
    data: { eventId: initialLink.eventId, revision: initialLink.revision, notes: note },
  })
  const admins = await eventContractAdminEmails(initialLink.storeId, brand.email)
  await Promise.all(admins.map(to => sendEventContractEmail({
    storeId: initialLink.storeId,
    eventType: 'event.contract_changes_requested',
    reference,
    recipientType: 'store',
    to,
    subject: `Client requested contract changes - ${text(record(initialLink.eventSnapshot).title, 180) || 'Event'}`,
    title: 'Client requested contract changes',
    intro: `${initialLink.recipientName || initialLink.recipientEmail} requested changes to revision ${initialLink.revision}. Review the note in the Event Planning workspace before resending the contract.`,
    brand,
    rows: [...rows, ['Requested change', note]],
    customer: { name: initialLink.recipientName, email: initialLink.recipientEmail },
    data: { eventId: initialLink.eventId, revision: initialLink.revision, notes: note },
  })))
  return { ok: true, emailQueued: clientResult.ok }
})

export const signPublicEventContract = functions.https.onCall(async (data, context) => {
  const token = text(data?.token, 300)
  const signerName = text(data?.signerName, 180)
  const signatureText = text(data?.signatureText, 180)
  const consent = data?.consent === true
  if (!signerName || !signatureText || !consent) {
    throw new functions.https.HttpsError('invalid-argument', 'Enter your full name, type the same name as your signature, and confirm consent')
  }
  if (!signatureMatchesSigner(signerName, signatureText)) {
    throw new functions.https.HttpsError('invalid-argument', 'The typed signature must match the signer full name')
  }

  const { tokenHash, linkRef, data: initialLink } = await loadLink(token)
  ensureLinkUsable(initialLink, false)
  if (initialLink.status !== 'active') throw new functions.https.HttpsError('failed-precondition', 'This contract is not currently awaiting signature')
  const eventRef = defaultDb.collection('stores').doc(initialLink.storeId).collection('events').doc(initialLink.eventId)
  const historyRef = eventRef.collection('contractApprovalHistory').doc()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const userAgent = text(context.rawRequest?.headers?.['user-agent'], 500)
  const forwarded = text(context.rawRequest?.headers?.['x-forwarded-for'], 300).split(',')[0].trim()
  const ipHash = forwarded ? hashPublicContractToken(`${tokenHash}|${forwarded}`) : null

  await defaultDb.runTransaction(async transaction => {
    const linkSnapshot = await transaction.get(linkRef)
    const eventSnapshot = await transaction.get(eventRef)
    if (!linkSnapshot.exists || !eventSnapshot.exists) throw new functions.https.HttpsError('not-found', 'Contract record not found')
    const link = linkSnapshot.data() as unknown as ContractLinkRecord
    if (link.status !== 'active') throw new functions.https.HttpsError('failed-precondition', 'This contract is no longer awaiting signature')
    if (link.expiresAt.toMillis() < Date.now()) throw new functions.https.HttpsError('deadline-exceeded', 'This contract link has expired')
    const eventData = eventSnapshot.data() as RecordMap
    const approval = record(eventData.contractApproval)
    if (text(approval.status, 40).toLowerCase() !== 'sent') {
      throw new functions.https.HttpsError('failed-precondition', 'This contract is no longer awaiting client signature')
    }
    if (Math.max(1, Math.floor(numberValue(approval.revision, 1))) !== link.revision || text(approval.publicLinkHash, 100) !== linkSnapshot.id) {
      throw new functions.https.HttpsError('failed-precondition', 'A newer contract revision is available')
    }
    transaction.set(linkRef, {
      status: 'signed',
      signerName,
      signerEmail: link.recipientEmail,
      signatureText,
      signatureConsent: true,
      signedAt: now,
      userAgent: userAgent || null,
      ipHash,
      updatedAt: now,
    }, { merge: true })
    transaction.update(eventRef, {
      'contractApproval.status': 'approved',
      'contractApproval.approvedAt': now,
      'contractApproval.signedAt': now,
      'contractApproval.signerName': signerName,
      'contractApproval.signerEmail': link.recipientEmail,
      'contractApproval.signatureText': signatureText,
      'contractApproval.signatureConsent': true,
      'contractApproval.signatureMethod': 'public_secure_link',
      'contractApproval.signatureUserAgent': userAgent || null,
      'contractApproval.signatureIpHash': ipHash,
      updatedAt: now,
    })
    transaction.set(historyRef, {
      action: 'client_signed',
      status: 'approved',
      at: now,
      note: `Revision ${link.revision} approved by the client through the secure contract link.`,
      actor: signerName,
      revision: link.revision,
    })
  })

  const signedLink: ContractLinkRecord = { ...initialLink, status: 'signed', signerName, signerEmail: initialLink.recipientEmail, signatureText }
  const brand = emailBrand(initialLink.brandSnapshot)
  const rows: Array<[string, string]> = [...emailRows(signedLink), ['Signed by', signerName]]
  const reference = `${initialLink.eventId}-contract-r${initialLink.revision}-signed`
  const clientResult = await sendEventContractEmail({
    storeId: initialLink.storeId,
    eventType: 'event.contract_signed',
    reference,
    recipientType: 'customer',
    to: initialLink.recipientEmail,
    subject: `Signed contract confirmed - ${brand.storeName}`,
    title: 'Your signed contract is confirmed',
    intro: `Hello ${signerName}, revision ${initialLink.revision} has been signed successfully. Download the signed PDF below and keep it for your records.`,
    brand,
    rows,
    primaryAction: { label: 'Download signed contract PDF', url: initialLink.pdfUrl },
    secondaryAction: { label: 'View signed contract', url: initialLink.reviewUrl },
    customer: { name: signerName, email: initialLink.recipientEmail },
    data: { eventId: initialLink.eventId, revision: initialLink.revision, pdfUrl: initialLink.pdfUrl, reviewUrl: initialLink.reviewUrl },
  })
  const admins = await eventContractAdminEmails(initialLink.storeId, brand.email)
  const adminResults = await Promise.all(admins.map(to => sendEventContractEmail({
    storeId: initialLink.storeId,
    eventType: 'event.contract_signed',
    reference,
    recipientType: 'store',
    to,
    subject: `Client signed event contract - ${text(record(initialLink.eventSnapshot).title, 180) || 'Event'}`,
    title: 'Client signed the event contract',
    intro: `${signerName} signed revision ${initialLink.revision}. The signed PDF is ready for your records.`,
    brand,
    rows,
    primaryAction: { label: 'Download signed contract PDF', url: initialLink.pdfUrl },
    secondaryAction: { label: 'View signed contract', url: initialLink.reviewUrl },
    customer: { name: signerName, email: initialLink.recipientEmail },
    data: { eventId: initialLink.eventId, revision: initialLink.revision, pdfUrl: initialLink.pdfUrl, reviewUrl: initialLink.reviewUrl },
  })))

  await eventRef.set({
    contractApproval: {
      signedEmailQueuedAt: admin.firestore.FieldValue.serverTimestamp(),
      signedEmailDeliveries: (clientResult.ok ? 1 : 0) + adminResults.filter(result => result.ok).length,
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true })

  return { ok: true, pdfUrl: initialLink.pdfUrl, reviewUrl: initialLink.reviewUrl }
})
