// web/src/pages/StoresDirectory.tsx
import React, { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'

type PublicStore = {
  id: string
  name: string
  businessType?: string
  description?: string
  city?: string
  region?: string
  country?: string
  addressLine?: string
  phone?: string
  whatsapp?: string
  website?: string
  mapUrl?: string
}

export default function StoresDirectory() {
  const [stores, setStores] = useState<PublicStore[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Assumption:
    // Each store doc has `isPublicDirectory: true` if they want to appear here.
    // Adjust field names if your schema is slightly different.
    const q = query(
      collection(db, 'stores'),
      where('isPublicDirectory', '==', true),
      orderBy('name', 'asc'),
    )

    const unsubscribe = onSnapshot(
      q,
      snap => {
        const rows: PublicStore[] = snap.docs.map(docSnap => {
          const data = docSnap.data() as any
          return {
            id: docSnap.id,
            name: String(data.name || 'Unnamed store'),
            businessType: data.businessType || data.category || '',
            description: data.description || '',
            city: data.city || data.town || '',
            region: data.region || '',
            country: data.country || 'Ghana',
            addressLine: data.addressLine || data.address || '',
            phone: data.phone || '',
            whatsapp: data.whatsapp || '',
            website: data.website || '',
            mapUrl: data.mapUrl || '',
          }
        })
        setStores(rows)
        setIsLoading(false)
        setError(null)
      },
      err => {
        console.error('[stores-directory] Failed to load stores', err)
        setError('Unable to load stores directory right now. Please try again later.')
        setIsLoading(false)
      },
    )

    return unsubscribe
  }, [])

  const hasStores = stores.length > 0

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Sedifex Stores</h2>
          <p className="page__subtitle">
            Discover businesses powered by Sedifex. Contact them directly to buy, order,
            or work together.
          </p>
        </div>
      </header>

      <section className="card" aria-label="Stores directory">
        {isLoading && <p>Loading stores…</p>}
        {error && !isLoading && (
          <p className="status status--error" role="alert">
            {error}
          </p>
        )}

        {!isLoading && !error && !hasStores && (
          <div className="empty-state">
            <h4 className="empty-state__title">No public stores yet</h4>
            <p>
              Once businesses turn on public profiles in Sedifex, they will appear in
              this directory.
            </p>
          </div>
        )}

        {!isLoading && !error && hasStores && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 16,
              marginTop: 8,
            }}
          >
            {stores.map(store => {
              const locationParts = [
                store.city,
                store.region,
                store.country,
              ].filter(Boolean)
              const locationLabel = locationParts.join(', ')

              const hasAnyContact =
                !!store.phone || !!store.whatsapp || !!store.website || !!store.mapUrl

              const phoneHref =
                store.phone && `tel:${store.phone.replace(/[^0-9+]/g, '')}`

              const whatsappHref =
                store.whatsapp &&
                `https://wa.me/${store.whatsapp.replace(/[^0-9]/g, '')}`

              return (
                <article
                  key={store.id}
                  className="info-card"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    borderRadius: 16,
                    border: '1px solid #E2E8F0',
                    padding: '16px 18px',
                    background: '#FFFFFF',
                    boxShadow: '0 4px 12px rgba(15, 23, 42, 0.04)',
                  }}
                >
                  <div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 18,
                        fontWeight: 700,
                        color: '#0F172A',
                      }}
                    >
                      {store.name}
                    </h3>
                    {store.businessType && (
                      <p
                        style={{
                          margin: '2px 0 0',
                          fontSize: 13,
                          fontWeight: 500,
                          color: '#4B5563',
                        }}
                      >
                        {store.businessType}
                      </p>
                    )}
                    {locationLabel && (
                      <p
                        style={{
                          margin: '4px 0 0',
                          fontSize: 13,
                          color: '#6B7280',
                        }}
                      >
                        {locationLabel}
                      </p>
                    )}
                  </div>

                  {store.description && (
                    <p
                      style={{
                        margin: '8px 0 0',
                        fontSize: 13,
                        color: '#4B5563',
                      }}
                    >
                      {store.description}
                    </p>
                  )}

                  {store.addressLine && (
                    <p
                      style={{
                        margin: '4px 0 0',
                        fontSize: 12,
                        color: '#6B7280',
                      }}
                    >
                      {store.addressLine}
                    </p>
                  )}

                  {hasAnyContact && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginTop: 10,
                      }}
                    >
                      {phoneHref && (
                        <a
                          href={phoneHref}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 999,
                            border: '1px solid #E5E7EB',
                            fontSize: 12,
                            textDecoration: 'none',
                            color: '#111827',
                            background: '#F9FAFB',
                          }}
                        >
                          Call
                        </a>
                      )}
                      {whatsappHref && (
                        <a
                          href={whatsappHref}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            padding: '6px 10px',
                            borderRadius: 999,
                            border: '1px solid #22C55E',
                            fontSize: 12,
                            textDecoration: 'none',
                            color: '#065F46',
                            background: '#DCFCE7',
                          }}
                        >
                          WhatsApp
                        </a>
                      )}
                      {store.website && (
                        <a
                          href={store.website}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            padding: '6px 10px',
                            borderRadius: 999,
                            border: '1px solid #E5E7EB',
                            fontSize: 12,
                            textDecoration: 'none',
                            color: '#1D4ED8',
                            background: '#EFF6FF',
                          }}
                        >
                          Website
                        </a>
                      )}
                      {store.mapUrl && (
                        <a
                          href={store.mapUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            padding: '6px 10px',
                            borderRadius: 999,
                            border: '1px solid #E5E7EB',
                            fontSize: 12,
                            textDecoration: 'none',
                            color: '#0369A1',
                            background: '#ECFEFF',
                          }}
                        >
                          View on map
                        </a>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: 24 }}>
        <h3 className="card__title">Are you a Sedifex store?</h3>
        <p className="card__subtitle">
          Turn on your public profile in the Sedifex app so customers can find you here.
        </p>
        <p style={{ marginTop: 8, fontSize: 13 }}>
          Log in to your main Sedifex dashboard and edit your store settings. Once your
          profile is public, it will appear in this directory automatically.
        </p>
        <Link to="/account" style={{ fontSize: 13, fontWeight: 600, color: '#4338CA' }}>
          Go to account settings →
        </Link>
      </section>
    </div>
  )
}
