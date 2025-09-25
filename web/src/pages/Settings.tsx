import React from 'react'
import { useAuthUser } from '../hooks/useAuthUser'
import { useActiveStore } from '../hooks/useActiveStore'
export default function Settings() {
  const user = useAuthUser()
  const { storeId, role, isLoading, error } = useActiveStore()
  return (
    <div>
      <h2 style={{color:'#4338CA'}}>Settings</h2>
      {isLoading ? (
        <p>Loading store access…</p>
      ) : (
        <>
          <p><strong>Store ID:</strong> {storeId ?? 'Unavailable'}</p>
          <p><strong>Role:</strong> {role ?? 'Not assigned'}</p>
        </>
      )}
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      <p><strong>User:</strong> {user?.email}</p>
    </div>
  )
}
