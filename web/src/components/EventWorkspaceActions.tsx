import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { matchPath, useLocation } from 'react-router-dom'
import EventClientCollaborationDock from './EventClientCollaborationDock'
import EventPdfExportDock from './EventPdfExportDock'
import EventProductionToolsDock from './EventProductionToolsDock'
import './EventWorkspaceActions.css'

function findEventActionsTarget() {
  const standalone = document.querySelector<HTMLElement>('.event-workspace__hero')
  if (standalone) return standalone

  const modalTitle = document.getElementById('event-contract-title')
  const modal = modalTitle?.closest<HTMLElement>('.event-planning__modal')
  const modalHeading = modal?.querySelector<HTMLElement>('.event-planning__modal-heading')
  return modalHeading || null
}

export default function EventWorkspaceActions() {
  const location = useLocation()
  const eventRoute = matchPath({ path: '/event-planning/:eventId', end: true }, location.pathname)
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!eventRoute) {
      setTarget(null)
      return
    }

    const syncTarget = () => {
      const next = findEventActionsTarget()
      setTarget(current => current === next && (!current || current.isConnected) ? current : next)
    }

    syncTarget()
    const observer = new MutationObserver(syncTarget)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [eventRoute?.params.eventId, location.pathname])

  if (!eventRoute || !target) return null

  return createPortal(
    <section className="event-workspace-actions" aria-label="Event actions">
      <div className="event-workspace-actions__copy">
        <div>
          <p>Event actions</p>
          <strong>Client portal, documents and production tools</strong>
        </div>
        <small>Open a tool only when you need it. Nothing stays floating over the page.</small>
      </div>
      <div className="event-workspace-actions__controls">
        <EventClientCollaborationDock />
        <EventPdfExportDock />
        <EventProductionToolsDock />
      </div>
    </section>,
    target,
  )
}
