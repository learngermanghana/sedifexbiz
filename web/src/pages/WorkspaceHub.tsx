import React from 'react'
import AccountOverview from './AccountOverview'
import './WorkspaceHub.css'

export default function WorkspaceHub() {
  return (
    <div className="workspace-hub">
      <header className="workspace-hub__header">
        <p className="workspace-hub__eyebrow">Account</p>
        <h1 className="workspace-hub__title">Account overview</h1>
        <p className="workspace-hub__subtitle">
          View and manage your account without extra workspace controls.
        </p>
      </header>

      <div className="workspace-hub__sections">
        <AccountOverview headingLevel="h1" />
      </div>
    </div>
  )
}
