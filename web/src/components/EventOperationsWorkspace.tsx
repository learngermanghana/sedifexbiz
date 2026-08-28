import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import EventPostEventEvaluation from './EventPostEventEvaluation'
import EventTypeExtras from './EventTypeExtras'

type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'
type TaskPriority = 'low' | 'normal' | 'high' | 'critical'
type OperationsTab = 'checklist' | 'timeline' | 'program' | 'extras' | 'evaluation'
type ProgramApprovalStatus = 'draft' | 'approved'

type EventMeta = {
  eventType: string
  eventDate: string
  startTime: string
  venue: string
  checklistSeeded: boolean
  programApproval: {
    status: ProgramApprovalStatus
    approvedBy: string
    approvedAt: Date | null
    revision: number
  }
}

type ChecklistTask = {
  id: string
  title: string
  category: string
  owner: string
  dueDate: string
  priority: TaskPriority
  status: TaskStatus
  notes: string
  sortOrder: number
}

type TimelineItem = {
  id: string
  startTime: string
  endTime: string
  title: string
  owner: string
  vendor: string
  location: string
  notes: string
  sortOrder: number
}

type ProgramItem = {
  id: string
  time: string
  title: string
  participant: string
  notes: string
  sortOrder: number
}

type Props = {
  storeId: string
  eventId: string
  eventTitle: string
  onChanged?: () => void | Promise<void>
}

type ChecklistTemplateItem = {
  title: string
  category: string
  daysBefore: number
  priority?: TaskPriority
}

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
}

const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
}

const BASE_CHECKLIST: ChecklistTemplateItem[] = [
  { title: 'Confirm client brief and event scope', category: 'Client', daysBefore: 60, priority: 'high' },
  { title: 'Confirm event budget and payment schedule', category: 'Finance', daysBefore: 55, priority: 'high' },
  { title: 'Confirm venue booking and access times', category: 'Venue', daysBefore: 50, priority: 'high' },
  { title: 'Confirm key vendors and deliverables', category: 'Vendors', daysBefore: 45, priority: 'high' },
  { title: 'Confirm décor, production and equipment plan', category: 'Production', daysBefore: 30 },
  { title: 'Confirm catering numbers and special requirements', category: 'Catering', daysBefore: 21 },
  { title: 'Prepare event-day staffing plan', category: 'Staff', daysBefore: 14 },
  { title: 'Prepare first day-of timeline and program', category: 'Program', daysBefore: 10, priority: 'high' },
  { title: 'Send final timeline to vendors and staff', category: 'Coordination', daysBefore: 5, priority: 'high' },
  { title: 'Final client confirmation and outstanding approvals', category: 'Client', daysBefore: 3, priority: 'critical' },
  { title: 'Confirm balances, petty cash and emergency contacts', category: 'Finance', daysBefore: 2, priority: 'high' },
  { title: 'Complete final event-day readiness check', category: 'Coordination', daysBefore: 1, priority: 'critical' },
]

const EVENT_TYPE_CHECKLISTS: Record<string, ChecklistTemplateItem[]> = {
  'Traditional wedding': [
    { title: 'Confirm family representatives and traditional protocol', category: 'Program', daysBefore: 21, priority: 'high' },
    { title: 'Confirm presentation items, gifts and responsible persons', category: 'Program', daysBefore: 14 },
  ],
  'White wedding': [
    { title: 'Confirm ceremony, reception and bridal-party movement', category: 'Program', daysBefore: 21, priority: 'high' },
    { title: 'Confirm seating plan and table assignments', category: 'Guests', daysBefore: 10 },
  ],
  Funeral: [
    { title: 'Confirm family program, tributes and order of service', category: 'Program', daysBefore: 10, priority: 'high' },
    { title: 'Confirm donation desk, records and responsible team', category: 'Finance', daysBefore: 5 },
  ],
  'Charity / community': [
    { title: 'Confirm donation collection, receipts and responsible team', category: 'Finance', daysBefore: 7, priority: 'high' },
    { title: 'Confirm beneficiaries, partners and public accountability plan', category: 'Program', daysBefore: 5 },
  ],
  'Corporate event': [
    { title: 'Confirm speakers, presentations and technical requirements', category: 'Program', daysBefore: 14, priority: 'high' },
    { title: 'Confirm sponsors, branding and registration flow', category: 'Production', daysBefore: 10 },
  ],
  Birthday: [
    { title: 'Confirm celebrant entrance, cake and key program moments', category: 'Program', daysBefore: 7 },
  ],
  Engagement: [
    { title: 'Confirm family roles, presentation flow and key announcements', category: 'Program', daysBefore: 10 },
    { title: 'Confirm family seating and key guest assignments', category: 'Guests', daysBefore: 5 },
  ],
  Graduation: [
    { title: 'Confirm graduate entrance, speeches and photo moments', category: 'Program', daysBefore: 7 },
  ],
  'Naming ceremony': [
    { title: 'Confirm family protocol, naming moment and speakers', category: 'Program', daysBefore: 7 },
  ],
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function dateValue(value: unknown): Date | null {
  if (!value || typeof value !== 'object') return null
  const maybeTimestamp = value as { toDate?: () => Date }
  return typeof maybeTimestamp.toDate === 'function' ? maybeTimestamp.toDate() : null
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return ['todo', 'in_progress', 'blocked', 'done'].includes(String(value))
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return ['low', 'normal', 'high', 'critical'].includes(String(value))
}

function mapEventMeta(data: Record<string, unknown>): EventMeta {
  const rawApproval = data.programApproval && typeof data.programApproval === 'object'
    ? data.programApproval as Record<string, unknown>
    : {}
  return {
    eventType: text(data.eventType) || 'Other',
    eventDate: text(data.eventDate),
    startTime: text(data.startTime),
    venue: text(data.venue),
    checklistSeeded: data.checklistSeeded === true,
    programApproval: {
      status: rawApproval.status === 'approved' ? 'approved' : 'draft',
      approvedBy: text(rawApproval.approvedBy),
      approvedAt: dateValue(rawApproval.approvedAt),
      revision: Math.max(1, Math.floor(numberValue(rawApproval.revision, 1))),
    },
  }
}

function mapTask(id: string, data: Record<string, unknown>): ChecklistTask {
  return {
    id,
    title: text(data.title) || 'Untitled task',
    category: text(data.category) || 'General',
    owner: text(data.owner),
    dueDate: text(data.dueDate),
    priority: isTaskPriority(data.priority) ? data.priority : 'normal',
    status: isTaskStatus(data.status) ? data.status : 'todo',
    notes: text(data.notes),
    sortOrder: numberValue(data.sortOrder),
  }
}

function mapTimelineItem(id: string, data: Record<string, unknown>): TimelineItem {
  return {
    id,
    startTime: text(data.startTime),
    endTime: text(data.endTime),
    title: text(data.title) || 'Untitled timeline item',
    owner: text(data.owner),
    vendor: text(data.vendor),
    location: text(data.location),
    notes: text(data.notes),
    sortOrder: numberValue(data.sortOrder),
  }
}

function mapProgramItem(id: string, data: Record<string, unknown>): ProgramItem {
  return {
    id,
    time: text(data.time),
    title: text(data.title) || 'Untitled program item',
    participant: text(data.participant),
    notes: text(data.notes),
    sortOrder: numberValue(data.sortOrder),
  }
}

function dueDate(eventDate: string, daysBefore: number) {
  if (!eventDate) return ''
  const date = new Date(`${eventDate}T12:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setDate(date.getDate() - daysBefore)
  return date.toISOString().slice(0, 10)
}

function formatDate(value: string) {
  if (!value) return 'No due date'
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateTime(value: Date | null) {
  if (!value) return '—'
  return value.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export default function EventOperationsWorkspace({ storeId, eventId, eventTitle, onChanged }: Props) {
  const [tab, setTab] = useState<OperationsTab>('checklist')
  const [meta, setMeta] = useState<EventMeta | null>(null)
  const [tasks, setTasks] = useState<ChecklistTask[]>([])
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [program, setProgram] = useState<ProgramItem[]>([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTimelineId, setEditingTimelineId] = useState<string | null>(null)
  const [editingProgramId, setEditingProgramId] = useState<string | null>(null)
  const [approvalName, setApprovalName] = useState('')
  const seedStartedRef = useRef(false)

  const [taskForm, setTaskForm] = useState({ title: '', category: 'General', owner: '', dueDate: '', priority: 'normal' as TaskPriority, status: 'todo' as TaskStatus, notes: '' })
  const [timelineForm, setTimelineForm] = useState({ startTime: '', endTime: '', title: '', owner: '', vendor: '', location: '', notes: '' })
  const [programForm, setProgramForm] = useState({ time: '', title: '', participant: '', notes: '' })

  const eventRef = useMemo(() => doc(db, 'stores', storeId, 'events', eventId), [storeId, eventId])
  const tasksRef = useMemo(() => collection(eventRef, 'tasks'), [eventRef])
  const timelineRef = useMemo(() => collection(eventRef, 'timeline'), [eventRef])
  const programRef = useMemo(() => collection(eventRef, 'program'), [eventRef])

  const readiness = useMemo(() => tasks.length ? Math.round(tasks.filter(task => task.status === 'done').length / tasks.length * 100) : 0, [tasks])
  const completedTasks = tasks.filter(task => task.status === 'done').length

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [eventSnapshot, tasksSnapshot, timelineSnapshot, programSnapshot] = await Promise.all([
        getDoc(eventRef),
        getDocs(tasksRef),
        getDocs(timelineRef),
        getDocs(programRef),
      ])
      if (!eventSnapshot.exists()) throw new Error('EVENT_NOT_FOUND')
      const mappedMeta = mapEventMeta(eventSnapshot.data())
      setMeta(mappedMeta)
      setApprovalName(mappedMeta.programApproval.approvedBy)
      setTasks(tasksSnapshot.docs.map(item => mapTask(item.id, item.data())).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)))
      setTimeline(timelineSnapshot.docs.map(item => mapTimelineItem(item.id, item.data())).sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime)))
      setProgram(programSnapshot.docs.map(item => mapProgramItem(item.id, item.data())).sort((a, b) => a.sortOrder - b.sortOrder || a.time.localeCompare(b.time)))
    } catch (loadError) {
      console.error('[event-operations] Unable to load workspace', loadError)
      setError('Checklist, timeline and program could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [eventRef, programRef, tasksRef, timelineRef])

  useEffect(() => { void loadWorkspace() }, [loadWorkspace])

  useEffect(() => {
    if (loading || !meta || tasks.length || meta.checklistSeeded || seedStartedRef.current) return
    seedStartedRef.current = true
    async function seedChecklist() {
      setSeeding(true)
      try {
        const templates = [...BASE_CHECKLIST, ...(EVENT_TYPE_CHECKLISTS[meta!.eventType] || [])]
        const batch = writeBatch(db)
        templates.forEach((template, index) => {
          batch.set(doc(tasksRef), {
            title: template.title,
            category: template.category,
            owner: '',
            dueDate: dueDate(meta!.eventDate, template.daysBefore),
            priority: template.priority || 'normal',
            status: 'todo',
            notes: '',
            sortOrder: index + 1,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        })
        batch.update(eventRef, { checklistSeeded: true, readinessSource: 'checklist', progress: 0, updatedAt: serverTimestamp() })
        await batch.commit()
        setSuccess(`${templates.length} recommended checklist tasks were created for this event.`)
        await loadWorkspace()
        await onChanged?.()
      } catch (seedError) {
        console.error('[event-operations] Unable to create checklist', seedError)
        seedStartedRef.current = false
        setError('The recommended event checklist could not be created automatically.')
      } finally {
        setSeeding(false)
      }
    }
    void seedChecklist()
  }, [eventRef, loadWorkspace, loading, meta, onChanged, tasks.length, tasksRef])

  const syncReadiness = useCallback(async (nextTasks: ChecklistTask[]) => {
    const nextReadiness = nextTasks.length ? Math.round(nextTasks.filter(task => task.status === 'done').length / nextTasks.length * 100) : 0
    await updateDoc(eventRef, {
      progress: nextReadiness,
      readinessSource: 'checklist',
      checklistTaskCount: nextTasks.length,
      checklistCompletedCount: nextTasks.filter(task => task.status === 'done').length,
      updatedAt: serverTimestamp(),
    })
    await onChanged?.()
  }, [eventRef, onChanged])

  function resetTaskForm() {
    setEditingTaskId(null)
    setTaskForm({ title: '', category: 'General', owner: '', dueDate: '', priority: 'normal', status: 'todo', notes: '' })
  }

  function resetTimelineForm() {
    setEditingTimelineId(null)
    setTimelineForm({ startTime: '', endTime: '', title: '', owner: '', vendor: '', location: '', notes: '' })
  }

  function resetProgramForm() {
    setEditingProgramId(null)
    setProgramForm({ time: '', title: '', participant: '', notes: '' })
  }

  async function saveTask(event: React.FormEvent) {
    event.preventDefault()
    if (!taskForm.title.trim()) return
    const wasEditing = Boolean(editingTaskId)
    setSaving(true)
    setError(null)
    try {
      const payload = {
        title: taskForm.title.trim(), category: taskForm.category.trim() || 'General', owner: taskForm.owner.trim(), dueDate: taskForm.dueDate,
        priority: taskForm.priority, status: taskForm.status, notes: taskForm.notes.trim(), updatedAt: serverTimestamp(),
      }
      if (editingTaskId) await updateDoc(doc(tasksRef, editingTaskId), payload)
      else await addDoc(tasksRef, { ...payload, sortOrder: Date.now(), createdAt: serverTimestamp() })
      await loadWorkspace()
      const snapshot = await getDocs(tasksRef)
      const next = snapshot.docs.map(item => mapTask(item.id, item.data()))
      await syncReadiness(next)
      resetTaskForm()
      setSuccess(wasEditing ? 'Checklist task updated.' : 'Checklist task added.')
    } catch (saveError) {
      console.error('[event-operations] Unable to save checklist task', saveError)
      setError('The checklist task could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function changeTaskStatus(task: ChecklistTask, status: TaskStatus) {
    try {
      await updateDoc(doc(tasksRef, task.id), { status, updatedAt: serverTimestamp() })
      const next = tasks.map(row => row.id === task.id ? { ...row, status } : row)
      setTasks(next)
      await syncReadiness(next)
    } catch (statusError) {
      console.error('[event-operations] Unable to update checklist status', statusError)
      setError('The checklist status could not be updated.')
    }
  }

  async function removeTask(task: ChecklistTask) {
    if (!window.confirm(`Delete checklist task “${task.title}”?`)) return
    try {
      await deleteDoc(doc(tasksRef, task.id))
      const next = tasks.filter(row => row.id !== task.id)
      setTasks(next)
      if (editingTaskId === task.id) resetTaskForm()
      await syncReadiness(next)
      setSuccess('Checklist task deleted.')
    } catch (deleteError) {
      console.error('[event-operations] Unable to delete checklist task', deleteError)
      setError('The checklist task could not be deleted.')
    }
  }

  function editTask(task: ChecklistTask) {
    setEditingTaskId(task.id)
    setTaskForm({ title: task.title, category: task.category, owner: task.owner, dueDate: task.dueDate, priority: task.priority, status: task.status, notes: task.notes })
  }

  async function saveTimeline(event: React.FormEvent) {
    event.preventDefault()
    if (!timelineForm.title.trim() || !timelineForm.startTime) return
    const wasEditing = Boolean(editingTimelineId)
    setSaving(true)
    setError(null)
    try {
      const payload = {
        startTime: timelineForm.startTime, endTime: timelineForm.endTime, title: timelineForm.title.trim(), owner: timelineForm.owner.trim(), vendor: timelineForm.vendor.trim(),
        location: timelineForm.location.trim(), notes: timelineForm.notes.trim(), updatedAt: serverTimestamp(),
      }
      if (editingTimelineId) await updateDoc(doc(timelineRef, editingTimelineId), payload)
      else await addDoc(timelineRef, { ...payload, sortOrder: Number(timelineForm.startTime.replace(':', '')) || Date.now(), createdAt: serverTimestamp() })
      await loadWorkspace()
      resetTimelineForm()
      setSuccess(wasEditing ? 'Timeline item updated.' : 'Timeline item added.')
      await onChanged?.()
    } catch (saveError) {
      console.error('[event-operations] Unable to save timeline item', saveError)
      setError('The timeline item could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function removeTimeline(item: TimelineItem) {
    if (!window.confirm(`Delete timeline item “${item.title}”?`)) return
    try {
      await deleteDoc(doc(timelineRef, item.id))
      setTimeline(previous => previous.filter(row => row.id !== item.id))
      if (editingTimelineId === item.id) resetTimelineForm()
      setSuccess('Timeline item deleted.')
      await onChanged?.()
    } catch (deleteError) {
      console.error('[event-operations] Unable to delete timeline item', deleteError)
      setError('The timeline item could not be deleted.')
    }
  }

  function editTimeline(item: TimelineItem) {
    setEditingTimelineId(item.id)
    setTimelineForm({ startTime: item.startTime, endTime: item.endTime, title: item.title, owner: item.owner, vendor: item.vendor, location: item.location, notes: item.notes })
  }

  async function prepareProgramRevision() {
    const prepare = httpsCallable<
      { storeId: string; eventId: string },
      { ok: boolean; archivedRevision: number | null; nextRevision: number; alreadyDraft: boolean }
    >(functions, 'prepareEventProgramRevision')
    const response = await prepare({ storeId, eventId })
    return response.data
  }

  async function saveProgram(event: React.FormEvent) {
    event.preventDefault()
    if (!programForm.title.trim()) return
    const wasEditing = Boolean(editingProgramId)
    const wasApproved = meta?.programApproval.status === 'approved'
    setSaving(true)
    setError(null)
    try {
      if (wasApproved) await prepareProgramRevision()
      const payload = { time: programForm.time, title: programForm.title.trim(), participant: programForm.participant.trim(), notes: programForm.notes.trim(), updatedAt: serverTimestamp() }
      if (editingProgramId) await updateDoc(doc(programRef, editingProgramId), payload)
      else await addDoc(programRef, { ...payload, sortOrder: Number(programForm.time.replace(':', '')) || Date.now(), createdAt: serverTimestamp() })
      await loadWorkspace()
      resetProgramForm()
      setSuccess(wasApproved
        ? `${wasEditing ? 'Program item updated' : 'Program item added'}. The previous approved revision was preserved for the client.`
        : wasEditing ? 'Program item updated.' : 'Program item added.')
      await onChanged?.()
    } catch (saveError) {
      console.error('[event-operations] Unable to save program item', saveError)
      setError('The program item could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function removeProgram(item: ProgramItem) {
    if (!window.confirm(`Delete program item “${item.title}”?`)) return
    const wasApproved = meta?.programApproval.status === 'approved'
    try {
      if (wasApproved) await prepareProgramRevision()
      await deleteDoc(doc(programRef, item.id))
      await loadWorkspace()
      if (editingProgramId === item.id) resetProgramForm()
      setSuccess(wasApproved
        ? 'Program item deleted. The previous approved revision was preserved for the client.'
        : 'Program item deleted.')
      await onChanged?.()
    } catch (deleteError) {
      console.error('[event-operations] Unable to delete program item', deleteError)
      setError('The program item could not be deleted.')
    }
  }

  function editProgram(item: ProgramItem) {
    setEditingProgramId(item.id)
    setProgramForm({ time: item.time, title: item.title, participant: item.participant, notes: item.notes })
  }

  async function approveProgram() {
    if (!program.length) {
      setError('Add at least one program item before recording client approval.')
      return
    }
    if (!approvalName.trim()) {
      setError('Enter the client or approver name first.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateDoc(eventRef, {
        'programApproval.status': 'approved',
        'programApproval.approvedBy': approvalName.trim(),
        'programApproval.approvedAt': serverTimestamp(),
        'programApproval.revision': meta.programApproval.revision,
        updatedAt: serverTimestamp(),
      })
      await loadWorkspace()
      setSuccess(`Client program approval recorded for revision ${meta.programApproval.revision}.`)
      await onChanged?.()
    } catch (approvalError) {
      console.error('[event-operations] Unable to approve program', approvalError)
      setError('Client approval could not be recorded.')
    } finally {
      setSaving(false)
    }
  }

  async function reopenProgram() {
    setSaving(true)
    setError(null)
    try {
      const result = await prepareProgramRevision()
      await loadWorkspace()
      setSuccess(result.archivedRevision
        ? `Approved revision ${result.archivedRevision} was preserved. Revision ${result.nextRevision} is now open for changes.`
        : 'Program is already open for changes.')
      await onChanged?.()
    } catch (approvalError) {
      console.error('[event-operations] Unable to reopen program', approvalError)
      setError('The program approval could not be reopened.')
    } finally {
      setSaving(false)
    }
  }

  function printSchedule(kind: 'timeline' | 'program') {
    const rows = kind === 'timeline'
      ? timeline.map(item => `<tr><td>${escapeHtml(item.startTime)}${item.endTime ? `–${escapeHtml(item.endTime)}` : ''}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.owner || item.vendor)}</td><td>${escapeHtml(item.location)}</td><td>${escapeHtml(item.notes)}</td></tr>`).join('')
      : program.map(item => `<tr><td>${escapeHtml(item.time)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.participant)}</td><td>${escapeHtml(item.notes)}</td></tr>`).join('')
    const headings = kind === 'timeline'
      ? '<th>Time</th><th>Activity</th><th>Owner / vendor</th><th>Location</th><th>Notes</th>'
      : '<th>Time</th><th>Program item</th><th>Participant</th><th>Notes</th>'
    const popup = window.open('', '_blank', 'width=1000,height=760')
    if (!popup) {
      setError('Pop-ups are blocked. Allow pop-ups to print this schedule.')
      return
    }
    popup.document.write(`<!doctype html><html><head><title>${escapeHtml(eventTitle)} - ${kind}</title><style>body{font-family:Arial,sans-serif;padding:32px;color:#14231a}h1{margin-bottom:4px}p{color:#53665a}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border:1px solid #d8dfda;padding:9px;text-align:left;vertical-align:top}th{background:#f3f6f4}@media print{button{display:none}}</style></head><body><h1>${escapeHtml(eventTitle)}</h1><p>${kind === 'timeline' ? 'Day-of timeline / run sheet' : 'Client program outline'}</p><table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }

  if (loading || !meta) {
    return <div className="event-planning__loading"><span className="event-planning__spinner" /><p>Loading event operations…</p></div>
  }

  return (
    <div style={{ marginTop: 4 }}>
      {error ? <p className="event-planning__alert event-planning__alert--error">{error}</p> : null}
      {success ? <p className="event-planning__alert event-planning__alert--success">{success}<button type="button" onClick={() => setSuccess(null)} aria-label="Dismiss">×</button></p> : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <button type="button" className={`button ${tab === 'checklist' ? 'button--primary' : 'button--ghost'}`} onClick={() => setTab('checklist')}>Checklist · {readiness}%</button>
        <button type="button" className={`button ${tab === 'timeline' ? 'button--primary' : 'button--ghost'}`} onClick={() => setTab('timeline')}>Day-of timeline · {timeline.length}</button>
        <button type="button" className={`button ${tab === 'program' ? 'button--primary' : 'button--ghost'}`} onClick={() => setTab('program')}>Program · {program.length}</button>
        <button type="button" className={`button ${tab === 'extras' ? 'button--primary' : 'button--ghost'}`} onClick={() => setTab('extras')}>Event-type extras</button>
        <button type="button" className={`button ${tab === 'evaluation' ? 'button--primary' : 'button--ghost'}`} onClick={() => setTab('evaluation')}>Post-event evaluation</button>
      </div>

      {tab === 'checklist' ? (
        <div>
          <div className="event-planning__workspace-preview" style={{ marginTop: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div><h3>Planning checklist</h3><p>{completedTasks} of {tasks.length} tasks complete. Readiness updates automatically from completed checklist tasks.</p></div>
              <strong style={{ fontSize: '1.35rem' }}>{readiness}% ready</strong>
            </div>
            <div className="event-planning__readiness" style={{ marginTop: 12 }}><i><b style={{ width: `${readiness}%` }} /></i></div>
          </div>

          <form onSubmit={saveTask} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <h3>{editingTaskId ? 'Edit checklist task' : 'Add checklist task'}</h3>
            <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
              <label className="event-planning__field--wide">Task<input required value={taskForm.title} onChange={e => setTaskForm(previous => ({ ...previous, title: e.target.value }))} placeholder="e.g. Confirm final guest count" /></label>
              <label>Category<input value={taskForm.category} onChange={e => setTaskForm(previous => ({ ...previous, category: e.target.value }))} placeholder="Client, Venue, Vendors…" /></label>
              <label>Owner<input value={taskForm.owner} onChange={e => setTaskForm(previous => ({ ...previous, owner: e.target.value }))} placeholder="Staff member or team" /></label>
              <label>Due date<input type="date" value={taskForm.dueDate} onChange={e => setTaskForm(previous => ({ ...previous, dueDate: e.target.value }))} /></label>
              <label>Priority<select value={taskForm.priority} onChange={e => setTaskForm(previous => ({ ...previous, priority: e.target.value as TaskPriority }))}>{Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>Status<select value={taskForm.status} onChange={e => setTaskForm(previous => ({ ...previous, status: e.target.value as TaskStatus }))}>{Object.entries(TASK_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="event-planning__field--wide">Notes<textarea rows={2} value={taskForm.notes} onChange={e => setTaskForm(previous => ({ ...previous, notes: e.target.value }))} placeholder="Dependencies, contact details or special instructions" /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>{editingTaskId ? <button type="button" className="button button--ghost" onClick={resetTaskForm}>Cancel</button> : null}<button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : editingTaskId ? 'Save task' : 'Add task'}</button></div>
          </form>

          <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
            {seeding ? <div className="event-planning__notes"><strong>Creating recommended checklist…</strong><p>Sedifex is adding event-type tasks and due dates.</p></div> : null}
            {!tasks.length && !seeding ? <div className="event-planning__notes"><strong>No checklist tasks</strong><p>Add a task to begin automatic readiness tracking.</p></div> : null}
            {tasks.map(task => (
              <div key={task.id} className="event-planning__notes" style={{ marginTop: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 320px' }}><strong>{task.title}</strong><p style={{ marginTop: 4 }}>{task.category}{task.owner ? ` · ${task.owner}` : ''} · {formatDate(task.dueDate)}{task.notes ? ` · ${task.notes}` : ''}</p></div>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className={`event-planning__status event-planning__status--${task.priority === 'critical' ? 'awaiting_client' : task.priority === 'high' ? 'new' : 'planning'}`}>{TASK_PRIORITY_LABELS[task.priority]}</span>
                    <select aria-label={`Status for ${task.title}`} value={task.status} onChange={e => void changeTaskStatus(task, e.target.value as TaskStatus)}>{Object.entries(TASK_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
                    <button type="button" className="button button--ghost" onClick={() => editTask(task)}>Edit</button>
                    <button type="button" className="button button--ghost" onClick={() => void removeTask(task)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'timeline' ? (
        <div>
          <div className="event-planning__workspace-preview" style={{ marginTop: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}><div><h3>Day-of timeline / run sheet</h3><p>{meta.eventDate ? `${formatDate(meta.eventDate)} · ` : ''}{meta.venue || 'Venue not set'}. Assign each line to staff or vendors and print the final run sheet.</p></div><button type="button" className="button button--ghost" onClick={() => printSchedule('timeline')}>Print timeline</button></div>
          </div>
          <form onSubmit={saveTimeline} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <h3>{editingTimelineId ? 'Edit timeline item' : 'Add timeline item'}</h3>
            <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
              <label>Start time<input required type="time" value={timelineForm.startTime} onChange={e => setTimelineForm(previous => ({ ...previous, startTime: e.target.value }))} /></label>
              <label>End time<input type="time" value={timelineForm.endTime} onChange={e => setTimelineForm(previous => ({ ...previous, endTime: e.target.value }))} /></label>
              <label className="event-planning__field--wide">Activity<input required value={timelineForm.title} onChange={e => setTimelineForm(previous => ({ ...previous, title: e.target.value }))} placeholder="e.g. Vendor setup complete" /></label>
              <label>Staff owner<input value={timelineForm.owner} onChange={e => setTimelineForm(previous => ({ ...previous, owner: e.target.value }))} placeholder="Coordinator / staff" /></label>
              <label>Vendor<input value={timelineForm.vendor} onChange={e => setTimelineForm(previous => ({ ...previous, vendor: e.target.value }))} placeholder="Vendor or supplier" /></label>
              <label>Location<input value={timelineForm.location} onChange={e => setTimelineForm(previous => ({ ...previous, location: e.target.value }))} placeholder="Stage, entrance, venue…" /></label>
              <label className="event-planning__field--wide">Notes<textarea rows={2} value={timelineForm.notes} onChange={e => setTimelineForm(previous => ({ ...previous, notes: e.target.value }))} placeholder="Instructions, dependencies or contact details" /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>{editingTimelineId ? <button type="button" className="button button--ghost" onClick={resetTimelineForm}>Cancel</button> : null}<button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : editingTimelineId ? 'Save item' : 'Add to timeline'}</button></div>
          </form>
          <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
            {!timeline.length ? <div className="event-planning__notes"><strong>No timeline items yet</strong><p>Build the event-day run sheet in chronological order.</p></div> : null}
            {timeline.map(item => <div key={item.id} className="event-planning__notes" style={{ marginTop: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}><div style={{ flex: '1 1 320px' }}><strong>{item.startTime}{item.endTime ? `–${item.endTime}` : ''} · {item.title}</strong><p style={{ marginTop: 4 }}>{[item.owner, item.vendor, item.location].filter(Boolean).join(' · ') || 'No assignment yet'}{item.notes ? ` · ${item.notes}` : ''}</p></div><div style={{ display: 'flex', gap: 7 }}><button type="button" className="button button--ghost" onClick={() => editTimeline(item)}>Edit</button><button type="button" className="button button--ghost" onClick={() => void removeTimeline(item)}>Delete</button></div></div></div>)}
          </div>
        </div>
      ) : null}

      {tab === 'program' ? (
        <div>
          <div className="event-planning__workspace-preview" style={{ marginTop: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div><h3>Client program outline</h3><p>Keep the guest-facing program separate from the internal run sheet. Any change after approval preserves the approved revision before opening a new draft.</p></div>
              <span className={`event-planning__status event-planning__status--${meta.programApproval.status === 'approved' ? 'confirmed' : 'new'}`}>{meta.programApproval.status === 'approved' ? `Client approved · revision ${meta.programApproval.revision}` : `Draft · revision ${meta.programApproval.revision}`}</span>
            </div>
            {meta.programApproval.status === 'approved' ? <p style={{ marginTop: 10 }}><strong>Approved by:</strong> {meta.programApproval.approvedBy} · {formatDateTime(meta.programApproval.approvedAt)}</p> : null}
            <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 12 }}>
              <label style={{ flex: '1 1 240px' }}>Client / approver name<input value={approvalName} onChange={e => setApprovalName(e.target.value)} placeholder="Name of client approving the program" /></label>
              {meta.programApproval.status === 'approved' ? <button type="button" className="button button--ghost" disabled={saving} onClick={() => void reopenProgram()}>Reopen for changes</button> : <button type="button" className="button button--primary" disabled={saving} onClick={() => void approveProgram()}>Mark client approved</button>}
              <button type="button" className="button button--ghost" onClick={() => printSchedule('program')}>Print program</button>
            </div>
          </div>

          <form onSubmit={saveProgram} className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
            <h3>{editingProgramId ? 'Edit program item' : 'Add program item'}</h3>
            <div className="event-planning__form-grid" style={{ marginTop: 12 }}>
              <label>Time<input type="time" value={programForm.time} onChange={e => setProgramForm(previous => ({ ...previous, time: e.target.value }))} /></label>
              <label>Participant / speaker<input value={programForm.participant} onChange={e => setProgramForm(previous => ({ ...previous, participant: e.target.value }))} placeholder="MC, couple, speaker…" /></label>
              <label className="event-planning__field--wide">Program item<input required value={programForm.title} onChange={e => setProgramForm(previous => ({ ...previous, title: e.target.value }))} placeholder="e.g. Couple entrance" /></label>
              <label className="event-planning__field--wide">Notes<textarea rows={2} value={programForm.notes} onChange={e => setProgramForm(previous => ({ ...previous, notes: e.target.value }))} placeholder="Public-facing notes or cues" /></label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>{editingProgramId ? <button type="button" className="button button--ghost" onClick={resetProgramForm}>Cancel</button> : null}<button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : editingProgramId ? 'Save program item' : 'Add program item'}</button></div>
          </form>
          <div style={{ display: 'grid', gap: 9, marginTop: 14 }}>
            {!program.length ? <div className="event-planning__notes"><strong>No program outline yet</strong><p>Add the sequence the client and guests should see.</p></div> : null}
            {program.map(item => <div key={item.id} className="event-planning__notes" style={{ marginTop: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}><div style={{ flex: '1 1 320px' }}><strong>{item.time ? `${item.time} · ` : ''}{item.title}</strong><p style={{ marginTop: 4 }}>{item.participant || 'No participant assigned'}{item.notes ? ` · ${item.notes}` : ''}</p></div><div style={{ display: 'flex', gap: 7 }}><button type="button" className="button button--ghost" onClick={() => editProgram(item)}>Edit</button><button type="button" className="button button--ghost" onClick={() => void removeProgram(item)}>Delete</button></div></div></div>)}
          </div>
        </div>
      ) : null}

      {tab === 'extras' ? <EventTypeExtras storeId={storeId} eventId={eventId} eventTitle={eventTitle} /> : null}
      {tab === 'evaluation' ? <EventPostEventEvaluation storeId={storeId} eventId={eventId} eventTitle={eventTitle} onChanged={onChanged} /> : null}
    </div>
  )
}
