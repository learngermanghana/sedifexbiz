import React, { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { matchPath, useLocation } from 'react-router-dom'
import { db, functions } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './EventClientCollaborationDock.css'

type ClientTaskState = 'open' | 'submitted' | 'changes_requested' | 'verified'
type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'

type ClientTask = {
  id: string
  title: string
  category: string
  dueDate: string
  status: TaskStatus
  clientVisible: boolean
  clientState: ClientTaskState
  clientSubmissionNote: string
  clientStaffNote: string
  sortOrder: number
}

type EventPortalMeta = {
  title: string
  clientName: string
  clientEmail: string
  publicUrl: string
  status: string
}

type ActivityEntry = {
  id: string
  taskTitle: string
  note: string
  actor: string
  type: string
  at: Date | null
}

const STATE_LABELS: Record<ClientTaskState, string> = {
  open: 'To do',
  submitted: 'Client submitted',
  changes_requested: 'Changes requested',
  verified: 'Verified done',
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function dateValue(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (value && typeof value === 'object' && typeof (value as Timestamp).toDate === 'function') return (value as Timestamp).toDate()
  return null
}

function taskStatus(value: unknown): TaskStatus {
  return ['in_progress', 'blocked', 'done'].includes(String(value)) ? value as TaskStatus : 'todo'
}

function clientState(value: unknown, status: TaskStatus): ClientTaskState {
  const stored = ['submitted', 'changes_requested', 'verified'].includes(String(value))
    ? value as ClientTaskState
    : 'open'
  if (status === 'done') return 'verified'
  if (stored === 'verified') return 'open'
  if (status === 'todo' && stored === 'submitted') return 'open'
  return stored
}

function mapTask(id: string, data: Record<string, unknown>): ClientTask {
  const status = taskStatus(data.status)
  return {
    id,
    title: text(data.title) || 'Untitled task',
    category: text(data.category) || 'General',
    dueDate: text(data.dueDate),
    status,
    clientVisible: data.clientVisible === true,
    clientState: clientState(data.clientState, status),
    clientSubmissionNote: text(data.clientSubmissionNote),
    clientStaffNote: text(data.clientStaffNote),
    sortOrder: numberValue(data.sortOrder),
  }
}

function formatDate(value: Date | null) {
  if (!value) return ''
  return value.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function EventClientCollaborationDock() {
  const location = useLocation()
  const routeMatch = matchPath({ path: '/event-planning/:eventId', end: true }, location.pathname)
  const eventId = routeMatch?.params.eventId || ''
  const { storeId, isLoading } = useActiveStore()
  const [open, setOpen] = useState(false)
  const [event, setEvent] = useState<EventPortalMeta | null>(null)
  const [tasks, setTasks] = useState<ClientTask[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setOpen(false)
    setError(null)
    setMessage(null)
  }, [eventId])

  useEffect(() => {
    if (!storeId || !eventId) {
      setEvent(null)
      setTasks([])
      setActivity([])
      return
    }
    const eventRef = doc(db, 'stores', storeId, 'events', eventId)
    const unsubscribeEvent = onSnapshot(eventRef, snapshot => {
      if (!snapshot.exists()) {
        setEvent(null)
        return
      }
      const data = snapshot.data() as Record<string, unknown>
      const portal = data.clientPortal && typeof data.clientPortal === 'object' ? data.clientPortal as Record<string, unknown> : {}
      setEvent({
        title: text(data.title) || text(data.eventType) || 'Event',
        clientName: text(data.clientName) || 'Client',
        clientEmail: text(data.clientEmail),
        publicUrl: text(portal.publicUrl),
        status: text(portal.status),
      })
    }, listenerError => {
      console.error('[event-client-collaboration] Event listener failed', listenerError)
      setError('The client collaboration status could not be loaded.')
    })
    const unsubscribeTasks = onSnapshot(collection(eventRef, 'tasks'), snapshot => {
      setTasks(snapshot.docs.map(item => mapTask(item.id, item.data())).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)))
    }, listenerError => {
      console.error('[event-client-collaboration] Task listener failed', listenerError)
      setError('Client tasks could not be loaded.')
    })
    const activityQuery = query(collection(eventRef, 'clientActivity'), orderBy('at', 'desc'), limit(30))
    const unsubscribeActivity = onSnapshot(activityQuery, snapshot => {
      setActivity(snapshot.docs.map(item => {
        const data = item.data() as Record<string, unknown>
        return {
          id: item.id,
          taskTitle: text(data.taskTitle),
          note: text(data.note),
          actor: text(data.actor),
          type: text(data.type),
          at: dateValue(data.at),
        }
      }))
    }, listenerError => {
      console.error('[event-client-collaboration] Activity listener failed', listenerError)
    })
    return () => {
      unsubscribeEvent()
      unsubscribeTasks()
      unsubscribeActivity()
    }
  }, [eventId, storeId])

  const visibleTasks = useMemo(() => tasks.filter(task => task.clientVisible), [tasks])
  const submittedCount = visibleTasks.filter(task => task.clientState === 'submitted').length

  if (!routeMatch || !eventId || !storeId || isLoading) return null

  async function toggleClientVisible(task: ClientTask) {
    if (!storeId || !eventId) return
    setError(null)
    setMessage(null)
    try {
      await updateDoc(doc(db, 'stores', storeId, 'events', eventId, 'tasks', task.id), {
        clientVisible: !task.clientVisible,
        clientState: task.clientVisible ? task.clientState : task.clientState === 'verified' ? 'verified' : 'open',
        clientVisibilityUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    } catch (visibilityError) {
      console.error('[event-client-collaboration] Unable to change client visibility', visibilityError)
      setError('The task sharing setting could not be changed.')
    }
  }

  async function sharePortal() {
    if (!storeId || !eventId) return
    if (!visibleTasks.length) {
      setError('Choose at least one task to share with the client first.')
      return
    }
    if (!event?.clientEmail) {
      setError('Add the client email to the event before sharing the checklist.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const share = httpsCallable<
        { storeId: string; eventId: string },
        { ok: boolean; portalUrl: string; expiresAt: string; deliveries: number }
      >(functions, 'shareEventClientPortal')
      const response = await share({ storeId, eventId })
      setMessage(response.data.deliveries > 0
        ? `Client checklist emailed to ${event.clientEmail}.`
        : 'Client portal created. Email delivery could not be confirmed, so copy the link and send it manually.')
    } catch (shareError) {
      console.error('[event-client-collaboration] Unable to share portal', shareError)
      const raw = shareError && typeof shareError === 'object' && 'message' in shareError ? String((shareError as { message?: unknown }).message || '') : ''
      setError(raw.replace(/^FirebaseError:\s*/i, '') || 'The client portal could not be shared.')
    } finally {
      setBusy(false)
    }
  }

  async function copyPortal() {
    if (!event?.publicUrl) return
    try {
      await navigator.clipboard.writeText(event.publicUrl)
      setMessage('Client portal link copied.')
    } catch {
      setError('Could not copy the link. Open it and copy the address from your browser.')
    }
  }

  async function applyStaffDecision(task: ClientTask, action: 'verify' | 'return') {
    if (!storeId || !eventId) return
    const note = action === 'return'
      ? window.prompt('Tell the client what needs to be changed before resubmitting:')
      : ''
    if (action === 'return' && (note === null || !note.trim())) return
    const eventRef = doc(db, 'stores', storeId, 'events', eventId)
    const taskRef = doc(eventRef, 'tasks', task.id)
    const activityRef = doc(collection(eventRef, 'clientActivity'))
    const nextStatus: TaskStatus = action === 'verify' ? 'done' : 'in_progress'
    const nextState: ClientTaskState = action === 'verify' ? 'verified' : 'changes_requested'
    const nextTasks = tasks.map(row => row.id === task.id ? { ...row, status: nextStatus, clientState: nextState } : row)
    const progress = nextTasks.length ? Math.round(nextTasks.filter(row => row.status === 'done').length / nextTasks.length * 100) : 0
    const now = serverTimestamp()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const batch = writeBatch(db)
      batch.update(taskRef, {
        status: nextStatus,
        clientState: nextState,
        clientStaffNote: action === 'return' ? note!.trim() : '',
        clientVerifiedAt: action === 'verify' ? now : null,
        clientChangesRequestedAt: action === 'return' ? now : null,
        updatedAt: now,
      })
      batch.set(activityRef, {
        type: action === 'verify' ? 'staff_verified' : 'staff_returned',
        taskId: task.id,
        taskTitle: task.title,
        note: action === 'return' ? note!.trim() : 'Task verified and marked done.',
        actor: 'Event team',
        at: now,
        public: true,
      })
      batch.update(eventRef, {
        progress,
        readinessSource: 'checklist',
        checklistTaskCount: nextTasks.length,
        checklistCompletedCount: nextTasks.filter(row => row.status === 'done').length,
        updatedAt: now,
      })
      await batch.commit()
      setMessage(action === 'verify' ? 'Client task verified and marked done.' : 'Task returned to the client for changes.')
    } catch (decisionError) {
      console.error('[event-client-collaboration] Unable to update client task', decisionError)
      setError('The client task could not be updated.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={`event-client-dock__trigger${submittedCount ? ' event-client-dock__trigger--attention' : ''}`}
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        aria-controls="event-client-collaboration-panel"
      >
        <span aria-hidden="true">Client</span>
        Client tasks
        {submittedCount ? <strong>{submittedCount}</strong> : null}
      </button>

      {open ? (
        <section id="event-client-collaboration-panel" className="event-client-dock__panel" role="dialog" aria-modal="false" aria-labelledby="event-client-collaboration-title">
          <header className="event-client-dock__heading">
            <div>
              <p>Live collaboration</p>
              <h2 id="event-client-collaboration-title">Client tasks</h2>
              <small>{event?.title || 'Event'} · {event?.clientName || 'Client'}</small>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close client collaboration">×</button>
          </header>

          {error ? <p className="event-client-dock__alert event-client-dock__alert--error">{error}</p> : null}
          {message ? <p className="event-client-dock__alert event-client-dock__alert--success">{message}</p> : null}

          <div className="event-client-dock__share">
            <div>
              <span>Secure client portal</span>
              <strong>{visibleTasks.length} task{visibleTasks.length === 1 ? '' : 's'} shared</strong>
              <p>The client submits completed items. Only your store can verify them as Done.</p>
            </div>
            <div className="event-client-dock__share-actions">
              <button type="button" className="button button--primary" disabled={busy} onClick={() => void sharePortal()}>{busy ? 'Sharing…' : event?.publicUrl ? 'Reshare with client' : 'Share with client'}</button>
              {event?.publicUrl ? <button type="button" className="button button--ghost" onClick={() => void copyPortal()}>Copy link</button> : null}
              {event?.publicUrl ? <a className="button button--ghost" href={event.publicUrl} target="_blank" rel="noreferrer">Open client view</a> : null}
            </div>
          </div>

          <div className="event-client-dock__section-heading">
            <div><span>Checklist</span><strong>Choose what the client can see</strong></div>
            <small>Changes appear here live.</small>
          </div>

          <div className="event-client-dock__tasks">
            {!tasks.length ? <div className="event-client-dock__empty">No checklist tasks yet. Add tasks in the Checklist workspace first.</div> : null}
            {tasks.map(task => (
              <article key={task.id} className={`event-client-dock__task${task.clientState === 'submitted' ? ' is-submitted' : ''}`}>
                <div className="event-client-dock__task-top">
                  <label className="event-client-dock__visibility">
                    <input type="checkbox" checked={task.clientVisible} onChange={() => void toggleClientVisible(task)} />
                    <span>Client visible</span>
                  </label>
                  {task.clientVisible ? <span className={`event-client-dock__state event-client-dock__state--${task.clientState}`}>{STATE_LABELS[task.clientState]}</span> : <span className="event-client-dock__state">Internal</span>}
                </div>
                <strong>{task.title}</strong>
                <p>{task.category}{task.dueDate ? ` · Due ${task.dueDate}` : ''}</p>
                {task.clientSubmissionNote ? <div className="event-client-dock__note"><b>Client:</b> {task.clientSubmissionNote}</div> : null}
                {task.clientStaffNote ? <div className="event-client-dock__note event-client-dock__note--staff"><b>Your reply:</b> {task.clientStaffNote}</div> : null}
                {task.clientState === 'submitted' ? (
                  <div className="event-client-dock__decision-actions">
                    <button type="button" className="button button--primary" disabled={busy} onClick={() => void applyStaffDecision(task, 'verify')}>Verify & mark done</button>
                    <button type="button" className="button button--ghost" disabled={busy} onClick={() => void applyStaffDecision(task, 'return')}>Return to client</button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <div className="event-client-dock__section-heading event-client-dock__section-heading--activity">
            <div><span>Activity trail</span><strong>Client & store updates</strong></div>
          </div>
          <div className="event-client-dock__activity">
            {!activity.length ? <p>No client activity yet.</p> : activity.slice(0, 12).map(item => (
              <div key={item.id}>
                <strong>{item.taskTitle || 'Event update'}</strong>
                <small>{item.actor || 'Update'}{item.at ? ` · ${formatDate(item.at)}` : ''}</small>
                {item.note ? <p>{item.note}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
