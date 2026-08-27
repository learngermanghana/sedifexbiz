import React, { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

type DeliveryProfile = {
  channel: 'apps_script_gmail' | 'sedifex_notification'
  senderName: string
  senderEmail: string
  configured: boolean
  label: string
}

type Props = {
  storeId: string
  compact?: boolean
}

export default function EventEmailDeliveryNotice({ storeId, compact = false }: Props) {
  const [profile, setProfile] = useState<DeliveryProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const getProfile = httpsCallable<{ storeId: string }, DeliveryProfile>(functions, 'getEventEmailDeliveryProfile')
        const response = await getProfile({ storeId })
        if (active) setProfile(response.data)
      } catch (loadError) {
        console.error('[event-email] Unable to load sender profile', loadError)
        if (active) setError('Sender information is unavailable right now.')
      } finally {
        if (active) setLoading(false)
      }
    }
    if (storeId) void load()
    return () => { active = false }
  }, [storeId])

  const baseStyle: React.CSSProperties = compact
    ? { marginTop: 8, fontSize: '.76rem', color: 'var(--event-muted, #64748b)' }
    : {
        marginTop: 16,
        padding: '11px 13px',
        border: '1px solid var(--event-line, #dfe8e2)',
        borderRadius: 12,
        background: 'var(--event-soft, #f8fafc)',
        color: 'var(--event-ink, #17211d)',
        fontSize: '.8rem',
        lineHeight: 1.5,
      }

  if (loading) return <div style={baseStyle}>Checking email sender…</div>
  if (error) return <div style={baseStyle}>{error}</div>
  if (!profile) return null

  const sender = profile.channel === 'apps_script_gmail'
    ? profile.senderEmail || profile.senderName || 'Configured Gmail account'
    : 'Sedifex notification sender'

  return (
    <div style={baseStyle}>
      <strong>Send from: {sender}</strong>
      <span style={{ display: 'block', marginTop: 2 }}>
        {profile.channel === 'apps_script_gmail'
          ? profile.senderEmail
            ? 'Sedifex will use your connected Google Apps Script / Gmail sender.'
            : `Sedifex will use your connected Google Apps Script / Gmail sender (${profile.senderName || 'configured account'}). Add the Gmail address under Account → Integrations → Email Apps Script if you want the exact address displayed here.`
          : 'No store Gmail Apps Script sender is configured, so Sedifex will use its notification delivery channel.'}
      </span>
    </div>
  )
}
