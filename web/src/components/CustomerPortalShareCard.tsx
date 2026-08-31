import React, { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import './CustomerPortalShareCard.css'

type Props = {
  storeId: string
  customerId: string
  customerName: string
  customerEmail?: string | null
}

type PortalState = {
  status?: string
  publicUrl?: string
  expiresAt?: unknown
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toDate(value: unknown): Date | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { toDate?: () => Date }
  if (typeof candidate.toDate !== 'function') return null
  const date = candidate.toDate()
  return Number.isNaN(date.getTime()) ? null : date
}

function errorMessage(error: unknown) {
  if (!error || typeof error !== 'object' || !('message' in error)) return 'Customer portal action failed.'
  return String((error as { message?: unknown }).message || '').replace(/^FirebaseError:\s*/i, '') || 'Customer portal action failed.'
}

export default function CustomerPortalShareCard({ storeId, customerId, customerName, customerEmail }: Props) {
  const [portalUrl, setPortalUrl] = useState('')
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const snapshot = await getDoc(doc(db, 'customers', customerId))
        if (!active) return
        const data = snapshot.data() as Record<string, unknown> | undefined
        const portal = data?.portal && typeof data.portal === 'object' && !Array.isArray(data.portal)
          ? data.portal as PortalState
          : {}
        setPortalUrl(portal.status === 'active' ? text(portal.publicUrl) : '')
        setExpiresAt(portal.status === 'active' ? toDate(portal.expiresAt) : null)
      } catch (loadError) {
        if (active) setError(errorMessage(loadError))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [customerId])

  async function createPortal(sendEmail: boolean) {
    setWorking(true)
    setMessage('')
    setError('')
    try {
      const share = httpsCallable<
        { storeId: string; customerId: string; sendEmail: boolean },
        { ok: boolean; portalUrl: string; expiresAt: string; deliveries: number; deliveryStatus: string }
      >(functions, 'shareCustomerPortal')
      const response = await share({ storeId, customerId, sendEmail })
      setPortalUrl(response.data.portalUrl)
      const parsedExpiry = new Date(response.data.expiresAt)
      setExpiresAt(Number.isNaN(parsedExpiry.getTime()) ? null : parsedExpiry)
      if (sendEmail && customerEmail) {
        setMessage(response.data.deliveries > 0
          ? `Portal created and emailed to ${customerEmail}.`
          : 'Portal created, but email delivery was not confirmed. Copy the link and send it manually.')
      } else {
        setMessage('Customer portal link created. Copy it and share it with the customer.')
      }
    } catch (shareError) {
      setError(errorMessage(shareError))
    } finally {
      setWorking(false)
    }
  }

  async function revokePortal() {
    if (!portalUrl) return
    setWorking(true)
    setMessage('')
    setError('')
    try {
      const revoke = httpsCallable<{ storeId: string; customerId: string }, { ok: boolean }>(functions, 'revokeCustomerPortal')
      await revoke({ storeId, customerId })
      setPortalUrl('')
      setExpiresAt(null)
      setMessage('Customer portal disabled. The previous link no longer works.')
    } catch (revokeError) {
      setError(errorMessage(revokeError))
    } finally {
      setWorking(false)
    }
  }

  async function copyPortalLink() {
    if (!portalUrl) return
    setMessage('')
    setError('')
    try {
      await navigator.clipboard.writeText(portalUrl)
      setMessage('Customer portal link copied.')
    } catch {
      setError('Could not copy automatically. Open the portal and copy the address from your browser.')
    }
  }

  return (
    <section className="customer-portal-share" aria-label="Customer portal">
      <div className="customer-portal-share__copy">
        <span>Customer portal</span>
        <h3>Give {customerName} a private self-service page</h3>
        <p>They can review bookings, invoices, payments, receipts and their current balance without contacting you for every update.</p>
        {portalUrl && expiresAt ? <small>Current link expires {expiresAt.toLocaleDateString()}.</small> : null}
      </div>

      <div className="customer-portal-share__actions">
        {!portalUrl ? (
          <>
            {customerEmail ? <button type="button" disabled={working || loading} onClick={() => void createPortal(true)}>{working ? 'Creating…' : 'Create & email portal'}</button> : null}
            <button type="button" className="is-secondary" disabled={working || loading} onClick={() => void createPortal(false)}>{working ? 'Creating…' : 'Create portal link'}</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => void copyPortalLink()} disabled={working}>Copy link</button>
            <a href={portalUrl} target="_blank" rel="noreferrer">Open customer view</a>
            <button type="button" className="is-secondary" onClick={() => void createPortal(Boolean(customerEmail))} disabled={working}>{working ? 'Refreshing…' : 'Regenerate link'}</button>
            <button type="button" className="is-danger" onClick={() => void revokePortal()} disabled={working}>Disable portal</button>
          </>
        )}
      </div>

      {loading ? <p className="customer-portal-share__status">Checking portal status…</p> : null}
      {message ? <p className="customer-portal-share__status is-success">{message}</p> : null}
      {error ? <p className="customer-portal-share__status is-error" role="alert">{error}</p> : null}
    </section>
  )
}
