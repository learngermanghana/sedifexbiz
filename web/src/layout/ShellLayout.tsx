import React from 'react'
import { Outlet } from 'react-router-dom'
import AskSedifexAgent from '../components/AskSedifexAgent'
import EventWorkspaceActions from '../components/EventWorkspaceActions'
import Shell from './Shell'

const SHOW_ASK_SEDIFEX = false

export function ShellLayout() {
  return (
    <Shell>
      <Outlet />
      <EventWorkspaceActions />
      {/* Temporarily hide Ask Sedifex until it is ready to return. */}
      {SHOW_ASK_SEDIFEX ? <AskSedifexAgent enabled /> : null}
    </Shell>
  )
}

export default ShellLayout
