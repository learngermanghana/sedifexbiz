import React, { useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'

type EventChecklistShareTarget = {
  id: string
  clientEmail: string
}

type ChecklistShareTask = {
  id: string
  title: string
  status: string
  clientState: string
  clientVisible: boolean
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export default function EventChecklistShareCard({ storeId, event }: { storeId: string; event: EventChecklistShareTarget }) {
  const [portalUrl, setPortalUrl] = useState('')
  const [tasks, setTasks] = useState<ChecklistShareTask[]>([])
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function loadShareState() {
      setLoading(true)
      setError(null)
      try {
        const eventRef = doc(db, 'stores', storeId, 'events', event.id)
        const [eventSnapshot, tasksSnapshot] = await Promise.all([
          getDoc(eventRef),
          getDocs(collection(eventRef, 'tasks')),
        ])
        if (!active) return
        const data = eventSnapshot.data() as Record<string, unknown> | undefined
        const rawPortal = data?.clientPortal && typeof data.clientPortal === 'object'
          ? data.clientPortal as Record<string, unknown>
          : {}
        setPortalUrl(text(rawPortal.publicUrl))
        setTasks(tasksSnapshot.docs.map(item => {
          const task = item.data() as Record<string, unknown>
          return {
            id: item.id,
            title: text(task.title) || 'Untitled checklist task',
            status: text(task.status) || 'todo',
            clientState: text(task.clientState) || 'open',
            clientVisible: task.clientVisible === true,
          }
        }))
      } catch (loadError) {
        console.error('[event-checklist-share] Unable to load client portal', loadError)
        if (active) setError('The client checklist sharing settings could not be loaded.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadShareState()
    return () => { active = false }
  }, [event.id, storeId])

  const sharedTaskCount = tasks.filter(task => task.clientVisible).length

  async function toggleClientVisible(task: ChecklistShareTask) {
    const nextVisible = !task.clientVisible
    const nextClientState = nextVisible
      ? task.status === 'done'
        ? 'verified'
        : task.clientState === 'verified'
          ? 'open'
          : task.clientState || 'open'
      : task.clientState

    setUpdatingTaskId(task.id)
    setError(null)
    setMessage(null)
    try {
      await updateDoc(doc(db, 'stores', storeId, 'events', event.id, 'tasks', task.id), {
        clientVisible: nextVisible,
        clientState: nextClientState,
        clientVisibilityUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setTasks(previous => previous.map(row => row.id === task.id
        ? { ...row, clientVisible: nextVisible, clientState: nextClientState }
        : row))
    } catch (visibilityError) {
      console.error('[event-checklist-share] Unable to change client visibility', visibilityError)
      setError('The task sharing setting could not be changed.')
    } finally {
      setUpdatingTaskId(null)
    }
  }

  async function shareChecklist() {
    if (!event.clientEmail.trim()) {
      setError('Add the client email to the event before sharing the checklist.')
      return
    }
    if (!tasks.length) {
      setError('Add at least one checklist task before sharing with the client.')
      return
    }
    if (!sharedTaskCount) {
      setError('Select at least one “Client visible” task before sharing. Internal tasks will remain private.')
      return
    }

    setSharing(true)
    setError(null)
    setMessage(null)
    try {
      const share = httpsCallable<
        { storeId: string; eventId: string },
        { ok: boolean; portalUrl: string; expiresAt: string; deliveries: number }
      >(functions, 'shareEventClientPortal')
      const response = await share({ storeId, eventId: event.id })
      setPortalUrl(response.data.portalUrl)
      setMessage(
        response.data.deliveries > 0
          ? `Checklist link emailed to ${event.clientEmail}. ${sharedTaskCount} selected task${sharedTaskCount === 1 ? '' : 's'} shared.`
          : `Checklist link created for ${sharedTaskCount} selected task${sharedTaskCount === 1 ? '' : 's'}. Email delivery could not be confirmed, so copy the link below and send it manually.`,
      )
    } catch (shareError) {
      console.error('[event-checklist-share] Unable to share checklist', shareError)
      const raw = shareError && typeof shareError === 'object' && 'message' in shareError
        ? String((shareError as { message?: unknown }).message || '')
        : ''
      setError(raw.replace(/^FirebaseError:\s*/i, '') || 'The client checklist could not be shared.')
    } finally {
      setSharing(false)
    }
  }

  async function copyLink() {
    if (!portalUrl) return
    setError(null)
    try {
      await navigator.clipboard.writeText(portalUrl)
      setMessage('Client checklist link copied.')
    } catch {
      setError('Could not copy the link. Open the client view and copy the address from your browser.')
    }
  }

  return (
    <div className="event-planning__workspace-preview" style={{ marginTop: 0, marginBottom: 16, borderColor: '#cfe7d7', background: '#f5fbf7' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 0 }}>
        <div style={{ flex: '1 1 420px' }}>
          <p className="event-planning__eyebrow" style={{ marginBottom: 5 }}>Client checklist</p>
          <h3>Share a live to-do list with the client</h3>
          <p>Select exactly which checklist items the client may see. Tasks left unchecked stay internal, including finance, staffing or other sensitive items.</p>
          <p style={{ marginTop: 5 }}>{loading ? 'Loading client sharing status…' : `${sharedTaskCount} of ${tasks.length} checklist task${tasks.length === 1 ? '' : 's'} selected for the client.`}</p>
        </div>
        <button type="button" className="button button--primary" disabled={sharing || loading || !sharedTaskCount} onClick={() => void shareChecklist()}>
          {sharing ? 'Creating link…' : portalUrl ? 'Reshare selected tasks' : 'Share selected tasks'}
        </button>
      </div>

      {!loading && tasks.length ? (
        <div style={{ display: 'grid', gap: 7, marginTop: 14 }}>
          <strong style={{ fontSize: '.78rem' }}>Choose client-visible tasks</strong>
          {tasks.map(task => (
            <label key={task.id} style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '8px 10px', border: '1px solid #dce8df', borderRadius: 9, background: '#fff', fontSize: '.76rem', fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={task.clientVisible}
                disabled={Boolean(updatingTaskId) || sharing}
                onChange={() => void toggleClientVisible(task)}
                style={{ width: 17, height: 17 }}
              />
              <span>{task.title}</span>
              <small style={{ marginLeft: 'auto', color: task.clientVisible ? '#37634c' : '#7b8781' }}>{task.clientVisible ? 'Client visible' : 'Internal'}</small>
            </label>
          ))}
        </div>
      ) : null}

      {error ? <p className="event-planning__alert event-planning__alert--error" style={{ marginTop: 12, marginBottom: 0 }}>{error}</p> : null}
      {message ? <p className="event-planning__alert event-planning__alert--success" style={{ marginTop: 12, marginBottom: 0 }}>{message}</p> : null}

      {portalUrl ? (
        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          <label style={{ color: '#4d5c56', fontSize: '.75rem', fontWeight: 800 }}>
            Client checklist link
            <input readOnly value={portalUrl} onFocus={inputEvent => inputEvent.currentTarget.select()} style={{ width: '100%', minHeight: 42, marginTop: 6, border: '1px solid #d8dedb', borderRadius: 9, background: '#fff' }} />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 0 }}>
            <button type="button" className="button button--ghost" onClick={() => void copyLink()}>Copy client link</button>
            <a className="button button--ghost" href={portalUrl} target="_blank" rel="noreferrer">Open client view</a>
          </div>
        </div>
      ) : (
        <p style={{ marginTop: 10 }}>Select the tasks the client should see, then share. Unchecked tasks are never added to the client portal automatically.</p>
      )}
    </div>
  )
}
