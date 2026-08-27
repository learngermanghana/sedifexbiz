import React, { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import EventChecklistShareCard from './EventChecklistShareCard'
import EventContractTemplateManager, { type ContractTemplateFields } from './EventContractTemplateManager'
import EventOperationsWorkspace from './EventOperationsWorkspace'

type ApprovalStatus = 'draft' | 'sent' | 'approved' | 'changes_requested'
type ApprovalAction = 'draft_saved' | 'sent_to_client' | 'changes_requested' | 'client_signed'
type WorkspaceSection = 'contract' | 'operations'

type ApprovalHistoryEntry = {
  action: ApprovalAction
  status: ApprovalStatus
  at: Date
  note: string
  actor: string
}

type ContractApproval = ContractTemplateFields & {
  status: ApprovalStatus
  revision: number
  clientNotes: string
  signerName: string
  signerEmail: string
  signatureText: string
  signatureConsent: boolean
  sentAt: Date | null
  approvedAt: Date | null
  changesRequestedAt: Date | null
  signedAt: Date | null
  publicReviewUrl: string
  publicPdfUrl: string
  history: ApprovalHistoryEntry[]
}

type EventApprovalTarget = {
  id: string
  eventCode: string
  title: string
  clientName: string
  clientEmail: string
}

type Props = {
  storeId: string
  event: EventApprovalTarget
  onClose: () => void
  onChanged?: () => void | Promise<void>
}

const EMPTY_CONTRACT: ContractApproval = {
  status: 'draft',
  revision: 1,
  serviceAgreement: '',
  scopeOfWork: '',
  paymentTerms: '',
  cancellationPolicy: '',
  clientNotes: '',
  signerName: '',
  signerEmail: '',
  signatureText: '',
  signatureConsent: false,
  sentAt: null,
  approvedAt: null,
  changesRequestedAt: null,
  signedAt: null,
  publicReviewUrl: '',
  publicPdfUrl: '',
  history: [],
}

const CONTRACT_CONFLICT_ERROR = 'EVENT_CONTRACT_CONFLICT'

const STATUS_LABELS: Record<ApprovalStatus, string> = {
  draft: 'Draft',
  sent: 'Sent to client',
  approved: 'Approved & signed',
  changes_requested: 'Changes requested',
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  if (value && typeof value === 'object' && typeof (value as Timestamp).toDate === 'function') return (value as Timestamp).toDate()
  return null
}

function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return ['draft', 'sent', 'approved', 'changes_requested'].includes(String(value))
}

function isApprovalAction(value: unknown): value is ApprovalAction {
  return ['draft_saved', 'sent_to_client', 'changes_requested', 'client_signed'].includes(String(value))
}

function isStoredContract(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function mapHistory(value: unknown): ApprovalHistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const at = toDate(row.at)
    if (!at || !isApprovalAction(row.action) || !isApprovalStatus(row.status)) return []
    return [{
      action: row.action,
      status: row.status,
      at,
      note: text(row.note),
      actor: text(row.actor) || 'Sedifex user',
    }]
  })
}

function mapContract(value: unknown): ContractApproval {
  if (!value || typeof value !== 'object') return { ...EMPTY_CONTRACT, history: [] }
  const raw = value as Record<string, unknown>
  return {
    status: isApprovalStatus(raw.status) ? raw.status : 'draft',
    revision: Math.max(1, Math.floor(Number(raw.revision) || 1)),
    serviceAgreement: text(raw.serviceAgreement),
    scopeOfWork: text(raw.scopeOfWork),
    paymentTerms: text(raw.paymentTerms),
    cancellationPolicy: text(raw.cancellationPolicy),
    clientNotes: text(raw.clientNotes),
    signerName: text(raw.signerName),
    signerEmail: text(raw.signerEmail),
    signatureText: text(raw.signatureText),
    signatureConsent: raw.signatureConsent === true,
    sentAt: toDate(raw.sentAt),
    approvedAt: toDate(raw.approvedAt),
    changesRequestedAt: toDate(raw.changesRequestedAt),
    signedAt: toDate(raw.signedAt),
    publicReviewUrl: text(raw.publicReviewUrl),
    publicPdfUrl: text(raw.publicPdfUrl),
    history: mapHistory(raw.history),
  }
}

function formatDateTime(value: Date | null) {
  if (!value) return '—'
  return value.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusClass(status: ApprovalStatus) {
  if (status === 'approved') return 'confirmed'
  if (status === 'sent' || status === 'changes_requested') return 'awaiting_client'
  return 'new'
}

function termsFingerprint(contract: ContractTemplateFields) {
  return [
    contract.serviceAgreement.trim(),
    contract.scopeOfWork.trim(),
    contract.paymentTerms.trim(),
    contract.cancellationPolicy.trim(),
  ].join('\n---\n')
}

function hasPersistedTerms(contract: ContractTemplateFields) {
  return Boolean(
    contract.serviceAgreement.trim()
    || contract.scopeOfWork.trim()
    || contract.paymentTerms.trim()
    || contract.cancellationPolicy.trim(),
  )
}

function normalizeSignature(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function contractFingerprint(contract: ContractApproval) {
  return JSON.stringify({
    status: contract.status,
    revision: contract.revision,
    serviceAgreement: contract.serviceAgreement,
    scopeOfWork: contract.scopeOfWork,
    paymentTerms: contract.paymentTerms,
    cancellationPolicy: contract.cancellationPolicy,
    clientNotes: contract.clientNotes,
    signerName: contract.signerName,
    signerEmail: contract.signerEmail,
    signatureText: contract.signatureText,
    signatureConsent: contract.signatureConsent,
    sentAt: contract.sentAt?.toISOString() || null,
    approvedAt: contract.approvedAt?.toISOString() || null,
    changesRequestedAt: contract.changesRequestedAt?.toISOString() || null,
    signedAt: contract.signedAt?.toISOString() || null,
    publicReviewUrl: contract.publicReviewUrl,
    publicPdfUrl: contract.publicPdfUrl,
    history: contract.history.map(item => ({
      action: item.action,
      status: item.status,
      at: item.at.toISOString(),
      note: item.note,
      actor: item.actor,
    })),
  })
}

export default function EventContractApprovals({ storeId, event, onClose, onChanged }: Props) {
  const [section, setSection] = useState<WorkspaceSection>('contract')
  const [contract, setContract] = useState<ContractApproval>({ ...EMPTY_CONTRACT, signerName: event.clientName, signerEmail: event.clientEmail })
  const [loadedContract, setLoadedContract] = useState<ContractApproval | null>(null)
  const [loadedHadPersistedApproval, setLoadedHadPersistedApproval] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function refreshContract() {
    const snapshot = await getDoc(doc(db, 'stores', storeId, 'events', event.id))
    const rawContract = snapshot.data()?.contractApproval
    const mapped = mapContract(rawContract)
    const historySnapshot = await getDocs(collection(db, 'stores', storeId, 'events', event.id, 'contractApprovalHistory'))
    const serverHistory = historySnapshot.docs.flatMap(historyDoc => mapHistory([historyDoc.data()]))
    const hydrated = {
      ...mapped,
      signerName: mapped.signerName || event.clientName,
      signerEmail: mapped.signerEmail || event.clientEmail,
      history: [...mapped.history, ...serverHistory].sort((a, b) => a.at.getTime() - b.at.getTime()),
    }
    setContract(hydrated)
    setLoadedContract(mapped)
    setLoadedHadPersistedApproval(isStoredContract(rawContract))
    return hydrated
  }

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const snapshot = await getDoc(doc(db, 'stores', storeId, 'events', event.id))
        if (!active) return
        const rawContract = snapshot.data()?.contractApproval
        const mapped = mapContract(rawContract)
        const historySnapshot = await getDocs(collection(db, 'stores', storeId, 'events', event.id, 'contractApprovalHistory'))
        if (!active) return
        const serverHistory = historySnapshot.docs.flatMap(historyDoc => mapHistory([historyDoc.data()]))
        const hydrated = {
          ...mapped,
          signerName: mapped.signerName || event.clientName,
          signerEmail: mapped.signerEmail || event.clientEmail,
          history: [...mapped.history, ...serverHistory].sort((a, b) => a.at.getTime() - b.at.getTime()),
        }
        setContract(hydrated)
        setLoadedContract(mapped)
        setLoadedHadPersistedApproval(isStoredContract(rawContract))
      } catch (loadError) {
        console.error('[event-contract] Unable to load approval record', loadError)
        if (active) setError('The contract approval record could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [storeId, event.id, event.clientEmail, event.clientName])

  const termsChanged = useMemo(
    () => loadedContract ? termsFingerprint(contract) !== termsFingerprint(loadedContract) : false,
    [contract, loadedContract],
  )

  const hasTerms = hasPersistedTerms(contract)

  function update<K extends keyof ContractApproval>(key: K, value: ContractApproval[K]) {
    setContract(previous => ({ ...previous, [key]: value }))
    setSuccess(null)
  }

  function applyTemplate(fields: ContractTemplateFields, templateName: string) {
    const matchesPersistedTerms = Boolean(
      loadedContract && termsFingerprint(fields) === termsFingerprint(loadedContract),
    )

    setContract(previous => ({
      ...previous,
      ...fields,
      ...(matchesPersistedTerms && loadedContract
        ? {
            status: loadedContract.status,
            signerName: loadedContract.signerName || event.clientName,
            signerEmail: loadedContract.signerEmail || event.clientEmail,
            signatureText: loadedContract.signatureText,
            signatureConsent: loadedContract.signatureConsent,
            approvedAt: loadedContract.approvedAt,
            signedAt: loadedContract.signedAt,
          }
        : {
            status: 'draft' as ApprovalStatus,
            signatureText: '',
            signatureConsent: false,
            approvedAt: null,
            signedAt: null,
          }),
    }))
    setError(null)
    setSuccess(
      matchesPersistedTerms
        ? `“${templateName}” matches the saved contract terms. Persisted approval, signer identity and signature were restored.`
        : `“${templateName}” applied. Review the wording, adjust it for this event and save the draft before sending.`,
    )
  }

  async function persist(action: ApprovalAction): Promise<boolean> {
    if (!hasTerms) {
      setError('Add the agreement, scope, payment terms or cancellation policy before continuing.')
      return false
    }
    if (!loadedContract) {
      setError('Reload this contract before saving so Sedifex can verify the current revision.')
      return false
    }

    if (action === 'client_signed') {
      if (!contract.signerName.trim() || !contract.signatureText.trim() || !contract.signatureConsent) {
        setError('Enter the signer name and typed signature, then confirm the consent checkbox.')
        return false
      }
      if (normalizeSignature(contract.signerName) !== normalizeSignature(contract.signatureText)) {
        setError('The typed signature must match the signer full name.')
        return false
      }
    }

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const eventRef = doc(db, 'stores', storeId, 'events', event.id)
      const historyRef = doc(collection(eventRef, 'contractApprovalHistory'))
      const loadedSnapshot = loadedContract
      const localContract = contract

      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(eventRef)
        if (!snapshot.exists()) throw new Error('EVENT_NOT_FOUND')

        const rawCurrent = snapshot.data()?.contractApproval
        const currentHadPersistedApproval = isStoredContract(rawCurrent)
        const current = mapContract(rawCurrent)
        const persistedStateChanged = currentHadPersistedApproval !== loadedHadPersistedApproval
          || (currentHadPersistedApproval && contractFingerprint(current) !== contractFingerprint(loadedSnapshot))
        if (persistedStateChanged) throw new Error(CONTRACT_CONFLICT_ERROR)

        const currentTermsChanged = termsFingerprint(localContract) !== termsFingerprint(current)
        const revision = currentTermsChanged && hasPersistedTerms(current) ? current.revision + 1 : current.revision
        let status: ApprovalStatus = current.status
        let sentAt: Date | null | ReturnType<typeof serverTimestamp> = current.sentAt
        let approvedAt: Date | null | ReturnType<typeof serverTimestamp> = current.approvedAt
        let changesRequestedAt: Date | null | ReturnType<typeof serverTimestamp> = current.changesRequestedAt
        let signedAt: Date | null | ReturnType<typeof serverTimestamp> = current.signedAt
        let signerName = localContract.signerName.trim()
        let signerEmail = localContract.signerEmail.trim().toLowerCase()
        let signatureText = localContract.signatureText.trim()
        let signatureConsent = localContract.signatureConsent
        let note = ''
        let actor = 'Sedifex staff'

        if (currentTermsChanged && current.status === 'approved' && action !== 'client_signed') {
          approvedAt = null
          signedAt = null
          signatureText = ''
          signatureConsent = false
        }

        if (action === 'draft_saved') {
          if (current.status === 'approved' && !currentTermsChanged) {
            status = 'approved'
            signerName = current.signerName
            signerEmail = current.signerEmail
            signatureText = current.signatureText
            signatureConsent = current.signatureConsent
            approvedAt = current.approvedAt
            signedAt = current.signedAt
            note = `Approved revision ${revision} retained because the contract terms did not change.`
          } else {
            status = 'draft'
            note = currentTermsChanged ? `Contract terms saved as revision ${revision}.` : 'Contract draft saved.'
          }
        }
        if (action === 'sent_to_client') {
          status = 'sent'
          sentAt = serverTimestamp()
          approvedAt = null
          signedAt = null
          signatureText = ''
          signatureConsent = false
          note = `Revision ${revision} marked as sent to the client.`
        }
        if (action === 'changes_requested') {
          status = 'changes_requested'
          changesRequestedAt = serverTimestamp()
          approvedAt = null
          signedAt = null
          signatureText = ''
          signatureConsent = false
          note = localContract.clientNotes.trim() || 'Client changes requested.'
        }
        if (action === 'client_signed') {
          status = 'approved'
          approvedAt = serverTimestamp()
          signedAt = serverTimestamp()
          actor = signerName
          note = `Revision ${revision} approved with typed signature.`
        }

        transaction.update(eventRef, {
          'contractApproval.status': status,
          'contractApproval.revision': revision,
          'contractApproval.serviceAgreement': localContract.serviceAgreement.trim(),
          'contractApproval.scopeOfWork': localContract.scopeOfWork.trim(),
          'contractApproval.paymentTerms': localContract.paymentTerms.trim(),
          'contractApproval.cancellationPolicy': localContract.cancellationPolicy.trim(),
          'contractApproval.clientNotes': localContract.clientNotes.trim(),
          'contractApproval.signerName': signerName,
          'contractApproval.signerEmail': signerEmail,
          'contractApproval.signatureText': signatureText,
          'contractApproval.signatureConsent': signatureConsent,
          'contractApproval.sentAt': sentAt,
          'contractApproval.approvedAt': approvedAt,
          'contractApproval.changesRequestedAt': changesRequestedAt,
          'contractApproval.signedAt': signedAt,
          updatedAt: serverTimestamp(),
        })

        transaction.set(historyRef, {
          action,
          status,
          at: serverTimestamp(),
          note,
          actor,
          revision,
        })
      })

      await refreshContract()
      setSuccess(
        action === 'client_signed'
          ? 'Client approval and signature recorded.'
          : action === 'sent_to_client'
            ? 'Contract marked as sent to the client.'
            : action === 'changes_requested'
              ? 'Changes requested status recorded.'
              : 'Contract draft saved.',
      )
      await onChanged?.()
      return true
    } catch (saveError) {
      console.error('[event-contract] Unable to save approval record', saveError)
      if (saveError instanceof Error && saveError.message === CONTRACT_CONFLICT_ERROR) {
        setError('This contract changed in another session. Close and reopen it to review the latest revision before saving.')
      } else {
        setError('The contract approval record could not be saved. Please try again.')
      }
      return false
    } finally {
      setSaving(false)
    }
  }

  async function sendToClient() {
    if (!hasTerms) {
      setError('Add the contract terms before sending it to the client.')
      return
    }
    if (!contract.signerEmail.trim() && !event.clientEmail.trim()) {
      setError('Add the client email before sending the contract.')
      return
    }

    const saved = await persist('draft_saved')
    if (!saved) return

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const sendContract = httpsCallable<
        { storeId: string; eventId: string },
        { ok: boolean; revision: number; reviewUrl: string; pdfUrl: string; deliveries: number }
      >(functions, 'sendEventContractForSignature')
      const response = await sendContract({ storeId, eventId: event.id })
      await refreshContract()
      setSuccess(
        response.data.deliveries > 0
          ? `Revision ${response.data.revision} was emailed to the client with a secure review link and PDF.`
          : `Revision ${response.data.revision} was prepared, but Sedifex could not confirm email delivery. Use the client review link below as a fallback.`,
      )
      await onChanged?.()
    } catch (sendError) {
      console.error('[event-contract] Unable to send secure contract', sendError)
      const message = sendError && typeof sendError === 'object' && 'message' in sendError
        ? String((sendError as { message?: unknown }).message || '')
        : ''
      setError(message.replace(/^FirebaseError:\s*/i, '') || 'The contract could not be sent. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="event-planning__modal-backdrop" onMouseDown={onClose}>
      <section
        className="event-planning__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-contract-title"
        onMouseDown={modalEvent => modalEvent.stopPropagation()}
        style={{ width: 'min(1040px, calc(100vw - 28px))' }}
      >
        <header className="event-planning__modal-heading">
          <div>
            <p className="event-planning__eyebrow">{event.eventCode}</p>
            <h2 id="event-contract-title">Event workspace</h2>
            <p>{event.title} · {event.clientName}</p>
          </div>
          <button type="button" className="event-planning__icon-button" onClick={onClose} aria-label="Close event workspace">×</button>
        </header>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          <button type="button" className={`button ${section === 'contract' ? 'button--primary' : 'button--ghost'}`} onClick={() => setSection('contract')}>Contract & approvals</button>
          <button type="button" className={`button ${section === 'operations' ? 'button--primary' : 'button--ghost'}`} onClick={() => setSection('operations')}>Checklist, timeline & program</button>
        </div>

        {section === 'operations' ? (
          <>
            <EventChecklistShareCard storeId={storeId} event={event} />
            <EventOperationsWorkspace storeId={storeId} eventId={event.id} eventTitle={event.title} onChanged={onChanged} />
          </>
        ) : loading ? (
          <div className="event-planning__loading"><span className="event-planning__spinner" /><p>Loading contract…</p></div>
        ) : (
          <>
            {error ? <p className="event-planning__alert event-planning__alert--error">{error}</p> : null}
            {success ? <p className="event-planning__alert event-planning__alert--success">{success}</p> : null}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 18 }}>
              <span className={`event-planning__status event-planning__status--${statusClass(contract.status)}`}>{STATUS_LABELS[contract.status]}</span>
              <strong style={{ fontSize: '.82rem' }}>Revision {contract.revision}</strong>
              {termsChanged ? <small style={{ color: 'var(--event-muted)' }}>Unsaved term changes</small> : null}
            </div>

            <EventContractTemplateManager
              storeId={storeId}
              eventTitle={event.title}
              clientName={event.clientName}
              contract={{
                serviceAgreement: contract.serviceAgreement,
                scopeOfWork: contract.scopeOfWork,
                paymentTerms: contract.paymentTerms,
                cancellationPolicy: contract.cancellationPolicy,
              }}
              disabled={saving}
              onApply={applyTemplate}
            />

            <div className="event-planning__form-grid">
              <label className="event-planning__field--wide">
                Service agreement
                <textarea rows={5} value={contract.serviceAgreement} onChange={e => update('serviceAgreement', e.target.value)} placeholder="Describe the agreement between the event company and the client, including responsibilities and deliverables." />
              </label>
              <label className="event-planning__field--wide">
                Scope of work
                <textarea rows={5} value={contract.scopeOfWork} onChange={e => update('scopeOfWork', e.target.value)} placeholder="List exactly what the team will provide and what is outside the agreed scope." />
              </label>
              <label>
                Payment terms
                <textarea rows={5} value={contract.paymentTerms} onChange={e => update('paymentTerms', e.target.value)} placeholder="Deposit, instalments, balance due date, late payment handling and accepted payment methods." />
              </label>
              <label>
                Cancellation / refund policy
                <textarea rows={5} value={contract.cancellationPolicy} onChange={e => update('cancellationPolicy', e.target.value)} placeholder="Cancellation notice periods, non-refundable amounts, postponement and refund conditions." />
              </label>
              <label className="event-planning__field--wide">
                Client change request / approval notes
                <textarea rows={3} value={contract.clientNotes} onChange={e => update('clientNotes', e.target.value)} placeholder="Record requested revisions, conditions or approval notes." />
              </label>
            </div>

            {contract.publicReviewUrl ? (
              <div className="event-planning__workspace-preview" style={{ marginTop: 20 }}>
                <h3>Client secure link</h3>
                <p>The client can review the exact contract revision, request changes, download the PDF and sign from this link.</p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                  <a className="button button--ghost" href={contract.publicReviewUrl} target="_blank" rel="noreferrer">Open client review page</a>
                  {contract.publicPdfUrl ? <a className="button button--ghost" href={contract.publicPdfUrl} target="_blank" rel="noreferrer">Download contract PDF</a> : null}
                  <button type="button" className="button button--ghost" onClick={() => void navigator.clipboard?.writeText(contract.publicReviewUrl)}>Copy review link</button>
                </div>
              </div>
            ) : null}

            <div className="event-planning__workspace-preview" style={{ marginTop: 20 }}>
              <h3>Manual e-signature fallback</h3>
              <p>Normally, use “Send contract to client” below so the client signs through their secure link. Use this section only when you need to record an approval collected directly by staff.</p>
              <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
                <label>
                  Signer full name
                  <input value={contract.signerName} onChange={e => update('signerName', e.target.value)} placeholder="Client full name" />
                </label>
                <label>
                  Signer email
                  <input type="email" value={contract.signerEmail} onChange={e => update('signerEmail', e.target.value)} placeholder="client@example.com" />
                </label>
                <label className="event-planning__field--wide">
                  Typed signature
                  <input value={contract.signatureText} onChange={e => update('signatureText', e.target.value)} placeholder="Type the signer’s full name exactly" />
                </label>
                <label className="event-planning__field--wide" style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={contract.signatureConsent} onChange={e => update('signatureConsent', e.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
                  <span>I confirm that the signer reviewed this contract revision and intended the typed name above to serve as their electronic signature.</span>
                </label>
              </div>
              <small style={{ display: 'block', marginTop: 10, color: 'var(--event-muted)' }}>
                Sedifex records the typed signature, consent, revision and timestamps. This is an internal e-sign record, not a third-party digital-signature certificate.
              </small>
            </div>

            <div className="event-planning__details" style={{ marginTop: 18 }}>
              <div><dt>Sent</dt><dd>{formatDateTime(contract.sentAt)}</dd></div>
              <div><dt>Changes requested</dt><dd>{formatDateTime(contract.changesRequestedAt)}</dd></div>
              <div><dt>Approved</dt><dd>{formatDateTime(contract.approvedAt)}</dd></div>
              <div><dt>Signed</dt><dd>{formatDateTime(contract.signedAt)}</dd></div>
            </div>

            {contract.history.length ? (
              <div className="event-planning__workspace-preview" style={{ marginTop: 18 }}>
                <h3>Approval history</h3>
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  {[...contract.history].reverse().map((item, index) => (
                    <div key={`${item.at.getTime()}-${index}`} style={{ borderTop: index ? '1px solid var(--event-line)' : 0, paddingTop: index ? 8 : 0 }}>
                      <strong style={{ fontSize: '.78rem' }}>{STATUS_LABELS[item.status]}</strong>
                      <small style={{ display: 'block', color: 'var(--event-muted)' }}>{formatDateTime(item.at)} · {item.actor}</small>
                      {item.note ? <p style={{ margin: '3px 0 0' }}>{item.note}</p> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <footer className="event-planning__modal-actions" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="button button--ghost" onClick={onClose}>Close</button>
              <button type="button" className="button button--ghost" disabled={saving} onClick={() => void persist('draft_saved')}>Save draft</button>
              <button type="button" className="button button--ghost" disabled={saving} onClick={() => void persist('changes_requested')}>Mark changes requested</button>
              <button type="button" className="button button--primary" disabled={saving} onClick={() => void sendToClient()}>
                {saving ? 'Sending…' : contract.publicReviewUrl ? 'Resend contract to client' : 'Send contract to client'}
              </button>
              <button type="button" className="button button--ghost" disabled={saving} onClick={() => void persist('client_signed')}>Record manual e-signature</button>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
