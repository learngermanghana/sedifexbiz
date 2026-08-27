import React, { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { matchPath, useLocation } from 'react-router-dom'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import EventGiftRegister from './EventGiftRegister'
import EventProductionTimeline from './EventProductionTimeline'

type ToolTab = 'production' | 'gifts'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export default function EventProductionToolsDock() {
  const location = useLocation()
  const { storeId, isLoading } = useActiveStore()
  const routeMatch = matchPath({ path: '/event-planning/:eventId', end: true }, location.pathname)
  const eventId = routeMatch?.params.eventId || ''
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<ToolTab>('production')
  const [eventTitle, setEventTitle] = useState('Event')

  useEffect(() => {
    setOpen(false)
    setTab('production')
  }, [eventId])

  useEffect(() => {
    let active = true
    async function loadTitle() {
      if (!storeId || !eventId) return
      try {
        const snapshot = await getDoc(doc(db, 'stores', storeId, 'events', eventId))
        if (active && snapshot.exists()) setEventTitle(text(snapshot.data().title) || text(snapshot.data().eventType) || 'Event')
      } catch (error) {
        console.error('[event-production-tools] Unable to load event title', error)
      }
    }
    void loadTitle()
    return () => { active = false }
  }, [eventId, storeId])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!eventId || !storeId || isLoading) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        aria-controls="event-production-tools-panel"
        style={{
          position: 'fixed',
          right: 24,
          bottom: 88,
          zIndex: 2450,
          border: 0,
          borderRadius: 999,
          padding: '11px 16px',
          background: '#17211d',
          color: '#fff',
          fontWeight: 800,
          boxShadow: '0 14px 34px rgba(15,23,42,.2)',
          cursor: 'pointer',
        }}
      >
        Production tools
      </button>

      {open ? (
        <section
          id="event-production-tools-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="event-production-tools-title"
          style={{
            position: 'fixed',
            inset: '72px 18px 18px auto',
            width: 'min(920px, calc(100vw - 36px))',
            zIndex: 2800,
            borderRadius: 20,
            border: '1px solid #dfe8e2',
            background: '#f7faf8',
            boxShadow: '0 28px 90px rgba(15,23,42,.24)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <header style={{ padding: '16px 18px', background: '#fff', borderBottom: '1px solid #dfe8e2', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div><p style={{ margin: 0, fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.08em', color: '#64748b', fontWeight: 800 }}>Event operations</p><h2 id="event-production-tools-title" style={{ margin: '3px 0 0', fontSize: '1.2rem' }}>{eventTitle} · Production tools</h2></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close production tools" style={{ border: 0, background: 'transparent', fontSize: 28, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </header>

          <nav aria-label="Production tool sections" style={{ padding: '10px 18px', background: '#fff', borderBottom: '1px solid #dfe8e2', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className={tab === 'production' ? 'button button--primary' : 'button button--ghost'} onClick={() => setTab('production')}>Production timeline</button>
            <button type="button" className={tab === 'gifts' ? 'button button--primary' : 'button button--ghost'} onClick={() => setTab('gifts')}>Guest gifts</button>
          </nav>

          <div style={{ padding: 18, overflow: 'auto', flex: 1 }}>
            {tab === 'production'
              ? <EventProductionTimeline storeId={storeId} eventId={eventId} eventTitle={eventTitle} />
              : <EventGiftRegister storeId={storeId} eventId={eventId} eventTitle={eventTitle} />}
          </div>
        </section>
      ) : null}
    </>
  )
}
