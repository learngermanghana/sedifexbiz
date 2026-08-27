import React from 'react'
import { Outlet } from 'react-router-dom'
import AskSedifexAgent from '../components/AskSedifexAgent'
import EventClientCollaborationDock from '../components/EventClientCollaborationDock'
import EventPdfExportDock from '../components/EventPdfExportDock'
import Shell from './Shell'

const SHOW_ASK_SEDIFEX = false

export function ShellLayout() {
  return (
    <Shell>
      <Outlet />
      <EventClientCollaborationDock />
      <EventPdfExportDock />
      {/* Temporarily hide Ask Sedifex until it is ready to return. */}
      {SHOW_ASK_SEDIFEX ? <AskSedifexAgent enabled /> : null}
    </Shell>
  )
}

export default ShellLayout