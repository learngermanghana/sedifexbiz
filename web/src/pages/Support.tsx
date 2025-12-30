import React, { useEffect, useMemo, useState } from 'react'
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import PageSection from '../layout/PageSection'
import { db } from '../firebase'
import './Support.css'

type SupportTicket = {
  id: string
  uid: string | null
  storeId: string | null
  screen: string | null
  message: string
  createdAt: Timestamp | null
  status: string
}

function mapTicket(snapshot: QueryDocumentSnapshot<DocumentData>): SupportTicket {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    uid: typeof data.uid === 'string' ? data.uid : null,
    storeId: typeof data.storeId === 'string' ? data.storeId : null,
    screen: typeof data.screen === 'string' ? data.screen : null,
    message: typeof data.message === 'string' ? data.message : '',
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
    status: typeof data.status === 'string' ? data.status : 'open',
  }
}

function formatTimestamp(timestamp: Timestamp | null): string {
  if (!timestamp) return '—'
  const date = timestamp.toDate()
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function Support() {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [closingId, setClosingId] = useState<string | null>(null)

  useEffect(() => {
    const ticketsQuery = query(
      collection(db, 'supportTickets'),
      where('status', '==', 'open'),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(
      ticketsQuery,
      snapshot => {
        setTickets(snapshot.docs.map(mapTicket))
        setError(null)
        setLoading(false)
      },
      snapshotError => {
        console.error('[support] Unable to load tickets', snapshotError)
        setError('Unable to load support tickets right now.')
        setLoading(false)
      },
    )

    return unsubscribe
  }, [])

  const totalOpen = useMemo(() => tickets.length, [tickets.length])

  async function closeTicket(ticketId: string) {
    setClosingId(ticketId)
    try {
      await updateDoc(doc(db, 'supportTickets', ticketId), { status: 'closed' })
    } catch (e) {
      console.error('[support] Unable to close ticket', e)
      setError('Unable to update the ticket right now.')
    } finally {
      setClosingId(null)
    }
  }

  return (
    <PageSection
      title="Support tickets"
      subtitle="Internal view of in-app help requests."
      actions={<span className="support__badge">{totalOpen} open</span>}
    >
      <div className="support__body">
        {loading ? <p className="support__muted">Loading tickets…</p> : null}
        {error ? <p className="support__error">{error}</p> : null}

        {!loading && tickets.length === 0 && !error ? (
          <p className="support__muted">No open tickets at the moment.</p>
        ) : null}

        {tickets.length > 0 ? (
          <div className="support__table-wrapper">
            <table className="support__table">
              <thead>
                <tr>
                  <th>Message</th>
                  <th>From</th>
                  <th>Screen</th>
                  <th>Created</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {tickets.map(ticket => (
                  <tr key={ticket.id}>
                    <td className="support__message-cell">{ticket.message}</td>
                    <td>
                      <div className="support__meta">
                        <span className="support__label">UID</span>
                        <span>{ticket.uid ?? '—'}</span>
                      </div>
                      <div className="support__meta">
                        <span className="support__label">Store</span>
                        <span>{ticket.storeId ?? '—'}</span>
                      </div>
                    </td>
                    <td>{ticket.screen ?? '—'}</td>
                    <td>{formatTimestamp(ticket.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => closeTicket(ticket.id)}
                        disabled={closingId === ticket.id}
                      >
                        {closingId === ticket.id ? 'Closing…' : 'Mark resolved'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </PageSection>
  )
}
