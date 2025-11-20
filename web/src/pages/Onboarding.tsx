// web/src/pages/Onboarding.tsx
import React, { useEffect, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  Timestamp,
  where
} from 'firebase/firestore'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { useAuthUser } from '../hooks/useAuthUser'
import { db } from '../firebase'
import { getStoreIdFromRecord } from '../utils/storeId'
import {
  getOnboardingStatus,
  setOnboardingStatus,
  type OnboardingStatus
} from '../utils/onboarding'
import { useActiveStore } from '../hooks/useActiveStore'

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
  billing?: {
    planId?: string | null
    provider?: string | null
    status?: string | null
    contractStatus?: string | null
  }
}

type StoreDetails = StoreDocument & { id: string }

function formatTimestamp(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Timestamp) return value.toDate().toLocaleString()
  if (value instanceof Date) return value.toLocaleString()
  if (typeof value === 'string') return value
  return null
}

function formatLabel(value: string | null | undefined): string {
  const normalized = (value ?? '').trim()
  if (!normalized) return '—'
  return normalized.replace(/\b\w/g, l => l.toUpperCase())
}

function formatRole(value: string | null | undefined): string {
  return formatLabel(value ?? 'Owner')
}

function normalizeStoreIdCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

async function loadStoreDetails(
  userUid: string,
  membershipDoc: QueryDocumentSnapshot<DocumentData> | null
): Promise<StoreDetails | null> {
  const membershipData = membershipDoc?.data() as TeamMemberDocument | undefined
  const storeIdFromRecord = membershipData ? getStoreIdFromRecord(membershipData as any) : null

  const candidates = Array.from(
    new Set(
      [storeIdFromRecord, membershipDoc?.id, userUid]
        .map(normalizeStoreIdCandidate)
        .filter((v): v is string => Boolean(v))
    )
  )

  for (const candidateId of candidates) {
    const snapshot = await getDoc(doc(db, 'stores', candidateId))
    if (snapshot.exists()) {
      return {
        id: snapshot.id,
        ...(snapshot.data() as StoreDocument)
      }
    }
  }

  return null
}

export default function Onboarding() {
  const user = useAuthUser()
  const navigate = useNavigate()
  const [status, setStatus] = useState<OnboardingStatus>(() =>
    getOnboardingStatus(user?.uid ?? null) ?? 'pending'
  )
  const [teamMemberDetails, setTeamMemberDetails] = useState<TeamMemberDetails | null>(null)
  const [storeDetails, setStoreDetails] = useState<StoreDetails | null>(null)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)

  const ownerUid = teamMemberDetails?.uid ?? user?.uid ?? '—'
  const ownerEmail = teamMemberDetails?.email ?? user?.email ?? '—'
  const ownerRole = formatRole(teamMemberDetails?.role)
  const createdAtLabel = formatTimestamp(teamMemberDetails?.createdAt ?? null)
  const storeIdLabel =
    teamMemberDetails?.storeId ?? storeDetails?.id ?? user?.uid ?? '—'
  const storeStatusLabel = formatLabel(storeDetails?.status)
  const contractStatusLabel =
    formatLabel(storeDetails?.contractStatus ?? storeDetails?.billing?.contractStatus ?? null)
  const updatedAtLabel = formatTimestamp(storeDetails?.updatedAt ?? null)

  useEffect(() => {
    const storedStatus = getOnboardingStatus(user?.uid ?? null)
    if (!storedStatus) {
      if (user?.uid) {
        setOnboardingStatus(user.uid, 'pending')
      }
      setStatus('pending')
      return
    }
    setStatus(storedStatus)
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
        const teamMembersRef = collection(db, 'teamMembers')
        const membershipQuery = query(
          teamMembersRef,
          where('uid', '==', user.uid),
          limit(1)
        )
        const membershipSnapshot = await getDocs(membershipQuery)
        const membershipDoc = membershipSnapshot.docs[0] ?? null

        if (!isActive) return

        if (membershipDoc) {
          setTeamMemberDetails({
            id: membershipDoc.id,
            ...(membershipDoc.data() as TeamMemberDocument)
          })
        } else {
          setTeamMemberDetails(null)
        }

        const storeDetails = await loadStoreDetails(user.uid, membershipDoc)
        if (!isActive) return

        setStoreDetails(storeDetails)
      } catch (error) {
        if (!isActive) return
        console.warn('[onboarding] Failed to load workspace details', error)
        setTeamMemberDetails(null)
        setStoreDetails(null)
        setDetailsError('We couldn’t load your workspace details. Refresh to try again.')
      } finally {
        if (isActive) setIsLoadingDetails(false)
      }
    }

    void fetchDetails()
    return () => {
      isActive = false
    }
  }, [user?.uid])

  const hasCompleted = status === 'completed'

  function handleComplete() {
    if (!user) return
    setOnboardingStatus(user.uid, 'completed')
    setStatus('completed')
    navigate('/account', { replace: true })
  }

  return (
    <div className="page onboarding-page">
      <header className="page__header onboarding-page__header">
        <div>
          <h1 className="page__title">Welcome to Sedifex</h1>
          <p className="page__subtitle">
            Let&apos;s get your workspace ready before you invite the rest of your team.
          </p>
        </div>
        {hasCompleted && <span>Onboarding complete</span>}
      </header>

      <section className="card onboarding-card">
        <header className="onboarding-card__header">
          <span className="onboarding-card__step">Step 1</span>
          <h2 className="onboarding-card__title">Confirm your owner account</h2>
        </header>
        <p>
          You&apos;re signed in as the workspace owner. Keep this login private and use it
          only for high-impact controls like payouts, data exports, and team access.
        </p>

        <div className="onboarding-card__details" aria-live="polite">
          <div className="onboarding-card__details-header">
            <h3>Review your workspace details</h3>
            <p>
              Confirm that your owner profile and store information look correct before
              inviting your team.
            </p>
          </div>
          {isLoadingDetails ? (
            <p>Loading your workspace data…</p>
          ) : detailsError ? (
            <p className="onboarding-card__details-status onboarding-card__details-status--error">
              {detailsError}
            </p>
          ) : (
            <div className="onboarding-card__details-columns">
              <div>
                <p>Account</p>
                <dl>
                  <div>
                    <dt>Owner UID</dt>
                    <dd>{ownerUid}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{ownerEmail}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{ownerRole}</dd>
                  </div>
                  {createdAtLabel && (
                    <div>
                      <dt>Created</dt>
                      <dd>{createdAtLabel}</dd>
                    </div>
                  )}
                </dl>
              </div>
              <div>
                <p>Store</p>
                <dl>
                  <div>
                    <dt>Store ID</dt>
                    <dd>{storeIdLabel}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{storeStatusLabel}</dd>
                  </div>
                  <div>
                    <dt>Contract</dt>
                    <dd>{contractStatusLabel}</dd>
                  </div>
                  {updatedAtLabel && (
                    <div>
                      <dt>Last updated</dt>
                      <dd>{updatedAtLabel}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card onboarding-card">
        <header className="onboarding-card__header">
          <span className="onboarding-card__step">Step 2</span>
          <h2 className="onboarding-card__title">Invite your team and assign roles</h2>
        </header>
        <p>
          Use the team access workspace to create logins for every teammate who needs
          Sedifex. Assign each person a role so they only see the tools they need.
        </p>
      </section>

      <section className="card onboarding-card">
        <header className="onboarding-card__header">
          <span className="onboarding-card__step">Step 3</span>
          <h2 className="onboarding-card__title">Finish setup</h2>
        </header>
        <p>Once you&apos;ve added your teammates, you&apos;re ready for the dashboard.</p>
        <button type="button" onClick={handleComplete}>
          {hasCompleted ? 'Return to account overview' : 'I’ve added my team'}
        </button>
      </section>
    </div>
  )
}
