import React, { useEffect, useMemo, useState } from 'react'
import { Timestamp, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import PageSection from '../layout/PageSection'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useMemberships } from '../hooks/useMemberships'
import { useToast } from '../components/ToastProvider'
import './WorkspaceSettings.css'

const WORKSPACE_STATUSES = ['active', 'trial', 'paused'] as const

const STATUS_LABELS: Record<(typeof WORKSPACE_STATUSES)[number], string> = {
  active: 'Active',
  trial: 'Trial',
  paused: 'Paused',
}

type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number]

type WorkspaceSettingsState = {
  name: string
  logoUrl: string
  workspaceSlug: string
  status: WorkspaceStatus
  contractStart: string
  contractEnd: string
}

const DEFAULT_SETTINGS: WorkspaceSettingsState = {
  name: '',
  logoUrl: '',
  workspaceSlug: '',
  status: 'active',
  contractStart: '',
  contractEnd: '',
}

function isTimestamp(value: unknown): value is Timestamp {
  return value instanceof Timestamp
}

function normalizeStatus(value: unknown): WorkspaceStatus {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (WORKSPACE_STATUSES.includes(normalized as WorkspaceStatus)) {
    return normalized as WorkspaceStatus
  }
  return 'active'
}

function toDateInputValue(value: unknown): string {
  try {
    if (isTimestamp(value)) {
      return value.toDate().toISOString().slice(0, 10)
    }
    if (typeof value === 'string' && value) {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10)
      }
    }
  } catch (error) {
    console.warn('[workspace] Unable to format date input', error)
  }
  return ''
}

function parseDateInput(value: string): Timestamp | null | 'invalid' {
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    return 'invalid'
  }

  return Timestamp.fromDate(parsed)
}

export default function WorkspaceSettings() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const { memberships } = useMemberships()
  const { publish } = useToast()

  const [settings, setSettings] = useState<WorkspaceSettingsState>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeMembership = useMemo(() => {
    if (!storeId) return null
    return memberships.find(membership => membership.storeId === storeId) ?? null
  }, [memberships, storeId])

  const isOwner = activeMembership?.role === 'owner'

  useEffect(() => {
    if (!storeId) {
      setSettings(prev => ({ ...DEFAULT_SETTINGS, workspaceSlug: prev.workspaceSlug || '' }))
      setError(storeError)
      return
    }

    let cancelled = false

    async function loadWorkspace() {
      setLoading(true)
      setError(null)

      try {
        const ref = doc(db, 'workspaces', storeId)
        const snapshot = await getDoc(ref)
        if (cancelled) return

        if (!snapshot.exists()) {
          setSettings({ ...DEFAULT_SETTINGS, workspaceSlug: storeId })
          return
        }

        const data = snapshot.data()
        setSettings({
          name: typeof data.name === 'string' ? data.name : '',
          logoUrl: typeof data.logoUrl === 'string' ? data.logoUrl : '',
          workspaceSlug:
            typeof data.workspaceSlug === 'string' && data.workspaceSlug.trim()
              ? data.workspaceSlug.trim()
              : storeId,
          status: normalizeStatus(data.status),
          contractStart: toDateInputValue((data as any).contractStart),
          contractEnd: toDateInputValue((data as any).contractEnd),
        })
      } catch (e) {
        console.warn('[workspace] Failed to load workspace settings', e)
        setError('We could not load your workspace settings. Try again.')
        setSettings({ ...DEFAULT_SETTINGS, workspaceSlug: storeId })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadWorkspace()

    return () => {
      cancelled = true
    }
  }, [storeError, storeId])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!storeId) {
      setError('Select a workspace before saving settings.')
      return
    }

    if (!isOwner) {
      setError('Only workspace owners can update workspace settings.')
      return
    }

    const parsedStart = parseDateInput(settings.contractStart)
    if (parsedStart === 'invalid') {
      setError('Enter a valid contract start date.')
      return
    }

    const parsedEnd = parseDateInput(settings.contractEnd)
    if (parsedEnd === 'invalid') {
      setError('Enter a valid contract end date.')
      return
    }

    if (parsedStart && parsedEnd && parsedEnd.toMillis() < parsedStart.toMillis()) {
      setError('Contract end cannot be earlier than the start date.')
      return
    }

    setSaving(true)
    setError(null)

    const normalizedName = settings.name.trim()
    const normalizedLogo = settings.logoUrl.trim()
    const normalizedSlug = settings.workspaceSlug.trim() || storeId

    const payload = {
      name: normalizedName || null,
      displayName: normalizedName || null,
      logoUrl: normalizedLogo || null,
      workspaceSlug: normalizedSlug,
      slug: normalizedSlug,
      storeSlug: normalizedSlug,
      storeId,
      status: settings.status,
      contractStart: parsedStart ?? null,
      contractEnd: parsedEnd ?? null,
      updatedAt: serverTimestamp(),
    }

    try {
      await setDoc(doc(db, 'workspaces', storeId), payload, { merge: true })
      setSettings(prev => ({
        ...prev,
        name: normalizedName,
        logoUrl: normalizedLogo,
        workspaceSlug: normalizedSlug,
      }))
      publish({ tone: 'success', message: 'Workspace settings saved.' })
    } catch (e) {
      console.warn('[workspace] Failed to save workspace settings', e)
      setError('We could not save your changes. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const disabled = saving || loading || !isOwner

  return (
    <PageSection
      title="Workspace settings"
      subtitle="Manage your workspace identity, status, and contract timeline."
      actions={
        <button
          type="submit"
          form="workspace-settings"
          className="button button--primary"
          disabled={disabled || !storeId}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      }
    >
      <form id="workspace-settings" className="workspace-settings" onSubmit={handleSubmit}>
        {storeLoading && <p className="workspace-settings__hint">Loading your workspace…</p>}
        {!storeLoading && !storeId && (
          <p className="workspace-settings__hint">Select a workspace to view its settings.</p>
        )}
        {error && <p className="workspace-settings__error">{error}</p>}

        <div className="workspace-settings__grid">
          <div className="field">
            <label className="field__label" htmlFor="workspace-name">
              Workspace name
            </label>
            <input
              id="workspace-name"
              type="text"
              value={settings.name}
              onChange={event => setSettings(prev => ({ ...prev, name: event.target.value }))}
              disabled={disabled || !storeId}
              placeholder="e.g. Acme Foods"
            />
            <p className="field__hint">Visible across your team and invoices.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="workspace-logo">
              Workspace logo URL
            </label>
            <input
              id="workspace-logo"
              type="url"
              value={settings.logoUrl}
              onChange={event => setSettings(prev => ({ ...prev, logoUrl: event.target.value }))}
              disabled={disabled || !storeId}
              placeholder="https://example.com/logo.png"
            />
            <p className="field__hint">Provide a link to the logo file your team should use.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="workspace-slug">
              Workspace slug
            </label>
            <input
              id="workspace-slug"
              type="text"
              value={settings.workspaceSlug}
              readOnly
              disabled
            />
            <p className="field__hint">Slug is generated from workspaceSlug and cannot be changed here.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="workspace-status">
              Status
            </label>
            <select
              id="workspace-status"
              value={settings.status}
              onChange={event =>
                setSettings(prev => ({ ...prev, status: event.target.value as WorkspaceStatus }))
              }
              disabled={disabled || !storeId}
            >
              {WORKSPACE_STATUSES.map(status => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <p className="field__hint">Choose whether the workspace is active, in trial, or paused.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="contract-start">
              Contract start
            </label>
            <input
              id="contract-start"
              type="date"
              value={settings.contractStart}
              onChange={event => setSettings(prev => ({ ...prev, contractStart: event.target.value }))}
              disabled={disabled || !storeId}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="contract-end">
              Contract end
            </label>
            <input
              id="contract-end"
              type="date"
              value={settings.contractEnd}
              onChange={event => setSettings(prev => ({ ...prev, contractEnd: event.target.value }))}
              disabled={disabled || !storeId}
            />
          </div>
        </div>

        {!isOwner && storeId && (
          <p className="workspace-settings__hint">
            You have read-only access. Ask a workspace owner to update these settings.
          </p>
        )}
      </form>
    </PageSection>
  )
}
