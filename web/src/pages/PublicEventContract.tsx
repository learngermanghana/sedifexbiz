import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  downloadPublicEventContractPdf,
  getPublicEventContract,
  requestPublicEventContractChanges,
  signPublicEventContract,
  type PublicEventContract,
} from '../api/eventContract'
import './PublicEventContract.css'

function messageFromError(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message.replace(/^FirebaseError:\s*/i, '')
  }
  return 'Something went wrong. Please try again.'
}

function displayDate(value?: string) {
  if (!value) return 'To be confirmed'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function displayDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function ContractSection({ title, children }: { title: string; children?: string }) {
  return (
    <section className="public-event-contract__section">
      <h2>{title}</h2>
      <p>{children?.trim() || 'Not specified.'}</p>
    </section>
  )
}

export default function PublicEventContractPage() {
  const { token = '' } = useParams()
  const [searchParams] = useSearchParams()
  const [contract, setContract] = useState<PublicEventContract | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [signerName, setSignerName] = useState('')
  const [signatureText, setSignatureText] = useState('')
  const [consent, setConsent] = useState(false)
  const [changeNote, setChangeNote] = useState('')
  const [showChanges, setShowChanges] = useState(false)
  const [autoDownloaded, setAutoDownloaded] = useState(false)

  const brandColor = contract?.brand.brandColor || '#4f46e5'
  const statusLabel = useMemo(() => {
    if (contract?.status === 'signed') return 'Signed'
    if (contract?.status === 'changes_requested') return 'Changes requested'
    if (contract?.status === 'revoked') return 'Replaced'
    return 'Awaiting signature'
  }, [contract?.status])

  async function load() {
    if (!token) {
      setError('This contract link is invalid.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await getPublicEventContract(token)
      setContract(result)
      setSignerName(previous => previous || result.event.clientName || '')
    } catch (loadError) {
      setError(messageFromError(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [token])

  useEffect(() => {
    if (!contract || autoDownloaded || searchParams.get('download') !== '1') return
    setAutoDownloaded(true)
    void downloadPublicEventContractPdf(token).catch(downloadError => setError(messageFromError(downloadError)))
  }, [autoDownloaded, contract, searchParams, token])

  async function downloadPdf() {
    setWorking(true)
    setError(null)
    try {
      await downloadPublicEventContractPdf(token)
    } catch (downloadError) {
      setError(messageFromError(downloadError))
    } finally {
      setWorking(false)
    }
  }

  async function sign() {
    setWorking(true)
    setError(null)
    setSuccess(null)
    try {
      await signPublicEventContract({ token, signerName, signatureText, consent })
      setSuccess('Contract signed successfully. A signed copy has been emailed to you and the event team.')
      await load()
    } catch (signError) {
      setError(messageFromError(signError))
    } finally {
      setWorking(false)
    }
  }

  async function requestChanges() {
    setWorking(true)
    setError(null)
    setSuccess(null)
    try {
      await requestPublicEventContractChanges({ token, note: changeNote })
      setSuccess('Your requested changes were sent to the event team.')
      setShowChanges(false)
      await load()
    } catch (requestError) {
      setError(messageFromError(requestError))
    } finally {
      setWorking(false)
    }
  }

  if (loading) {
    return <main className="public-event-contract"><div className="public-event-contract__card"><p>Loading contract…</p></div></main>
  }

  if (!contract) {
    return (
      <main className="public-event-contract">
        <div className="public-event-contract__card public-event-contract__card--narrow">
          <h1>Contract unavailable</h1>
          <p>{error || 'This contract link is invalid, expired or has been replaced.'}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="public-event-contract" style={{ '--contract-brand': brandColor } as React.CSSProperties}>
      <div className="public-event-contract__shell">
        <header className="public-event-contract__brand">
          <div>
            {contract.brand.logoUrl ? <img src={contract.brand.logoUrl} alt={contract.brand.storeName || 'Event company'} /> : null}
            <p className="public-event-contract__eyebrow">Secure event agreement</p>
            <h1>{contract.brand.storeName || 'Event agreement'}</h1>
          </div>
          <span className={`public-event-contract__status public-event-contract__status--${contract.status}`}>{statusLabel}</span>
        </header>

        {error ? <div className="public-event-contract__alert public-event-contract__alert--error">{error}</div> : null}
        {success ? <div className="public-event-contract__alert public-event-contract__alert--success">{success}</div> : null}

        <section className="public-event-contract__card public-event-contract__summary">
          <div>
            <p className="public-event-contract__eyebrow">Event</p>
            <h2>{contract.event.title || 'Event'}</h2>
            <p>{contract.event.eventCode || `Revision ${contract.revision}`}</p>
          </div>
          <dl>
            <div><dt>Client</dt><dd>{contract.event.clientName || 'Client'}</dd></div>
            <div><dt>Date</dt><dd>{displayDate(contract.event.eventDate)}</dd></div>
            <div><dt>Time</dt><dd>{contract.event.startTime || 'To be confirmed'}</dd></div>
            <div><dt>Venue</dt><dd>{contract.event.venue || 'To be confirmed'}</dd></div>
            <div><dt>Revision</dt><dd>{contract.revision}</dd></div>
            <div><dt>Link expires</dt><dd>{displayDateTime(contract.expiresAt)}</dd></div>
          </dl>
          <button type="button" className="public-event-contract__secondary" onClick={() => void downloadPdf()} disabled={working}>
            Download {contract.status === 'signed' ? 'signed ' : ''}PDF
          </button>
        </section>

        <div className="public-event-contract__terms">
          <ContractSection title="Service agreement">{contract.contract.serviceAgreement}</ContractSection>
          <ContractSection title="Scope of work">{contract.contract.scopeOfWork}</ContractSection>
          <ContractSection title="Payment terms">{contract.contract.paymentTerms}</ContractSection>
          <ContractSection title="Cancellation / refund policy">{contract.contract.cancellationPolicy}</ContractSection>
        </div>

        {contract.status === 'signed' ? (
          <section className="public-event-contract__card public-event-contract__signed">
            <p className="public-event-contract__eyebrow">Electronic signature recorded</p>
            <h2>{contract.signer?.name || contract.event.clientName}</h2>
            <p>Typed signature: <strong>{contract.signer?.signatureText}</strong></p>
            <p>Signed: {displayDateTime(contract.signer?.signedAt)}</p>
            <button type="button" className="public-event-contract__primary" onClick={() => void downloadPdf()} disabled={working}>Download signed contract PDF</button>
          </section>
        ) : contract.status === 'changes_requested' ? (
          <section className="public-event-contract__card">
            <h2>Changes requested</h2>
            <p>The event team has been notified. They will revise the contract and send you a new secure link.</p>
          </section>
        ) : (
          <section className="public-event-contract__card public-event-contract__signing">
            <p className="public-event-contract__eyebrow">Approve revision {contract.revision}</p>
            <h2>Electronic signature</h2>
            <p>Read the agreement above before signing. Your typed signature must match your full name.</p>
            <div className="public-event-contract__fields">
              <label>
                Full name
                <input value={signerName} onChange={event => setSignerName(event.target.value)} autoComplete="name" />
              </label>
              <label>
                Email
                <input value={contract.event.clientEmail || ''} readOnly aria-readonly="true" />
              </label>
              <label className="public-event-contract__wide">
                Typed signature
                <input value={signatureText} onChange={event => setSignatureText(event.target.value)} placeholder="Type your full name exactly" />
              </label>
              <label className="public-event-contract__consent public-event-contract__wide">
                <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
                <span>I have reviewed this contract revision and intend the typed name above to serve as my electronic signature.</span>
              </label>
            </div>
            <div className="public-event-contract__actions">
              <button type="button" className="public-event-contract__secondary" onClick={() => setShowChanges(value => !value)} disabled={working}>Request changes</button>
              <button type="button" className="public-event-contract__primary" onClick={() => void sign()} disabled={working || !consent}>{working ? 'Please wait…' : 'Approve & sign contract'}</button>
            </div>

            {showChanges ? (
              <div className="public-event-contract__changes">
                <label>
                  What should be changed?
                  <textarea rows={4} value={changeNote} onChange={event => setChangeNote(event.target.value)} placeholder="Describe the exact change you want the event team to make." />
                </label>
                <button type="button" className="public-event-contract__secondary" onClick={() => void requestChanges()} disabled={working || changeNote.trim().length < 3}>Send change request</button>
              </div>
            ) : null}
          </section>
        )}

        <footer className="public-event-contract__footer">
          <p>This Sedifex record stores the contract revision, typed signature, consent and signing timestamp. It is not a third-party digital-signature certificate.</p>
          {contract.brand.email || contract.brand.phone ? <p>Questions? Contact {contract.brand.email || contract.brand.phone}.</p> : null}
        </footer>
      </div>
    </main>
  )
}
