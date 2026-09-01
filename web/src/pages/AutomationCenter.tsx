import { useCallback, useEffect, useMemo, useState } from 'react'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { Link } from 'react-router-dom'
import { app } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './AutomationCenter.css'

type DeliveryPreference = 'automatic' | 'sedifex' | 'store_email' | 'custom_webhook'
type ChannelRule = { email: boolean; sms: boolean }
type AutomationSettings = {
  emailEnabled: boolean
  smsEnabled: boolean
  deliveryPreference: DeliveryPreference
  fallbackToSedifex: boolean
  channels: Record<string, ChannelRule>
}
type Readiness = {
  email: { storeEmailConfigured: boolean; customWebhookConfigured: boolean }
  sms: { configured: boolean; senderId: string | null; creditBalance: number }
}
type AutomationState = { settings: AutomationSettings; readiness: Readiness }

type Rule = {
  eventType: string
  label: string
  detail: string
  group: 'Booking' | 'Payments' | 'Reminders' | 'Follow-up'
  smsSupported: boolean
}

const RULES: Rule[] = [
  { eventType: 'booking.received', label: 'Booking received', detail: 'Tell the customer that a booking request has been received.', group: 'Booking', smsSupported: false },
  { eventType: 'booking.confirmed', label: 'Booking confirmed', detail: 'Send confirmation after the booking is approved.', group: 'Booking', smsSupported: false },
  { eventType: 'booking.rescheduled', label: 'Booking rescheduled', detail: 'Send the updated date and time after a schedule change.', group: 'Booking', smsSupported: false },
  { eventType: 'booking.cancelled', label: 'Booking cancelled', detail: 'Tell the customer when a booking is cancelled.', group: 'Booking', smsSupported: false },
  { eventType: 'booking.payment_submitted', label: 'Payment submitted', detail: 'Acknowledge payment details that are awaiting verification.', group: 'Payments', smsSupported: false },
  { eventType: 'booking.payment_received', label: 'Partial payment received', detail: 'Confirm a recorded part-payment and remaining balance.', group: 'Payments', smsSupported: false },
  { eventType: 'booking.payment_confirmed', label: 'Payment confirmed', detail: 'Confirm a verified payment or completed payment collection.', group: 'Payments', smsSupported: true },
  { eventType: 'booking.reminder_3d', label: '3-day booking reminder', detail: 'Remind confirmed, paid customers three days before the booking.', group: 'Reminders', smsSupported: true },
  { eventType: 'booking.reminder_2d', label: '2-day booking reminder', detail: 'Remind confirmed, paid customers two days before the booking.', group: 'Reminders', smsSupported: true },
  { eventType: 'booking.reminder_1d', label: '1-day booking reminder', detail: 'Remind confirmed, paid customers the day before the booking.', group: 'Reminders', smsSupported: true },
  { eventType: 'booking.completed', label: 'Completion thank-you', detail: 'Thank the customer after the booking is marked completed.', group: 'Follow-up', smsSupported: true },
]

const PREFERENCES: Array<{ value: DeliveryPreference; title: string; detail: string }> = [
  { value: 'automatic', title: 'Automatic', detail: 'Try the business email first, then configured fallbacks.' },
  { value: 'sedifex', title: 'Sedifex Email', detail: 'Use the Sedifex transactional email sender.' },
  { value: 'store_email', title: 'Business Gmail', detail: 'Use the connected business Gmail / Apps Script sender.' },
  { value: 'custom_webhook', title: 'Custom webhook', detail: 'Send through the configured custom email webhook.' },
]

function cloneSettings(settings: AutomationSettings): AutomationSettings {
  return {
    ...settings,
    channels: Object.fromEntries(Object.entries(settings.channels).map(([key, rule]) => [key, { ...rule }])),
  }
}

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className={`automation-toggle ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} aria-label={label} />
      <span className="automation-toggle-track"><span className="automation-toggle-knob" /></span>
    </label>
  )
}

export default function AutomationCenter() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const [state, setState] = useState<AutomationState | null>(null)
  const [draft, setDraft] = useState<AutomationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')

  const load = useCallback(async () => {
    if (!storeId) return
    setLoading(true)
    setError('')
    try {
      const callable = httpsCallable<{ storeId: string }, AutomationState>(getFunctions(app), 'getAutomationCenterState')
      const response = await callable({ storeId })
      setState(response.data)
      setDraft(cloneSettings(response.data.settings))
    } catch (loadError) {
      console.error('[automations] Failed to load Automation Center', loadError)
      setError('We could not load automation settings. Only the workspace owner can manage this page.')
    } finally {
      setLoading(false)
    }
  }, [storeId])

  useEffect(() => {
    if (storeLoading) return
    if (!storeId) {
      setLoading(false)
      return
    }
    void load()
  }, [load, storeId, storeLoading])

  const changed = useMemo(() => Boolean(state && draft && JSON.stringify(state.settings) !== JSON.stringify(draft)), [draft, state])
  const activeEmailRules = useMemo(() => draft ? RULES.filter(rule => draft.emailEnabled && draft.channels[rule.eventType]?.email).length : 0, [draft])
  const activeSmsRules = useMemo(() => draft ? RULES.filter(rule => rule.smsSupported && draft.smsEnabled && draft.channels[rule.eventType]?.sms).length : 0, [draft])

  const updateRule = (eventType: string, channel: 'email' | 'sms', enabled: boolean) => {
    setDraft(current => {
      if (!current) return current
      const next = cloneSettings(current)
      next.channels[eventType] = { ...(next.channels[eventType] || { email: true, sms: false }), [channel]: enabled }
      return next
    })
    setSavedMessage('')
  }

  const save = async () => {
    if (!storeId || !draft) return
    setSaving(true)
    setError('')
    setSavedMessage('')
    try {
      const callable = httpsCallable<{ storeId: string; settings: AutomationSettings }, AutomationState & { ok: boolean }>(getFunctions(app), 'saveAutomationCenterSettings')
      const response = await callable({ storeId, settings: draft })
      const nextState = { settings: response.data.settings, readiness: response.data.readiness }
      setState(nextState)
      setDraft(cloneSettings(nextState.settings))
      setSavedMessage('Automation settings saved.')
    } catch (saveError) {
      console.error('[automations] Failed to save Automation Center', saveError)
      setError('We could not save these automation settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (storeLoading || loading) {
    return <main className="automation-page"><section className="automation-card"><p className="automation-muted">Loading automations…</p></section></main>
  }

  if (!storeId || storeError) {
    return <main className="automation-page"><section className="automation-card"><h1>Automations</h1><p className="automation-error">{storeError || 'Select a workspace to manage automations.'}</p></section></main>
  }

  if (!draft || !state) {
    return <main className="automation-page"><section className="automation-card"><h1>Automations</h1><p className="automation-error">{error || 'Automation settings are unavailable.'}</p><button className="automation-secondary" onClick={() => void load()}>Retry</button></section></main>
  }

  const readiness = state.readiness
  const emailPreferenceUnavailable = (preference: DeliveryPreference) =>
    (preference === 'store_email' && !readiness.email.storeEmailConfigured)
    || (preference === 'custom_webhook' && !readiness.email.customWebhookConfigured)

  return (
    <main className="automation-page">
      <section className="automation-hero">
        <div>
          <p className="automation-eyebrow">Customer communication</p>
          <h1>Email + SMS Automations</h1>
          <p>Choose exactly which booking messages Sedifex sends and which channel each automation can use.</p>
        </div>
        <div className="automation-hero-actions">
          <button className="automation-secondary" disabled={!changed || saving} onClick={() => setDraft(cloneSettings(state.settings))}>Discard</button>
          <button className="automation-primary" disabled={!changed || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </section>

      {error && <div className="automation-banner error">{error}</div>}
      {savedMessage && <div className="automation-banner success">{savedMessage}</div>}

      <section className="automation-summary-grid">
        <article className="automation-summary-card">
          <span>Email automations</span>
          <strong>{draft.emailEnabled ? `${activeEmailRules} active` : 'Off'}</strong>
          <small>{readiness.email.storeEmailConfigured ? 'Business email connected' : 'Sedifex/fallback delivery available'}</small>
        </article>
        <article className="automation-summary-card">
          <span>SMS automations</span>
          <strong>{draft.smsEnabled ? `${activeSmsRules} active` : 'Off'}</strong>
          <small>{readiness.sms.configured ? `${readiness.sms.senderId || 'Approved sender'} · ${readiness.sms.creditBalance.toLocaleString()} credits` : 'SMS sender needs configuration'}</small>
        </article>
        <article className="automation-summary-card">
          <span>Email route</span>
          <strong>{PREFERENCES.find(option => option.value === draft.deliveryPreference)?.title || 'Automatic'}</strong>
          <small>{draft.fallbackToSedifex ? 'Sedifex fallback on' : 'Sedifex fallback off'}</small>
        </article>
      </section>

      <section className="automation-channel-grid">
        <article className="automation-card automation-channel-card">
          <div className="automation-card-heading">
            <div><p className="automation-eyebrow">Channel</p><h2>Email</h2></div>
            <Toggle checked={draft.emailEnabled} onChange={checked => setDraft(current => current ? { ...current, emailEnabled: checked } : current)} label="Enable email automations" />
          </div>
          <p className="automation-muted">Email automations use your selected delivery route and keep the existing Sedifex notification safeguards.</p>
          <Link className="automation-link" to="/settings/integrations/email">Manage email integration</Link>
        </article>

        <article className="automation-card automation-channel-card">
          <div className="automation-card-heading">
            <div><p className="automation-eyebrow">Channel</p><h2>SMS</h2></div>
            <Toggle checked={draft.smsEnabled} onChange={checked => setDraft(current => current ? { ...current, smsEnabled: checked } : current)} label="Enable SMS automations" />
          </div>
          <p className="automation-muted">SMS uses your Sedifex credits and approved Hubtel sender. Delivery is tracked separately from provider acceptance.</p>
          <div className={`automation-status ${readiness.sms.configured ? 'ready' : 'warning'}`}>
            {readiness.sms.configured ? `${readiness.sms.senderId || 'SMS sender'} ready · ${readiness.sms.creditBalance.toLocaleString()} credits` : 'Configure an approved SMS sender before enabling live SMS automations.'}
          </div>
          <Link className="automation-link" to="/bulk-messaging">Manage SMS & credits</Link>
        </article>
      </section>

      <section className="automation-card">
        <div className="automation-section-heading">
          <div><p className="automation-eyebrow">Email delivery</p><h2>Choose how automated email is sent</h2></div>
        </div>
        <div className="automation-preference-grid">
          {PREFERENCES.map(option => {
            const unavailable = emailPreferenceUnavailable(option.value)
            return (
              <button
                type="button"
                key={option.value}
                className={`automation-preference ${draft.deliveryPreference === option.value ? 'selected' : ''}`}
                disabled={unavailable}
                onClick={() => setDraft(current => current ? { ...current, deliveryPreference: option.value } : current)}
              >
                <strong>{option.title}</strong>
                <span>{option.detail}</span>
                {unavailable && <small>Not configured</small>}
              </button>
            )
          })}
        </div>
        <label className="automation-fallback-row">
          <input type="checkbox" checked={draft.fallbackToSedifex} onChange={event => setDraft(current => current ? { ...current, fallbackToSedifex: event.target.checked } : current)} />
          <span><strong>Fallback to Sedifex Email</strong><small>If the selected business sender fails or is unavailable, allow Sedifex to try its transactional sender.</small></span>
        </label>
      </section>

      <section className="automation-card">
        <div className="automation-section-heading">
          <div><p className="automation-eyebrow">Rules</p><h2>Booking communication automations</h2></div>
          <p>Email and SMS can be controlled independently for each supported trigger.</p>
        </div>
        <div className="automation-rule-header"><span>Automation</span><span>Email</span><span>SMS</span></div>
        <div className="automation-rule-list">
          {RULES.map((rule, index) => {
            const previousGroup = index > 0 ? RULES[index - 1].group : null
            const groupStart = previousGroup !== rule.group
            const channel = draft.channels[rule.eventType] || { email: true, sms: false }
            return (
              <div key={rule.eventType}>
                {groupStart && <div className="automation-rule-group">{rule.group}</div>}
                <div className="automation-rule-row">
                  <div><strong>{rule.label}</strong><p>{rule.detail}</p></div>
                  <div className="automation-rule-control"><Toggle checked={channel.email} disabled={!draft.emailEnabled} onChange={checked => updateRule(rule.eventType, 'email', checked)} label={`${rule.label} email`} /></div>
                  <div className="automation-rule-control">
                    {rule.smsSupported ? (
                      <Toggle checked={channel.sms} disabled={!draft.smsEnabled || !readiness.sms.configured} onChange={checked => updateRule(rule.eventType, 'sms', checked)} label={`${rule.label} SMS`} />
                    ) : (
                      <span className="automation-email-only">Email only</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <div className="automation-sticky-save">
        <span>{changed ? 'You have unsaved automation changes.' : 'All automation settings are saved.'}</span>
        <button className="automation-primary" disabled={!changed || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </main>
  )
}
