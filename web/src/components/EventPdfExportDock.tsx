import React, { useEffect, useMemo, useState } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { useActiveStore } from '../hooks/useActiveStore'
import {
  EVENT_PDF_SECTION_OPTIONS,
  downloadEventWorkspacePdf,
  type EventPdfSectionKey,
} from '../utils/eventWorkspacePdf'
import './EventPdfExportDock.css'

const TAB_EXPORTS: Record<string, { label: string; sections: EventPdfSectionKey[] } | null> = {
  overview: { label: 'Event summary', sections: ['summary'] },
  'client-brief': { label: 'Client brief', sections: ['clientBrief'] },
  package: { label: 'Package / scope', sections: ['package'] },
  checklist: { label: 'Planning checklist', sections: ['checklist'] },
  timeline: { label: 'Day-of timeline', sections: ['timeline'] },
  program: { label: 'Event program', sections: ['program'] },
  'guest-list': { label: 'Guest list', sections: ['guestList'] },
  vendors: { label: 'Vendor coordination', sections: ['vendors'] },
  staff: { label: 'Staff assignments', sections: ['staff'] },
  finance: { label: 'Financial summary', sections: ['finance'] },
  documents: { label: 'Contract & financial documents summary', sections: ['contract', 'finance'] },
  messages: null,
  evaluation: { label: 'Post-event evaluation', sections: ['evaluation'] },
}

const DEFAULT_PACK_SECTIONS = EVENT_PDF_SECTION_OPTIONS.map(option => option.key)

export default function EventPdfExportDock() {
  const location = useLocation()
  const { storeId, isLoading } = useActiveStore()
  const routeMatch = matchPath({ path: '/event-planning/:eventId', end: true }, location.pathname)
  const eventId = routeMatch?.params.eventId || ''
  const tab = new URLSearchParams(location.search).get('tab') || 'overview'
  const currentExport = TAB_EXPORTS[tab] ?? TAB_EXPORTS.overview
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<EventPdfSectionKey[]>(DEFAULT_PACK_SECTIONS)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setOpen(false)
    setMessage(null)
    setError(null)
  }, [eventId])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const selectedSet = useMemo(() => new Set(selected), [selected])

  if (!routeMatch || !eventId || !storeId || isLoading) return null

  function toggleSection(key: EventPdfSectionKey) {
    setSelected(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key])
    setMessage(null)
    setError(null)
  }

  async function download(sections: EventPdfSectionKey[], pack = false) {
    if (!storeId || !eventId) return
    if (!sections.length) {
      setError('Choose at least one section for the Event Pack.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await downloadEventWorkspacePdf({ storeId, eventId, sections, pack })
      setMessage(`${result.fileName} downloaded.`)
    } catch (downloadError) {
      console.error('[event-pdf] Unable to export event PDF', downloadError)
      setError(downloadError instanceof Error ? downloadError.message : 'The event PDF could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="event-pdf-dock__trigger"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        aria-controls="event-pdf-export-panel"
      >
        <span className="event-pdf-dock__file-mark" aria-hidden="true">PDF</span>
        PDF exports
      </button>

      {open ? (
        <section id="event-pdf-export-panel" className="event-pdf-dock__panel" role="dialog" aria-modal="false" aria-labelledby="event-pdf-export-title">
          <header className="event-pdf-dock__heading">
            <div>
              <p>Event documents</p>
              <h2 id="event-pdf-export-title">PDF exports</h2>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close PDF exports">×</button>
          </header>

          {error ? <p className="event-pdf-dock__message event-pdf-dock__message--error">{error}</p> : null}
          {message ? <p className="event-pdf-dock__message event-pdf-dock__message--success">{message}</p> : null}

          {currentExport ? (
            <div className="event-pdf-dock__current">
              <span>Current section</span>
              <strong>{currentExport.label}</strong>
              <button type="button" className="button button--primary" disabled={busy} onClick={() => void download(currentExport.sections)}>
                {busy ? 'Creating PDF…' : `Download ${currentExport.label} PDF`}
              </button>
            </div>
          ) : (
            <div className="event-pdf-dock__current event-pdf-dock__current--muted">
              <span>Current section</span>
              <strong>Messages</strong>
              <p>Messages are intentionally excluded from PDF export. Email and SMS histories can contain long or unnecessary conversation data.</p>
            </div>
          )}

          <div className="event-pdf-dock__pack-heading">
            <div>
              <span>Combined document</span>
              <strong>Build Event Pack</strong>
            </div>
            <button type="button" className="event-pdf-dock__select-link" onClick={() => setSelected(selected.length === EVENT_PDF_SECTION_OPTIONS.length ? [] : DEFAULT_PACK_SECTIONS)}>
              {selected.length === EVENT_PDF_SECTION_OPTIONS.length ? 'Clear all' : 'Select all'}
            </button>
          </div>

          <div className="event-pdf-dock__sections">
            {EVENT_PDF_SECTION_OPTIONS.map(option => (
              <label key={option.key}>
                <input type="checkbox" checked={selectedSet.has(option.key)} onChange={() => toggleSection(option.key)} />
                <span>
                  <strong>{option.label}</strong>
                  {option.internal ? <small>Internal</small> : <small>Client-shareable</small>}
                </span>
              </label>
            ))}
          </div>

          <div className="event-pdf-dock__privacy-note">
            Internal sections can contain guest, vendor, staff and financial information. Review the selected sections before sharing the Event Pack outside your team.
          </div>

          <footer className="event-pdf-dock__actions">
            <span>{selected.length} section{selected.length === 1 ? '' : 's'} selected</span>
            <button type="button" className="button button--primary" disabled={busy || !selected.length} onClick={() => void download(selected, true)}>
              {busy ? 'Creating Event Pack…' : 'Download Event Pack'}
            </button>
          </footer>
        </section>
      ) : null}
    </>
  )
}
