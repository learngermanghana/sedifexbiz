import React, { useMemo, useState } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { useLocation } from 'react-router-dom'
import { db } from '../firebase'
import { useAuthUser } from '../hooks/useAuthUser'
import { useActiveStore } from '../hooks/useActiveStore'
import { useToast } from './ToastProvider'
import './SupportTicketLauncher.css'

export default function SupportTicketLauncher() {
  const user = useAuthUser()
  const location = useLocation()
  const { storeId } = useActiveStore()
  const { publish } = useToast()

  const [isOpen, setIsOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const screen = useMemo(() => {
    const path = location.pathname || '/'
    const hash = location.hash || ''
    return `${path}${hash}`
  }, [location.hash, location.pathname])

  const canSubmit = Boolean(message.trim()) && !!user && !isSubmitting

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return

    setSubmitError(null)
    setIsSubmitting(true)

    try {
      await addDoc(collection(db, 'supportTickets'), {
        uid: user.uid,
        storeId: storeId ?? null,
        screen,
        message: message.trim(),
        createdAt: serverTimestamp(),
        status: 'open',
      })

      setMessage('')
      setIsOpen(false)
      publish('Thanks! Your request was sent to support.', 'success')
    } catch (error) {
      console.error('[support] Unable to submit ticket', error)
      setSubmitError('We could not send your request. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="support-launcher">
      <button
        type="button"
        className="button button--outline button--small support-launcher__toggle"
        onClick={() => setIsOpen(true)}
      >
        Need help?
      </button>

      {isOpen ? (
        <div className="support-launcher__backdrop" role="presentation">
          <div
            className="support-launcher__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-title"
          >
            <header className="support-launcher__header">
              <div>
                <p className="support-launcher__eyebrow">Support</p>
                <h2 id="support-title">Tell us what you need help with</h2>
                <p className="support-launcher__context">We’ll route this to the Sedifex team.</p>
              </div>
              <button
                type="button"
                className="button button--ghost button--small"
                onClick={() => setIsOpen(false)}
              >
                Close
              </button>
            </header>

            <form className="support-launcher__form" onSubmit={handleSubmit}>
              <label className="field">
                <span className="field__label">Message</span>
                <textarea
                  required
                  rows={5}
                  value={message}
                  onChange={event => setMessage(event.target.value)}
                  placeholder="Describe what you were doing and what you need help with."
                />
                <span className="support-launcher__hint">Screen: {screen}</span>
              </label>

              {submitError ? <p className="support-launcher__error">{submitError}</p> : null}

              <div className="support-launcher__actions">
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => setIsOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button button--primary button--small"
                  disabled={!canSubmit}
                >
                  {isSubmitting ? 'Sending…' : 'Send to support'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
