import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'

type TaskPriority = 'low' | 'normal' | 'high' | 'critical'
type ApplyMode = 'add' | 'replace'

type ChecklistTaskLike = {
  id: string
  title: string
  category: string
  owner: string
  dueDate: string
  priority: TaskPriority
  status: string
  notes: string
  sortOrder: number
}

type TemplateItem = {
  title: string
  category: string
  defaultOwner: string
  dueOffsetDays: number | null
  priority: TaskPriority
  notes: string
  sortOrder: number
}

type ChecklistTemplate = {
  id: string
  name: string
  eventType: string
  taskCount: number
  items: TemplateItem[]
  usageCount: number
}

type Props = {
  storeId: string
  eventId: string
  eventTitle: string
  eventType: string
  eventDate: string
  tasks: ChecklistTaskLike[]
  onApplied: () => void | Promise<void>
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

const MAX_TEMPLATE_ITEMS = 200
const MAX_ATOMIC_WRITES = 500

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function isPriority(value: unknown): value is TaskPriority {
  return ['low', 'normal', 'high', 'critical'].includes(String(value))
}

function normalizeTitle(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

function parseLocalDate(value: string) {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatLocalCalendarDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function taskOffsetDays(eventDate: string, taskDueDate: string) {
  const event = parseLocalDate(eventDate)
  const due = parseLocalDate(taskDueDate)
  if (!event || !due) return null
  return Math.round((due.getTime() - event.getTime()) / 86_400_000)
}

function dateFromOffset(eventDate: string, offsetDays: number | null) {
  if (offsetDays === null) return ''
  const event = parseLocalDate(eventDate)
  if (!event) return ''
  event.setDate(event.getDate() + offsetDays)
  return formatLocalCalendarDate(event)
}

function mapTemplateItem(value: unknown, index: number): TemplateItem | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const title = text(item.title)
  if (!title) return null
  return {
    title,
    category: text(item.category) || 'General',
    defaultOwner: text(item.defaultOwner),
    dueOffsetDays: typeof item.dueOffsetDays === 'number' && Number.isFinite(item.dueOffsetDays)
      ? Math.round(item.dueOffsetDays)
      : null,
    priority: isPriority(item.priority) ? item.priority : 'normal',
    notes: text(item.notes),
    sortOrder: numberValue(item.sortOrder, index + 1),
  }
}

function mapTemplate(id: string, data: Record<string, unknown>): ChecklistTemplate | null {
  const name = text(data.name)
  if (!name) return null
  const rawItems = Array.isArray(data.items) ? data.items.slice(0, MAX_TEMPLATE_ITEMS) : []
  const items = rawItems.map(mapTemplateItem).filter((item): item is TemplateItem => Boolean(item))
  return {
    id,
    name,
    eventType: text(data.eventType) || 'Any event',
    taskCount: items.length,
    items,
    usageCount: Math.max(0, Math.floor(numberValue(data.usageCount))),
  }
}

function setTemplateTask(
  batch: ReturnType<typeof writeBatch>,
  storeId: string,
  eventId: string,
  template: ChecklistTemplate,
  item: TemplateItem,
  index: number,
  eventDate: string,
) {
  const taskRef = doc(collection(db, 'stores', storeId, 'events', eventId, 'tasks'))
  batch.set(taskRef, {
    title: item.title,
    category: item.category,
    owner: item.defaultOwner,
    dueDate: dateFromOffset(eventDate, item.dueOffsetDays),
    priority: item.priority,
    status: 'todo',
    notes: item.notes,
    sortOrder: index + 1,
    templateId: template.id,
    templateName: template.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

async function commitTemplateApply(params: {
  storeId: string
  eventId: string
  template: ChecklistTemplate
  items: TemplateItem[]
  eventDate: string
  mode: ApplyMode
  existingTasks: ChecklistTaskLike[]
}) {
  const { storeId, eventId, template, items, eventDate, mode, existingTasks } = params
  const eventRef = doc(db, 'stores', storeId, 'events', eventId)
  const batch = writeBatch(db)

  if (mode === 'replace') {
    existingTasks.forEach(task => batch.delete(doc(db, 'stores', storeId, 'events', eventId, 'tasks', task.id)))
  }

  items.forEach((item, index) => setTemplateTask(batch, storeId, eventId, template, item, index, eventDate))

  const nextTaskCount = mode === 'replace' ? items.length : existingTasks.length + items.length
  const nextCompletedCount = mode === 'replace' ? 0 : existingTasks.filter(task => task.status === 'done').length
  const nextProgress = nextTaskCount ? Math.round(nextCompletedCount / nextTaskCount * 100) : 0

  batch.update(eventRef, {
    checklistSeeded: true,
    readinessSource: 'checklist',
    progress: nextProgress,
    checklistTaskCount: nextTaskCount,
    checklistCompletedCount: nextCompletedCount,
    updatedAt: serverTimestamp(),
  })

  await batch.commit()
}

export default function EventChecklistTemplateManager({
  storeId,
  eventId,
  eventTitle,
  eventType,
  eventDate,
  tasks,
  onApplied,
  onSuccess,
  onError,
}: Props) {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [applyMode, setApplyMode] = useState<ApplyMode>('add')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const templatesRef = useMemo(
    () => collection(db, 'stores', storeId, 'events', '__templates', 'checklists'),
    [storeId],
  )
  const selectedTemplate = useMemo(
    () => templates.find(template => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates],
  )

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const snapshot = await getDocs(templatesRef)
      const mapped = snapshot.docs
        .map(item => mapTemplate(item.id, item.data()))
        .filter((item): item is ChecklistTemplate => Boolean(item))
        .sort((a, b) => {
          const aMatch = a.eventType === eventType ? 0 : 1
          const bMatch = b.eventType === eventType ? 0 : 1
          return aMatch - bMatch || a.name.localeCompare(b.name)
        })
      setTemplates(mapped)
      setSelectedTemplateId(previous => previous && mapped.some(item => item.id === previous)
        ? previous
        : mapped[0]?.id || '')
    } catch (loadError) {
      console.error('[event-checklist-templates] Unable to load templates', loadError)
      onError('Saved checklist templates could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [eventType, onError, templatesRef])

  useEffect(() => { void loadTemplates() }, [loadTemplates])

  async function saveCurrentChecklist() {
    if (!tasks.length) {
      onError('Add checklist tasks before saving a reusable template.')
      return
    }
    if (tasks.length > MAX_TEMPLATE_ITEMS) {
      onError(`A checklist template can contain up to ${MAX_TEMPLATE_ITEMS} tasks.`)
      return
    }

    const suggestedName = eventType && eventType !== 'Other' ? `${eventType} checklist` : `${eventTitle} checklist`
    const enteredName = window.prompt('Template name', suggestedName)
    if (enteredName === null) return
    const name = enteredName.trim()
    if (!name) {
      onError('Enter a name for the checklist template.')
      return
    }

    setBusy(true)
    try {
      const items: TemplateItem[] = [...tasks]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
        .map((task, index) => ({
          title: task.title.trim(),
          category: task.category.trim() || 'General',
          defaultOwner: task.owner.trim(),
          dueOffsetDays: taskOffsetDays(eventDate, task.dueDate),
          priority: task.priority,
          notes: task.notes.trim(),
          sortOrder: index + 1,
        }))

      const created = await addDoc(templatesRef, {
        name,
        eventType: eventType || 'Any event',
        taskCount: items.length,
        items,
        sourceEventId: eventId,
        sourceEventTitle: eventTitle,
        usageCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      await loadTemplates()
      setSelectedTemplateId(created.id)
      onSuccess(`“${name}” saved with ${items.length} reusable checklist tasks.`)
    } catch (saveError) {
      console.error('[event-checklist-templates] Unable to save template', saveError)
      onError('The checklist template could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function applySelectedTemplate() {
    if (!selectedTemplate) {
      onError('Choose a checklist template first.')
      return
    }
    if (!selectedTemplate.items.length) {
      onError('This checklist template has no tasks.')
      return
    }

    const existingTitles = new Set(tasks.map(task => normalizeTitle(task.title)))
    const itemsToAdd = applyMode === 'add'
      ? selectedTemplate.items.filter(item => !existingTitles.has(normalizeTitle(item.title)))
      : selectedTemplate.items

    if (applyMode === 'add' && !itemsToAdd.length) {
      onSuccess(`All tasks from “${selectedTemplate.name}” are already on this event.`)
      return
    }

    const requiredWrites = (applyMode === 'replace' ? tasks.length : 0) + itemsToAdd.length + 1
    if (requiredWrites > MAX_ATOMIC_WRITES) {
      onError(`This checklist is too large to replace safely in one atomic operation. Keep the current checklist and use “Add missing tasks”, or reduce it before replacing.`)
      return
    }

    if (applyMode === 'replace' && tasks.length) {
      const confirmed = window.confirm(`Replace all ${tasks.length} current checklist tasks with “${selectedTemplate.name}”? Completed statuses will not be carried over.`)
      if (!confirmed) return
    }

    setBusy(true)
    try {
      await commitTemplateApply({
        storeId,
        eventId,
        template: selectedTemplate,
        items: itemsToAdd,
        eventDate,
        mode: applyMode,
        existingTasks: tasks,
      })
    } catch (applyError) {
      console.error('[event-checklist-templates] Unable to apply template atomically', applyError)
      onError('The checklist template could not be applied. Your existing checklist was left unchanged.')
      setBusy(false)
      return
    }

    try {
      await updateDoc(doc(templatesRef, selectedTemplate.id), {
        usageCount: increment(1),
        lastUsedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    } catch (usageError) {
      console.warn('[event-checklist-templates] Checklist applied but usage metadata could not be updated', usageError)
    }

    try {
      await onApplied()
      await loadTemplates()
      onSuccess(applyMode === 'replace'
        ? `Checklist replaced with ${itemsToAdd.length} tasks from “${selectedTemplate.name}”.`
        : `${itemsToAdd.length} tasks from “${selectedTemplate.name}” added. Duplicate task names were skipped.`)
    } catch (refreshError) {
      console.warn('[event-checklist-templates] Checklist applied but UI refresh failed', refreshError)
      onError('The checklist was updated successfully, but the page could not refresh. Reload the event to see the changes.')
    } finally {
      setBusy(false)
    }
  }

  async function removeSelectedTemplate() {
    if (!selectedTemplate) return
    const confirmed = window.confirm(`Delete saved checklist template “${selectedTemplate.name}”? Existing events will not be changed.`)
    if (!confirmed) return
    setBusy(true)
    try {
      await deleteDoc(doc(templatesRef, selectedTemplate.id))
      await loadTemplates()
      onSuccess(`Checklist template “${selectedTemplate.name}” deleted. Existing event checklists were left unchanged.`)
    } catch (deleteError) {
      console.error('[event-checklist-templates] Unable to delete template', deleteError)
      onError('The checklist template could not be deleted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="event-planning__workspace-preview" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <h3>Reusable checklist templates</h3>
          <p>Save this store's common workflow once, then copy it into future events. Due dates are recalculated from each event date and task completion statuses always start fresh.</p>
        </div>
        <button type="button" className="button button--ghost" disabled={busy || !tasks.length} onClick={() => void saveCurrentChecklist()}>
          {busy ? 'Working…' : 'Save current as template'}
        </button>
      </div>

      {loading ? (
        <p style={{ marginTop: 12 }}>Loading saved templates…</p>
      ) : templates.length ? (
        <div className="event-planning__form-grid" style={{ marginTop: 14 }}>
          <label className="event-planning__field--wide">
            Saved template
            <select value={selectedTemplateId} onChange={event => setSelectedTemplateId(event.target.value)}>
              {templates.map(template => (
                <option value={template.id} key={template.id}>
                  {template.name} · {template.taskCount} tasks{template.eventType && template.eventType !== 'Any event' ? ` · ${template.eventType}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Apply to this event
            <select value={applyMode} onChange={event => setApplyMode(event.target.value as ApplyMode)}>
              <option value="add">Add missing tasks</option>
              <option value="replace">Replace current checklist</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <button type="button" className="button button--primary" disabled={busy || !selectedTemplate} onClick={() => void applySelectedTemplate()}>
              {busy ? 'Applying…' : 'Use template'}
            </button>
            <button type="button" className="button button--ghost" disabled={busy || !selectedTemplate} onClick={() => void removeSelectedTemplate()}>
              Delete template
            </button>
          </div>
          {selectedTemplate ? (
            <p className="event-planning__field--wide" style={{ margin: 0 }}>
              <strong>{selectedTemplate.name}</strong> contains {selectedTemplate.items.length} reusable tasks and has been used {selectedTemplate.usageCount} {selectedTemplate.usageCount === 1 ? 'time' : 'times'}.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="event-planning__notes" style={{ marginTop: 12 }}>
          <strong>No saved templates yet</strong>
          <p>Build this event's checklist, then choose “Save current as template” to reuse it for future events.</p>
        </div>
      )}
    </section>
  )
}
