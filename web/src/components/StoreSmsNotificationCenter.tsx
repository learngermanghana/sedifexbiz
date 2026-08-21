import React, { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useToast } from './ToastProvider'
import './StoreSmsNotificationCenter.css'

type StoreSmsNotification = {
  id: string
  title: string
  message: string
  bookingId: string | null
  severity: 'success' | 'error' | 'warning' | 'info'
  unread: boolean
  createdAt: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function millis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { toMillis?: () => number; toDate?: () => Date }
  if (typeof candidate.toMillis === 'function') return candidate.toMillis()
  if (typeof candidate.toDate === 'function') return candidate.toDate().getTime()
  return null
}

function relativeTime(value: unknown) {
  const timestamp = millis(value)
  if (!timestamp) return ''
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const hours = Math.floor(diffMinutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function StoreSmsNotificationCenter() {
  const { storeId } = useActiveStore()
  const { publish } = useToast()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<StoreSmsNotification[]>([])
  const [open, setOpen] = useState(false)
  const initializedRef = useRef(false)
  const toastIdsRef = useRef(new Set<string>())
  const mountedAtRef = useRef(Date.now())

  useEffect(() => {
    initializedRef.current = false
    toastIdsRef.current.clear()
    mountedAtRef.current = Date.now()
    setNotifications([])
    if (!storeId) return

    const notificationsQuery = query(
      collection(db, 'stores', storeId, 'storeNotifications'),
      orderBy('createdAt', 'desc'),
      limit(30),
    )

    return onSnapshot(
      notificationsQuery,
      snapshot => {
        const rows = snapshot.docs
          .map(notificationDoc => {
            const data = notificationDoc.data() as Record<string, unknown>
            if (text(data.category) !== 'booking_sms') return null
            const severityRaw = text(data.severity)
            const severity: StoreSmsNotification['severity'] =
              severityRaw === 'error' || severityRaw === 'warning' || severityRaw === 'success'
                ? severityRaw
                : 'info'
            return {
              id: notificationDoc.id,
              title: text(data.title) || 'Client SMS update',
              message: text(data.message) || 'Sedifex updated a client SMS notification.',
              bookingId: text(data.bookingId) || null,
              severity,
              unread: data.unread !== false,
              createdAt: data.createdAt,
            }
          })
          .filter((row): row is StoreSmsNotification => Boolean(row))

        setNotifications(rows)

        for (const change of snapshot.docChanges()) {
          if (change.type !== 'added') continue
          const data = change.doc.data() as Record<string, unknown>
          if (text(data.category) !== 'booking_sms' || data.unread === false) continue
          const createdAt = millis(data.createdAt)
          const isLive = initializedRef.current || Boolean(createdAt && createdAt >= mountedAtRef.current - 3000)
          if (!isLive || toastIdsRef.current.has(change.doc.id)) continue
          toastIdsRef.current.add(change.doc.id)
          const severity = text(data.severity)
          publish({
            tone: severity === 'error' ? 'error' : severity === 'success' ? 'success' : 'info',
            message: text(data.message) || text(data.title) || 'Client SMS update',
            duration: severity === 'error' ? 9000 : 6500,
          })
        }
        initializedRef.current = true
      },
      error => {
        console.warn('[store-sms-notifications] Unable to load notifications', error)
      },
    )
  }, [publish, storeId])

  const unreadCount = useMemo(
    () => notifications.filter(notification => notification.unread).length,
    [notifications],
  )

  async function markRead(notification: StoreSmsNotification) {
    if (!storeId || !notification.unread) return
    await updateDoc(doc(db, 'stores', storeId, 'storeNotifications', notification.id), {
      unread: false,
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(error => console.warn('[store-sms-notifications] Unable to mark notification read', error))
  }

  async function markAllRead() {
    if (!storeId) return
    const unread = notifications.filter(notification => notification.unread)
    if (!unread.length) return
    const batch = writeBatch(db)
    unread.forEach(notification => {
      batch.update(doc(db, 'stores', storeId, 'storeNotifications', notification.id), {
        unread: false,
        readAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    })
    await batch.commit().catch(error => console.warn('[store-sms-notifications] Unable to mark notifications read', error))
  }

  async function openNotification(notification: StoreSmsNotification) {
    await markRead(notification)
    setOpen(false)
    if (notification.bookingId) navigate(`/bookings/${notification.bookingId}`)
  }

  if (!storeId) return null

  return (
    <div className="store-sms-notifications">
      <button
        type="button"
        className="store-sms-notifications__bell"
        aria-label={unreadCount ? `${unreadCount} unread client SMS notifications` : 'Client SMS notifications'}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && <span className="store-sms-notifications__badge">{Math.min(unreadCount, 99)}</span>}
      </button>

      {open && (
        <section className="store-sms-notifications__panel" aria-label="Client SMS notifications">
          <header className="store-sms-notifications__header">
            <div>
              <strong>Client SMS activity</strong>
              <span>{unreadCount ? `${unreadCount} unread` : 'All caught up'}</span>
            </div>
            {unreadCount > 0 && (
              <button type="button" onClick={() => void markAllRead()}>
                Mark all read
              </button>
            )}
          </header>

          <div className="store-sms-notifications__list">
            {notifications.length === 0 ? (
              <p className="store-sms-notifications__empty">No client SMS activity yet.</p>
            ) : notifications.map(notification => (
              <button
                type="button"
                key={notification.id}
                className={`store-sms-notifications__item store-sms-notifications__item--${notification.severity}${notification.unread ? ' is-unread' : ''}`}
                onClick={() => void openNotification(notification)}
              >
                <span className="store-sms-notifications__status" aria-hidden="true" />
                <span className="store-sms-notifications__copy">
                  <strong>{notification.title}</strong>
                  <span>{notification.message}</span>
                  <small>{relativeTime(notification.createdAt)}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
