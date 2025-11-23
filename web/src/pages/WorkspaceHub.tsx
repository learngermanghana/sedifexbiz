import React from 'react'
import WorkspaceSettings from './WorkspaceSettings'
import AccountOverview from './AccountOverview'
import StaffManagement from './StaffManagement'
import './WorkspaceHub.css'

export default function WorkspaceHub() {
  return (
    <div className="workspace-hub">
      <header className="workspace-hub__header">
        <p className="workspace-hub__eyebrow">Workspace</p>
        <h1 className="workspace-hub__title">Workspace control center</h1>
        <p className="workspace-hub__subtitle">
          Manage workspace settings, billing, and team access without switching tabs.
        </p>
      </header>

      <div className="workspace-hub__sections">
        <WorkspaceSettings />
        <AccountOverview headingLevel="h2" />
        <StaffManagement headingLevel="h2" />
      </div>
    </div>
  )
}
