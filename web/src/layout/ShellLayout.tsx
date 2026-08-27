import React from 'react'
import { Outlet } from 'react-router-dom'
import AskSedifexAgent from '../components/AskSedifexAgent'
import EventClientCollaborationDock from '../components/EventClientCollaborationDock'
import EventEmailDeliveryDock from '../components/EventEmailDeliveryDock'
import Shell from './Shell'

const SHOW_ASK_SEDIFEX = false

export function ShellLayout() {
  return (
    <Shell>
      <Outlet />
      <EventClientCollaborationDock />
      <EventEmailDeliveryDock />
      {/* Keep EventPdfExportDock mounted only at App level so the Events list and full event workspace share one export control. */}
      {/* Temporarily hide Ask Sedifex until it is ready to return. */}
      {SHOW_ASK_SEDIFEX ? <AskSedifexAgent enabled /> : null}
    </Shell>
  )
}

export default ShellLayout
