import React from 'react'
import { Outlet } from 'react-router-dom'
import AskSedifexAgent from '../components/AskSedifexAgent'
import EventClientCollaborationDock from '../components/EventClientCollaborationDock'
import Shell from './Shell'

const SHOW_ASK_SEDIFEX = false

export function ShellLayout() {
  return (
    <Shell>
      <Outlet />
      <EventClientCollaborationDock />
      {/* EventPdfExportDock is mounted once at App level so list and workspace routes share one control. */}
      {/* Temporarily hide Ask Sedifex until it is ready to return. */}
      {SHOW_ASK_SEDIFEX ? <AskSedifexAgent enabled /> : null}
    </Shell>
  )
}

export default ShellLayout
