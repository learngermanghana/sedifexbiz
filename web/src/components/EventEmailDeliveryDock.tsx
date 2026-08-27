import React, { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { matchPath, useLocation } from 'react-router-dom'
import { functions } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'

type DeliveryProfile = {
  channel: 'apps_script_gmail' | 'sedifex_notification'
  senderName: string
  senderEmail: string
  configured: boolean
  label: string
}

export default function EventEmailDeliveryDock() {
  const location = useLocation()
  const { storeId, isLoading } = useActiveStore()
  const isEventRoute = Boolean(
    matchPath({ path: '/event-planning', end: true }, location.pathname)
    || matchPath({ path: '/event-planning/:eventId', end: true }, location.pathname),
  )
  const [profile, setProfile] = useState<DeliveryProfile | null>(null)

  useEffect(() => {
    let active = true
    if (!isEventRoute || !storeId || isLoading) {
      setProfile(null)
      return () => { active = false }
    }
    async function load() {
      try {
        const getProfile = httpsCallable<{ storeId: string }, DeliveryProfile>(functions, 'getEventEmailDeliveryProfile')
        const response = await getProfile({ storeId })
        if (active) setProfile(response.data)
      } catch (error) {
        console.error('[event-email] Unable to load delivery profile', error)
        if (active) setProfile(null)
      }
    }
    void load()
    return () => { active = false }
  }, [isEventRoute, isLoading, storeId])

  if (!isEventRoute || !storeId || isLoading || !profile) return null

  const sender = profile.channel === 'apps_script_gmail'
    ? profile.senderEmail || profile.senderName || 'Configured Gmail account'
    : 'Sedifex notification sender'

  return (
    <div
      role="status"
      aria-label={`Event emails will be sent from ${sender}`}
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 18,
        transform: 'translateX(-50%)',
        zIndex: 2500,
        maxWidth: 'min(520px, calc(100vw - 260px))',
        padding: '8px 12px',
        borderRadius: 999,
        border: '1px solid rgba(100,116,139,.28)',
        background: 'rgba(255,255,255,.96)',
        boxShadow: '0 10px 30px rgba(15,23,42,.12)',
        color: '#334155',
        fontSize: '.75rem',
        lineHeight: 1.3,
        textAlign: 'center',
        pointerEvents: 'none',
      }}
    >
      <strong style={{ color: '#0f172a' }}>Email sender:</strong>{' '}
      {sender}
      <span style={{ marginLeft: 6, color: '#64748b' }}>
        {profile.channel === 'apps_script_gmail' ? '· Google Apps Script / Gmail' : '· Sedifex fallback'}
      </span>
    </div>
  )
}
