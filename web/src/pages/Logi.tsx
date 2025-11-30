import React, { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, type DocumentData } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './Logi.css'

const LOGI_PARTNER_IMAGE_URL =
  'https://raw.githubusercontent.com/learngermanghana/sedifexbiz/main/photos/pexels-omotayo-tajudeen-1650120-3213283%281%29.jpg'

type PublicStoreProfile = {
  id: string | null
  name: string | null
  displayName: string | null
  city: string | null
  region: string | null
  country: string | null
  publicDescription: string | null
}

function toNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function mapPublicProfile(id: string, data?: DocumentData | undefined): PublicStoreProfile {
  return {
    id,
    name: toNullableString(data?.name),
    displayName: toNullableString(data?.displayName),
    city: toNullableString(data?.city),
    region: toNullableString(data?.region),
    country: toNullableString(data?.country),
    publicDescription: toNullableString((data as any)?.publicDescription),
  }
}

function buildLocationLabel(profile: PublicStoreProfile | null) {
  if (!profile) return '—'
  const parts = [profile.city, profile.region, profile.country].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : '—'
}

export default function Logi() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const [profile, setProfile] = useState<PublicStoreProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!storeId) return

    setIsLoading(true)
    const ref = doc(db, 'stores', storeId)
    const unsubscribe = onSnapshot(
      ref,
      snapshot => {
        setProfile(mapPublicProfile(snapshot.id, snapshot.data()))
        setIsLoading(false)
        setError(null)
      },
      err => {
        console.error('[logi] Failed to load store profile', err)
        setError('We could not load your store details right now.')
        setIsLoading(false)
      },
    )

    return () => unsubscribe()
  }, [storeId])

  const storeLabel = useMemo(() => {
    return profile?.displayName ?? profile?.name ?? profile?.id ?? '—'
  }, [profile])

  const locationLabel = useMemo(() => buildLocationLabel(profile), [profile])

  const aboutText =
    profile?.publicDescription ??
    'Share a short introduction so partners know what your store does and where you operate.'

  const showLoading = isLoading || storeLoading

  return (
    <main className="page logi">
      <section className="logi__hero">
        <div className="logi__hero-copy">
          <p className="logi__eyebrow">Store partners</p>
          <h1 className="logi__title">Share what matters, keep the rest private</h1>
          <p className="logi__subtitle">
            We pull non-sensitive details from your store profile so partners can see where you operate
            without exposing internal contact or billing data. Updates happen automatically after
            sign-up or whenever your store profile changes.
          </p>
        </div>
        <div className="logi__hero-figure">
          <img
            src={LOGI_PARTNER_IMAGE_URL}
            alt="Market team arranging inventory"
            className="logi__image"
            loading="lazy"
          />
        </div>
      </section>

      <section className="logi__panel" aria-live="polite">
        <header className="logi__panel-header">
          <div>
            <p className="logi__eyebrow">Live from Firestore</p>
            <h2 className="logi__panel-title">Public store snapshot</h2>
          </div>
          <p className="logi__status">{showLoading ? 'Updating…' : 'Ready to share'}</p>
        </header>

        {storeError && <p className="logi__error">{storeError}</p>}
        {error && !storeError && <p className="logi__error">{error}</p>}

        {!storeId && !storeLoading && (
          <p className="logi__placeholder">Join or create a workspace to surface partner-ready data.</p>
        )}

        {storeId && (
          <dl className="logi__grid">
            <div className="logi__field">
              <dt>Store name</dt>
              <dd>{storeLabel}</dd>
            </div>
            <div className="logi__field">
              <dt>Location</dt>
              <dd>{locationLabel}</dd>
            </div>
            <div className="logi__field logi__field--full">
              <dt>Partner overview</dt>
              <dd>{aboutText}</dd>
            </div>
          </dl>
        )}
      </section>
    </main>
  )
}
