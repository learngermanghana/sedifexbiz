import React from 'react'
import { Outlet } from 'react-router-dom'
import Shell from './Shell'

export function ShellLayout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  )
}

export default ShellLayout
