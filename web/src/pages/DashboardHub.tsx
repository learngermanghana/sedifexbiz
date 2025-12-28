import React from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import './DashboardHub.css'

const tabs = [
  { to: '/dashboard', label: 'Main dashboard', end: true },
  { to: '/dashboard/activity', label: 'Activity' },
]

export default function DashboardHub() {
  const location = useLocation()
  return (
    <div className="dashboard-hub">
      <nav className="dashboard-hub__tabs" role="tablist" aria-label="Dashboard views">
        {tabs.map(tab => {
          const isActive = tab.end
            ? location.pathname === tab.to
            : location.pathname.startsWith(tab.to)
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              role="tab"
              aria-selected={isActive}
              className={isActive ? 'dashboard-hub__tab dashboard-hub__tab--active' : 'dashboard-hub__tab'}
            >
              {tab.label}
            </NavLink>
          )
        })}
      </nav>
      <div className="dashboard-hub__content">
        <Outlet />
      </div>
    </div>
  )
}
