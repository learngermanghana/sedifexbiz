import React, { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import EventPlanning from './EventPlanning'

type EventLookup = {
  id: string
  eventCode: string
  title: string
}

export default function EventPlanningRoute() {
  const navigate = useNavigate()
  const { storeId } = useActiveStore()
  const [lookup, setLookup] = useState<EventLookup[]>([])

  useEffect(() => {
    let active = true

    async function loadLookup() {
      if (!storeId) {
        if (active) setLookup([])
        return
      }

      try {
        const snapshot = await getDocs(collection(db, 'stores', storeId, 'events'))
        if (!active) return
        setLookup(snapshot.docs.map(eventDoc => ({
          id: eventDoc.id,
          eventCode: typeof eventDoc.data().eventCode === 'string' ? eventDoc.data().eventCode.trim() : '',
          title: typeof eventDoc.data().title === 'string' ? eventDoc.data().title.trim() : '',
        })))
      } catch (error) {
        console.error('[event-planning-route] Unable to build event lookup', error)
      }
    }

    void loadLookup()
    return () => { active = false }
  }, [storeId])

  const idByCode = useMemo(() => new Map(lookup.filter(item => item.eventCode).map(item => [item.eventCode, item.id])), [lookup])
  const idsByTitle = useMemo(() => {
    const map = new Map<string, string[]>()
    lookup.forEach(item => {
      if (!item.title) return
      const key = item.title.toLowerCase()
      map.set(key, [...(map.get(key) ?? []), item.id])
    })
    return map
  }, [lookup])

  function openWorkspace(captureEvent: React.MouseEvent<HTMLDivElement>) {
    const target = captureEvent.target
    if (!(target instanceof Element)) return
    const eventButton = target.closest('button.event-planning__event-link')
    if (!eventButton) return

    const row = eventButton.closest('tr')
    const descriptor = row?.querySelector('td:first-child > span')?.textContent ?? ''
    const eventCode = descriptor.split('·').pop()?.trim() ?? ''
    const title = eventButton.textContent?.trim().toLowerCase() ?? ''
    const titleMatches = idsByTitle.get(title) ?? []
    const eventId = idByCode.get(eventCode) || (titleMatches.length === 1 ? titleMatches[0] : '')

    if (!eventId) return
    captureEvent.preventDefault()
    captureEvent.stopPropagation()
    navigate(`/event-planning/${eventId}`)
  }

  return (
    <div onClickCapture={openWorkspace}>
      <EventPlanning />
    </div>
  )
}
