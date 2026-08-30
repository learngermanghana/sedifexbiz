import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useMemberships } from '../hooks/useMemberships'
import './AutomationCenter.css'

type DeliveryPreference = 'automatic' | 'sedifex' | 'store_email' | 'custom_webhook'

type AutomationRule = {
  eventType: string
  title: string
  description: string
  group: 'Booking' | 'Payment' | 'Reminder' | 'Follow-up'
}

type ActivityRow = {
  id: string
  eventType: string
  recipientType: string
  to: string
  subject: string
  status: string
  deliveryChannel: string
  deliveryStatus: string
  deliveryReason: string
  createdAt: Date | null
}

const RULES: AutomationRule[] = [
  { eventType: 'booking.received', title: 'Booking received', description: 'Confirm that a new booking was received.', group: 'Booking' },
  { eventType: 'booking.confirmed', title: 'Booking confirmed', description: 'Send confirmation when the store confirms the booking.', group: 'Booking' },
  { eventType: 'booking.rescheduled', title: 'Booking rescheduled', description: 'Send the customer the updated appointment date and time.', group: 'Booking' },
  { eventType: 'booking.cancelled', title: 'Booking cancelled', description: 'Notify the customer when a booking is cancelled.', group: 'Booking' },
  { eventType: 'booking.payment_submitted', title: 'Payment submitted', description: 'Acknowledge manual payment details and alert the store to review them.', group: 'Payment' },
  { eventType: 'booking.payment_received', title: 'Partial payment received', description: 'Send the amount received and the remaining balance.', group: 'Payment' },
  { eventType: 'booking.payment_confirmed', title: 'Payment confirmed + receipt', description: 'Send the payment confirmation and Sedifex email receipt.', group: 'Payment' },
  { eventType: 'booking.reminder_3d', title: '3-day booking reminder', description: 'Remind the customer three days before the appointment.', group: 'Reminder' },
  { eventType: 'booking.reminder_2d', title: '2-day booking reminder', description: 'Remind the customer two days before the appointment.', group: 'Reminder' },
  { eventType: 'booking.reminder_1d', title: '1-day booking reminder', description: 'Remind the customer one day before the appointment.', group: 'Reminder' },
  { eventType: 'booking.completed', title: 'Completion thank-you', description: 'Send a thank-you email when the booking is completed.', group: 'Follow-up' },
]

const DEFAULT_RULES = Object.fromEntries(RULES.map(rule => [rule.eventType, true])) as Record<string, boolean>

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function dateValue(value: unknown): Date | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { toDate?: () => Date }
  if (typeof candidate.toDate !== 'function') return null
  const date = candidate.toDate()
  return Number.isNaN(date.getTime()) ? null : date
}

function channelLabel(channel: string) {
  if (channel === 'apps_script_gmail') return 'Business Gmail'
  if (channel === 'custom_webhook') return 'Custom webhook'
  if (channel === 'sedifex_notification') return 'Sedifex Email'
  if (channel === 'outbox_only') return 'Sedifex outbox'
  return channel || 'Pending'
}

function statusLabel(status: string, deliveryStatus: string) {
  const value = deliveryStatus || status
  if (['sent', 'delivery_accepted'].includes(value)) return 'Sent'
  if (value === 'duplicate') return 'Already sent'
  if (['queued', 'outbox', 'queued_no_live_sender'].includes(value)) return 'Queued'
  if (['failed', 'delivery_failed', 'webhook_error'].includes(value)) return 'Failed'
  return value ? value.replace(/_/g, ' ') : 'Pending'
}

export default function AutomationCenter() {
  const { storeId } = useActiveStore()
  const { memberships, loading: membershipsLoading } = useMemberships()
  const membership = useMemo(
    () => memberships.find(item => item.storeId === storeId) ?? null,
    [memberships, storeId],
  )
  const isOwner = membership?.role === 'owner'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [customerEmailEnabled, setCustomerEmailEnabled] = useState(true)
  const [deliveryPreference, setDeliveryPreference] = useState<DeliveryPreference>('automatic')
  const [fallbackToSedifex, setFallbackToSedifex] = useState(true)
  const [replyToEmail, setReplyToEmail] = useState('')
  const [adminEmails, setAdminEmails] = useState('')
  const [automations, setAutomations] = useState<Record<string, boolean>>(DEFAULT_RULES)
  const [storeEmailConfigured, setStoreEmailConfigured] = useState(false)
  const [customWebhookConfigured, setCustomWebhookConfigured] = useState(false)
  const [activity, setActivity] = useState<ActivityRow[]>([])

  async function loadActivity(activeStoreId: string, quiet = false) {
    if (!quiet) setRefreshing(true)
    try {
      const snapshot = await getDocs(query(
        collection(db, 'stores', activeStoreId, 'notificationActivity'),
        orderBy('createdAt', 'desc'),
        limit(50),
      ))
      setActivity(snapshot.docs.map(document => {
        const data = document.data()
        return {
          id: document.id,
          eventType: stringValue(data.eventType),
          recipientType: stringValue(data.recipientType),
          to: stringValue(data.to),
          subject: stringValue(data.subject),
          status: stringValue(data.status),
          deliveryChannel: stringValue(data.deliveryChannel),
          deliveryStatus: stringValue(data.deliveryStatus),
          deliveryReason: stringValue(data.deliveryReason),
          createdAt: dateValue(data.createdAt),
        }
      }))
    } catch (activityError) {
      console.warn('[automation-center] Unable to load notification activity', activityError)
      if (!quiet) setError(activityError instanceof Error ? activityError.message : 'Unable to load automation activity.')
    } finally {
      if (!quiet) setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!storeId || membershipsLoading) return
    if (!isOwner) {
      setLoading(false)
      return
    }

    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [settingsSnapshot, storeSnapshot] = await Promise.all([
          getDoc(doc(db, 'storeSettings', storeId)),
          getDoc(doc(db, 'stores', storeId)),
        ])
        if (cancelled) return
        const settings = settingsSnapshot.data() ?? {}
        const store = storeSnapshot.data() ?? {}
        const notifications = asRecord(settings.notifications)
        const storeIntegration = asRecord(store.bulkEmailIntegration)
        const settingsIntegration = asRecord(settings.bulkEmailIntegration)
        const integration = { ...storeIntegration, ...settingsIntegration }
        const existingAutomations = asRecord(notifications.automations)
        const nextAutomations = { ...DEFAULT_RULES }
        RULES.forEach(rule => {
          if (typeof existingAutomations[rule.eventType] === 'boolean') {
            nextAutomations[rule.eventType] = existingAutomations[rule.eventType] as boolean
          }
        })

        const preference = stringValue(notifications.deliveryPreference)
        setDeliveryPreference(
          ['automatic', 'sedifex', 'store_email', 'custom_webhook'].includes(preference)
            ? preference as DeliveryPreference
            : 'automatic',
        )
        setCustomerEmailEnabled(notifications.customerEmailEnabled !== false)
        setFallbackToSedifex(notifications.fallbackToSedifex !== false)
        setReplyToEmail(stringValue(notifications.replyToEmail))
        setAdminEmails(Array.isArray(notifications.adminEmails)
          ? notifications.adminEmails.filter(value => typeof value === 'string').join(', ')
          : '')
        setAutomations(nextAutomations)
        setStoreEmailConfigured(Boolean(stringValue(integration.webAppUrl) && stringValue(integration.sharedToken)))
        setCustomWebhookConfigured(Boolean(notifications.customWebhookEnabled === true && stringValue(notifications.customWebhookUrl)))
        await loadActivity(storeId, true)
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load automation settings.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isOwner, membershipsLoading, storeId])

  async function saveSettings() {
    if (!storeId || !isOwner) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const recipients = adminEmails
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
      await setDoc(doc(db, 'storeSettings', storeId), {
        notifications: {
          customerEmailEnabled,
          adminEmails: Array.from(new Set(recipients)),
          replyToEmail: replyToEmail.trim().toLowerCase() || null,
          deliveryPreference,
          fallbackToSedifex,
          automations,
          updatedAt: serverTimestamp(),
        },
      }, { merge: true })
      setMessage('Automation settings saved.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save automation settings.')
    } finally {
      setSaving(false)
    }
  }

  function toggleRule(eventType: string) {
    setAutomations(current => ({ ...current, [eventType]: current[eventType] === false }))
  }

  if (membershipsLoading || loading) {
    return <main className="automation-center workspace-page"><section className="workspace-card"><p className="workspace-muted">Loading automations…</p></section></main>
  }

  if (!isOwner) {
    return (
      <main className="automation-center workspace-page">
        <section className="workspace-card">
          <h1>Automations</h1>
          <p className="workspace-muted">Only store owners can change automation and email delivery settings.</p>
        </section>
      </main>
    )
  }

  const groups = ['Booking', 'Payment', 'Reminder', 'Follow-up'] as const
  const enabledCount = RULES.filter(rule => automations[rule.eventType] !== false).length

  return (
    <main className="automation-center workspace-page">
      <header className="automation-center__hero">
        <div>
          <p className="automation-center__eyebrow">Sedifex Automation Engine</p>
          <h1>Automations</h1>
          <p>Control the emails Sedifex sends automatically when bookings and payments change.</p>
        </div>
        <div className="automation-center__hero-actions">
          <Link className="automation-center__secondary-button" to="/settings/integrations/email">Email integration</Link>
          <button className="automation-center__primary-button" type="button" onClick={saveSettings} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </header>

      {message ? <div className="automation-center__notice automation-center__notice--success">{message}</div> : null}
      {error ? <div className="automation-center__notice automation-center__notice--error">{error}</div> : null}

      <section className="automation-center__summary-grid">
        <article className="automation-center__summary-card"><strong>{customerEmailEnabled ? 'On' : 'Off'}</strong><span>Customer email automation</span></article>
        <article className="automation-center__summary-card"><strong>{enabledCount}/{RULES.length}</strong><span>Active email rules</span></article>
        <article className="automation-center__summary-card"><strong>{deliveryPreference === 'store_email' ? 'Business Gmail' : deliveryPreference === 'custom_webhook' ? 'Custom webhook' : deliveryPreference === 'sedifex' ? 'Sedifex Email' : 'Automatic'}</strong><span>Delivery preference</span></article>
      </section>

      <section className="automation-center__panel">
        <div className="automation-center__panel-heading">
          <div><h2>Email delivery</h2><p>Choose how transactional emails leave Sedifex.</p></div>
          <label className="automation-center__master-switch">
            <input type="checkbox" checked={customerEmailEnabled} onChange={event => setCustomerEmailEnabled(event.target.checked)} />
            <span>Customer emails {customerEmailEnabled ? 'enabled' : 'disabled'}</span>
          </label>
        </div>

        <div className="automation-center__delivery-grid">
          <label className={`automation-center__delivery-card${deliveryPreference === 'automatic' ? ' is-selected' : ''}`}>
            <input type="radio" name="deliveryPreference" value="automatic" checked={deliveryPreference === 'automatic'} onChange={() => setDeliveryPreference('automatic')} />
            <strong>Automatic</strong><span>Use the business Gmail when configured, then fall back through Sedifex delivery.</span>
          </label>
          <label className={`automation-center__delivery-card${deliveryPreference === 'sedifex' ? ' is-selected' : ''}`}>
            <input type="radio" name="deliveryPreference" value="sedifex" checked={deliveryPreference === 'sedifex'} onChange={() => setDeliveryPreference('sedifex')} />
            <strong>Sedifex Email</strong><span>No store email configuration required. Sedifex sends the transactional email.</span>
          </label>
          <label className={`automation-center__delivery-card${deliveryPreference === 'store_email' ? ' is-selected' : ''}${!storeEmailConfigured ? ' is-unavailable' : ''}`}>
            <input type="radio" name="deliveryPreference" value="store_email" checked={deliveryPreference === 'store_email'} disabled={!storeEmailConfigured} onChange={() => setDeliveryPreference('store_email')} />
            <strong>Business Gmail</strong><span>{storeEmailConfigured ? 'Configured and available.' : 'Connect Gmail / Google Apps Script first.'}</span>
          </label>
          <label className={`automation-center__delivery-card${deliveryPreference === 'custom_webhook' ? ' is-selected' : ''}${!customWebhookConfigured ? ' is-unavailable' : ''}`}>
            <input type="radio" name="deliveryPreference" value="custom_webhook" checked={deliveryPreference === 'custom_webhook'} disabled={!customWebhookConfigured} onChange={() => setDeliveryPreference('custom_webhook')} />
            <strong>Custom webhook</strong><span>{customWebhookConfigured ? 'Configured and available.' : 'Configure a notification webhook first.'}</span>
          </label>
        </div>

        <div className="automation-center__form-grid">
          <label><span>Reply-to email</span><input type="email" value={replyToEmail} onChange={event => setReplyToEmail(event.target.value)} placeholder="owner@business.com" /></label>
          <label><span>Store alert recipients</span><input type="text" value={adminEmails} onChange={event => setAdminEmails(event.target.value)} placeholder="owner@business.com, manager@business.com" /></label>
        </div>

        <label className="automation-center__fallback-row">
          <input type="checkbox" checked={fallbackToSedifex} disabled={deliveryPreference === 'sedifex'} onChange={event => setFallbackToSedifex(event.target.checked)} />
          <span><strong>Fallback to Sedifex</strong><small>If the selected business sender fails or cannot send, try the Sedifex email service instead.</small></span>
        </label>
      </section>

      <section className="automation-center__panel">
        <div className="automation-center__panel-heading"><div><h2>Email rules</h2><p>These switches control the production booking email triggers.</p></div><span className="automation-center__count">{enabledCount} active</span></div>
        {groups.map(group => (
          <div className="automation-center__rule-group" key={group}>
            <h3>{group}</h3>
            <div className="automation-center__rules">
              {RULES.filter(rule => rule.group === group).map(rule => {
                const enabled = automations[rule.eventType] !== false
                return (
                  <label className={`automation-center__rule${!customerEmailEnabled ? ' is-master-disabled' : ''}`} key={rule.eventType}>
                    <span><strong>{rule.title}</strong><small>{rule.description}</small></span>
                    <input type="checkbox" checked={enabled} disabled={!customerEmailEnabled} onChange={() => toggleRule(rule.eventType)} />
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="automation-center__panel">
        <div className="automation-center__panel-heading">
          <div><h2>Automation activity</h2><p>Recent transactional email attempts for this store.</p></div>
          <button className="automation-center__secondary-button" type="button" onClick={() => storeId && loadActivity(storeId)} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
        <div className="automation-center__activity-list">
          {activity.length === 0 ? <p className="workspace-muted">No automation email activity yet.</p> : activity.map(item => (
            <article className="automation-center__activity" key={item.id}>
              <div className="automation-center__activity-main"><strong>{item.subject || item.eventType.replace(/\./g, ' ')}</strong><span>{item.to || 'No recipient'} · {item.recipientType === 'store' ? 'Store alert' : 'Customer email'}</span></div>
              <div className="automation-center__activity-meta"><span className={`automation-center__status automation-center__status--${statusLabel(item.status, item.deliveryStatus).toLowerCase().replace(/\s+/g, '-')}`}>{statusLabel(item.status, item.deliveryStatus)}</span><span>{channelLabel(item.deliveryChannel)}</span><time>{item.createdAt ? item.createdAt.toLocaleString() : 'Pending timestamp'}</time></div>
              {item.deliveryReason ? <small className="automation-center__activity-reason">{item.deliveryReason}</small> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
