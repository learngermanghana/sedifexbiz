import React from 'react'
import { useAuthUser } from '../hooks/useAuthUser'
export default function Settings() {
  const user = useAuthUser()
  return (
    <div>
      <h2 style={{color:'#4338CA'}}>Settings</h2>
      <p><strong>Store ID:</strong> {user?.uid}</p>
      <p><strong>User:</strong> {user?.email}</p>
    </div>
  )
}
