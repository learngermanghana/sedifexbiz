import React, { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, runTransaction, Timestamp } from 'firebase/firestore'
import { db } from '../firebase'

type ApprovalStatus = 'draft' | 'sent' | 'approved' | 'changes_requested'
type ApprovalAction = 'draft_saved' | 'sent_to_client' | 'changes_requested' | 'client_signed'

type ApprovalHistoryEntry = {
  action: ApprovalAction
  status: ApprovalStatus
  at: Date
  note: string
  actor: string
}

type ContractApproval = {
  status: ApprovalStatus
  revision: number
  serviceAgreement: string
  scopeOfWork: string
  paymentTerms: string
  cancellationPolicy: string
  clientNotes: string
  signerName: string
  signerEmail: string
  signatureText: string
  signatureConsent: boolean
  sentAt: Date | null
  approvedAt: Date | null
  changesRequestedAt: Date | null
  signedAt: Date | null
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
  if (value && typeof value === 'object' && typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate()
  }
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

function termsFingerprint(contract: ContractApproval) {
  return [
    contract.serviceAgreement.trim(),
    contract.scopeOfWork.trim(),
    contract.paymentTerms.trim(),
    contract.cancellationPolicy.trim(),
  ].join('\n---\n')
}

function hasPersistedTerms(contract: ContractApproval) {
  return Boolean(
    contract.serviceAgreement.trim()
    || contract.scopeOfWork.trim()
    || contract.paymentTerms.trim()
    || contract.cancellationPolicy.trim(),
  )
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
  const [contract, setContract] = useState<ContractApproval>({ ...EMPTY_CONTRACT, signerName: event.clientName, signerEmail: event.clientEmail })
  const [loadedContract, setLoadedContract] = useState<ContractApproval | null>(null)
  const [loadedHadPersistedApproval, setLoadedHadPersistedApproval] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
        const hydrated = {
          ...mapped,
          signerName: mapped.signerName || event.clientName,
          signerEmail: mapped.signerEmail || event.clientEmail,
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

  const hasTerms = Boolean(
    contract.serviceAgreement.trim() || contract.scopeOfWork.trim() || contract.paymentTerms.trim() || contract.cancellationPolicy.trim(),
  )

  function update<K extends keyof ContractApproval>(key: K, value: ContractApproval[K]) {
    setContract(previous => ({ ...previous, [key]: value }))
    setSuccess(null)
  }

  async function persist(action: ApprovalAction) {
    if (!hasTerms) {
      setError('Add the agreement, scope, payment terms or cancellation policy before continuing.')
      return
    }

    if (!loadedContract) {
      setError('Reload this contract before saving so Sedifex can verify the current revision.')
      return
    }

    if (action === 'client_signed') {
      if (!contract.signerName.trim() || !contract.signatureText.trim() || !contract.signatureConsent) {
        setError('Enter the signer name and typed signature, then confirm the consent checkbox.')
        return
      }
    }

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const eventRef = doc(db, 'stores', storeId, 'events', event.id)
      const loadedSnapshot = loadedContract
      const localContract = contract

      const next = await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(eventRef)
        if (!snapshot.exists()) throw new Error('EVENT_NOT_FOUND')

        const rawCurrent = snapshot.data()?.contractApproval
        const currentHadPersistedApproval = isStoredContract(rawCurrent)
        const current = mapContract(rawCurrent)

        const persistedStateChanged = currentHadPersistedApproval !== loadedHadPersistedApproval
          || (currentHadPersistedApproval && contractFingerprint(current) !== contractFingerprint(loadedSnapshot))

        if (persistedStateChanged) {
          throw new Error(CONTRACT_CONFLICT_ERROR)
        }

        const now = new Date()
        const currentTermsChanged = termsFingerprint(localContract) !== termsFingerprint(current)
        const revision = currentTermsChanged && hasPersistedTerms(current)
          ? current.revision + 1
          : current.revision
        let status: ApprovalStatus = current.status
        let sentAt = current.sentAt
        let approvedAt = current.approvedAt
        let changesRequestedAt = current.changesRequestedAt
        let signedAt = current.signedAt
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
          status = 'draft'
          note = currentTermsChanged ? `Contract terms saved as revision ${revision}.` : 'Contract draft saved.'
        }
        if (action === 'sent_to_client') {
          status = 'sent'
          sentAt = now
          approvedAt = null
          signedAt = null
          signatureText = ''
          signatureConsent = false
          note = `Revision ${revision} marked as sent to the client.`
        }
        if (action === 'changes_requested') {
          status = 'changes_requested'
          changesRequestedAt = now
          approvedAt = null
          signedAt = null
          signatureText = ''
          signatureConsent = false
          note = localContract.clientNotes.trim() || 'Client changes requested.'
        }
        if (action === 'client_signed') {
          status = 'approved'
          approvedAt = now
          signedAt = now
          actor = signerName
          note = `Revision ${revision} approved with typed signature.`
        }

        const historyEntry: ApprovalHistoryEntry = {
          action,
          status,
          at: now,
          note,
          actor,
        }

        const nextContract: ContractApproval = {
          ...current,
          status,
          revision,
          serviceAgreement: localContract.serviceAgreement.trim(),
          scopeOfWork: localContract.scopeOfWork.trim(),
          paymentTerms: localContract.paymentTerms.trim(),
          cancellationPolicy: localContract.cancellationPolicy.trim(),
          clientNotes: localContract.clientNotes.trim(),
          signerName,
          signerEmail,
          signatureText,
          signatureConsent,
          sentAt,
          approvedAt,
          changesRequestedAt,
          signedAt,
          history: [...current.history, historyEntry],
        }

        transaction.update(eventRef, {
          contractApproval: nextContract,
          updatedAt: now,
        })

        return nextContract
      })

      setContract(next)
      setLoadedContract(next)
      setLoadedHadPersistedApproval(true)
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
    } catch (saveError) {
      console.error('[event-contract] Unable to save approval record', saveError)
      if (saveError instanceof Error && saveError.message === CONTRACT_CONFLICT_ERROR) {
        setError('This contract changed in another session. Close and reopen it to review the latest revision before saving.')
      } else {
        setError('The contract approval record could not be saved. Please try again.')
      }
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
        style={{ width: 'min(920px, calc(100vw - 28px))' }}
      >
        <header className="event-planning__modal-heading">
          <div>
            <p className="event-planning__eyebrow">{event.eventCode}</p>
            <h2 id="event-contract-title">Contract, approval & e-signature</h2>
            <p>{event.title} · {event.clientName}</p>
          </div>
          <button type="button" className="event-planning__icon-button" onClick={onClose} aria-label="Close contract">×</button>
        </header>

        {loading ? (
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

            <div className="event-planning__workspace-preview" style={{ marginTop: 20 }}>
              <h3>Client e-signature</h3>
              <p>Use this when the client is ready to approve the current contract revision. The typed signature and consent are stored with the approval record.</p>
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
                  <input value={contract.signatureText} onChange={e => update('signatureText', e.target.value)} placeholder="Type the signer’s name as the signature" />
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
              <button type="button" className="button button--ghost" disabled={saving} onClick={() => void persist('sent_to_client')}>Mark sent to client</button>
              <button type="button" className="button button--primary" disabled={saving} onClick={() => void persist('client_signed')}>
                {saving ? 'Saving…' : 'Approve & record e-signature'}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}
