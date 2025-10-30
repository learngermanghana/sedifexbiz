import React, { useEffect, useState } from 'react'
import { doc, getDoc, Timestamp, db, rosterDb } from '../lib/db'
import { useNavigate } from 'react-router-dom'
import { useAuthUser } from '../hooks/useAuthUser'

import { getOnboardingStatus, setOnboardingStatus, type OnboardingStatus } from '../utils/onboarding'
import './Onboarding.css'

type TeamMemberDocument = {
  uid?: string | null
  storeId?: string | null
  role?: string | null
  email?: string | null
  phone?: string | null
  createdAt?: Timestamp | null
  updatedAt?: Timestamp | null
}

type TeamMemberDetails = TeamMemberDocument & { id: string }

type StoreDocument = {
  ownerId?: string | null
  status?: string | null
  contractStatus?: string | null
  createdAt?: Timestamp | null
  updatedAt?: Timestamp | null
}

type StoreDetails = StoreDocument & { id: string }

function hasToDate(value: unknown): value is { toDate: () => Date } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  )
}

function formatTimestamp(value: unknown): string | null {
  if (!value) {
    return null
  }

  if (value instanceof Timestamp) {
    const date = value.toDate()
    return date.toLocaleString()
  }

  if (value instanceof Date) {
    return value.toLocaleString()
  }

  if (hasToDate(value)) {
    try {
      const date = value.toDate()
      return date.toLocaleString()
    } catch (error) {
      console.warn('[onboarding] Unable to format timestamp value', error)
    }
  }

  if (typeof value === 'string') {
    return value
  }

  return null
}

function formatLabel(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }
  const normalized = value.trim()
  if (!normalized) {
    return '—'
  }
  return normalized.replace(/\b\w/g, letter => letter.toUpperCase())
}

function formatRole(value: string | null | undefined): string {
  const label = formatLabel(value ?? 'Owner')
  return label
}

export default function Onboarding() {
  const user = useAuthUser()
  const navigate = useNavigate()
  const [status, setStatus] = useState<OnboardingStatus | null>(() => getOnboardingStatus(user?.uid ?? null))
  const [teamMemberDetails, setTeamMemberDetails] = useState<TeamMemberDetails | null>(null)
  const [storeDetails, setStoreDetails] = useState<StoreDetails | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)

  const ownerUid = teamMemberDetails?.uid ?? user?.uid ?? '—'
  const ownerEmail = teamMemberDetails?.email ?? user?.email ?? '—'
  const ownerRole = formatRole(teamMemberDetails?.role)
  const createdAtLabel = formatTimestamp(teamMemberDetails?.createdAt ?? null)
  const storeIdLabel = teamMemberDetails?.storeId ?? storeDetails?.id ?? user?.uid ?? '—'
  const storeStatusLabel = formatLabel(storeDetails?.status)
  const contractStatusLabel = formatLabel(storeDetails?.contractStatus)
  const updatedAtLabel = formatTimestamp(storeDetails?.updatedAt ?? null)

  useEffect(() => {
    setStatus(getOnboardingStatus(user?.uid ?? null))
  }, [user?.uid])

  useEffect(() => {
    if (!user?.uid) {
      setTeamMemberDetails(null)
      setStoreDetails(null)
      setDetailsError(null)
      setIsLoadingDetails(false)
      return
    }

    let isActive = true
    setIsLoadingDetails(true)
    setDetailsError(null)

    const fetchDetails = async () => {
      try {
        const [memberSnapshot, storeSnapshot] = await Promise.all([
          getDoc(doc(rosterDb, 'teamMembers', user.uid)),
          getDoc(doc(db, 'stores', user.uid)),
        ])

        if (!isActive) {
          return
        }

        if (memberSnapshot.exists()) {
          setTeamMemberDetails({
            id: memberSnapshot.id,
            ...(memberSnapshot.data() as TeamMemberDocument),
          })
        } else {
          setTeamMemberDetails(null)
        }

        if (storeSnapshot.exists()) {
          setStoreDetails({
            id: storeSnapshot.id,
            ...(storeSnapshot.data() as StoreDocument),
          })
        } else {
          setStoreDetails(null)
        }
      } catch (error) {
        if (!isActive) {
          return
        }
        console.warn('[onboarding] Failed to load workspace details', error)
        setTeamMemberDetails(null)
        setStoreDetails(null)
        setDetailsError('We couldn’t load your workspace details. Refresh to try again.')
      } finally {
        if (isActive) {
          setIsLoadingDetails(false)
        }
      }
    }

    void fetchDetails()

    return () => {
      isActive = false
    }
  }, [user?.uid])

  const hasCompleted = status === 'completed'

  function handleComplete() {
    if (!user) {
      return
    }

    setOnboardingStatus(user.uid, 'completed')
    setStatus('completed')
    navigate('/', { replace: true })
  }

  return (
    <div className="page onboarding-page" role="region" aria-labelledby="onboarding-title">
      <header className="page__header onboarding-page__header">
        <div>
          <h1 className="page__title" id="onboarding-title">
            Welcome to Sedifex
          </h1>
          <p className="page__subtitle">
            Let&apos;s get your workspace ready before you invite the rest of your team.
          </p>
        </div>
        {hasCompleted && (
          <span className="onboarding-page__status" role="status" aria-live="polite">
            Onboarding complete
          </span>
        )}
      </header>

      <section className="card onboarding-card" aria-labelledby="onboarding-step-1">
        <header className="onboarding-card__header">
          <span className="onboarding-card__step">Step 1</span>
          <h2 className="onboarding-card__title" id="onboarding-step-1">
            Confirm your owner account
          </h2>
        </header>
        <p>
          You&apos;re signed in as the workspace owner. We recommend keeping this login private and using it only for
          high-impact controls like payouts, data exports, and team access. Add a recovery email in case you ever
          need to reset your password.
        </p>
        <ul className="onboarding-card__list">
          <li>Keep your owner credentials secure.</li>
          <li>Turn on multi-factor authentication for extra protection.</li>
          <li>Plan which teammates need day-to-day access to Sedifex.</li>
        </ul>
        <div className="onboarding-card__details" aria-live="polite">
          <div className="onboarding-card__details-header">
            <h3 className="onboarding-card__details-title" id="onboarding-owner-details">
              Review your workspace details
            </h3>
            <p className="onboarding-card__details-subtitle">
              Confirm that your owner profile and store information look correct before inviting your team.
            </p>
          </div>
          {isLoadingDetails ? (
            <p className="onboarding-card__details-status">Loading your workspace data…</p>
          ) : detailsError ? (
            <p className="onboarding-card__details-status onboarding-card__details-status--error">{detailsError}</p>
          ) : (
            <div className="onboarding-card__details-columns" aria-describedby="onboarding-owner-details">
              <div className="onboarding-card__details-section">
                <p className="onboarding-card__details-section-title">Account</p>
                <dl className="onboarding-card__details-grid">
                  <div className="onboarding-card__details-row">
                    <dt className="onboarding-card__details-term">Owner UID</dt>
                    <dd className="onboarding-card__details-value">{ownerUid}</dd>
                  </div>
                  <div className="onboarding-card__details-row">
                    <dt className="onboarding-card__details-term">Email</dt>
                    <dd className="onboarding-card__details-value">{ownerEmail}</dd>
                  </div>
                  <div className="onboarding-card__details-row">
                    <dt className="onboarding-card__details-term">Role</dt>
                    <dd className="onboarding-card__details-value">{ownerRole}</dd>
                  </div>
                  {createdAtLabel ? (
                    <div className="onboarding-card__details-row">
                      <dt className="onboarding-card__details-term">Created</dt>
                      <dd className="onboarding-card__details-value">{createdAtLabel}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
              <div className="onboarding-card__details-section">
                <p className="onboarding-card__details-section-title">Store</p>
                <dl className="onboarding-card__details-grid">
                  <div className="onboarding-card__details-row">
                    <dt className="onboarding-card__details-term">Store ID</dt>
                    <dd className="onboarding-card__details-value">{storeIdLabel}</dd>
                  </div>
                  <div className="onboarding-card__details-row">
                    <dt className="onboarding-card__details-term">Status</dt>
                    <dd className="onboarding-card__details-value">{storeStatusLabel}</dd>
                  </div>
                  <div className="onboarding-card__details-row">
                    <dt className="onboarding-card__details-term">Contract</dt>
                    <dd className="onboarding-card__details-value">{contractStatusLabel}</dd>
                  </div>
                  {updatedAtLabel ? (
                    <div className="onboarding-card__details-row">
                      <dt className="onboarding-card__details-term">Last updated</dt>
                      <dd className="onboarding-card__details-value">{updatedAtLabel}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card onboarding-card" aria-labelledby="onboarding-step-2">
        <header className="onboarding-card__header">
          <span className="onboarding-card__step">Step 2</span>
          <h2 className="onboarding-card__title" id="onboarding-step-2">
            Invite your team and assign roles
          </h2>
        </header>
        <p>
          Use the team access workspace to create login credentials for every teammate who needs Sedifex. Assign
          each person a role so they only see the tools they need.
        </p>
        <ul className="onboarding-card__list">
          <li>Managers can run inventory and day-close workflows.</li>
          <li>Cashiers can sell, receive stock, and view customer history.</li>
          <li>Owners always retain full admin and billing access.</li>
        </ul>
        <p className="onboarding-card__cta">
          Need to update access later? Your Sedifex account manager can help tailor roles for your team.
        </p>
      </section>

      <section className="card onboarding-card" aria-labelledby="onboarding-step-3">
        <header className="onboarding-card__header">
          <span className="onboarding-card__step">Step 3</span>
          <h2 className="onboarding-card__title" id="onboarding-step-3">
            Finish setup
          </h2>
        </header>
        <p>
          Once you&apos;ve added your teammates, you&apos;re ready to jump into the dashboard. You can always revisit
          staff access later to make changes.
        </p>
        <button
          type="button"
          className="secondary-button onboarding-card__cta"
          onClick={handleComplete}
        >
          {hasCompleted ? 'Return to dashboard' : 'I’ve added my team'}
        </button>
      </section>
    </div>
  )
}
