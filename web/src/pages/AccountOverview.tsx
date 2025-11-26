import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useMemberships, type Membership } from '../hooks/useMemberships'
import { useToast } from '../components/ToastProvider'
import { useAuthUser } from '../hooks/useAuthUser'
import { AccountBillingSection } from '../components/AccountBillingSection'
import { getStoreIdFromRecord } from '../utils/storeId'

type StoreProfile = {
  name: string | null
  displayName: string | null
  email: string | null
  phone: string | null
  status: string | null
  timezone: string | null
  currency: string | null
  billingPlan: string | null
  paymentProvider: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

type SubscriptionProfile = {
  status: string | null
  plan: string | null
  provider: string | null
}

type RosterMember = {
  id: string
  uid: string
  storeId: string | null
  email: string | null
  role: Membership['role']
  invitedBy: string | null
  phone: string | null
  firstSignupEmail: string | null
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

function toNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function isTimestamp(value: unknown): value is Timestamp {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Timestamp).toDate === 'function'
  )
}

function mapStoreSnapshot(
  snapshot: DocumentSnapshot<DocumentData> | QueryDocumentSnapshot<DocumentData> | null,
): StoreProfile | null {
  if (!snapshot) return null
  const data = snapshot.data() || {}

  return {
    name: toNullableString(data.name),
    displayName: toNullableString(data.displayName),
    email: toNullableString(data.email),
    phone: toNullableString(data.phone),
    status: toNullableString(data.status),
    timezone: toNullableString(data.timezone),
    currency: toNullableString(data.currency),
    billingPlan: toNullableString(data.billingPlan),
    paymentProvider: toNullableString(data.paymentProvider),
    addressLine1: toNullableString(data.addressLine1),
    addressLine2: toNullableString(data.addressLine2),
    city: toNullableString(data.city),
    region: toNullableString(data.region),
    postalCode: toNullableString(data.postalCode),
    country: toNullableString(data.country),
    createdAt: isTimestamp(data.createdAt) ? data.createdAt : null,
    updatedAt: isTimestamp(data.updatedAt) ? data.updatedAt : null,
  }
}

function mapSubscriptionSnapshot(
  snapshot: DocumentSnapshot<DocumentData> | QueryDocumentSnapshot<DocumentData> | null,
): SubscriptionProfile | null {
  if (!snapshot) return null
  const data = snapshot.data() || {}

  return {
    status: toNullableString(data.status),
    plan: toNullableString(data.plan),
    provider: toNullableString(data.provider),
  }
}

function mapRosterSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): RosterMember {
  const data = snapshot.data() || {}
  const role: Membership['role'] = data.role === 'owner' ? 'owner' : 'staff'
  const uid =
    typeof data.uid === 'string' && data.uid.trim()
      ? data.uid
      : snapshot.id

  // Use helper so it also supports legacy workspace_uid / workspaceId fields
  const storeId = getStoreIdFromRecord(data)

  return {
    id: snapshot.id,
    uid,
    storeId,
    email: toNullableString(data.email),
    role,
    invitedBy: toNullableString(data.invitedBy),
    phone: toNullableString(data.phone),
    firstSignupEmail: toNullableString(data.firstSignupEmail),
    createdAt: isTimestamp(data.createdAt) ? data.createdAt : null,
    updatedAt: isTimestamp(data.updatedAt) ? data.updatedAt : null,
  }
}

function formatValue(value: string | null) {
  return value ?? '—'
}

function formatTimestamp(timestamp: Timestamp | null) {
  if (!timestamp) return '—'
  try {
    return timestamp.toDate().toLocaleString()
  } catch (error) {
    console.warn('Unable to render timestamp', error)
    return '—'
  }
}

type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4'

type AccountOverviewProps = {
  headingLevel?: HeadingLevel
}

export default function AccountOverview({ headingLevel = 'h1' }: AccountOverviewProps) {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const { memberships, loading: membershipsLoading, error: membershipsError } = useMemberships()
  const { publish } = useToast()
  const user = useAuthUser()

  const [profile, setProfile] = useState<StoreProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [subscriptionProfile, setSubscriptionProfile] = useState<SubscriptionProfile | null>(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)

  const [roster, setRoster] = useState<RosterMember[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)

  const activeMembership = useMemo(() => {
    if (!storeId) return null
    return memberships.find(m => m.storeId === storeId) ?? null
  }, [memberships, storeId])

  const isOwner = activeMembership?.role === 'owner'

  useEffect(() => {
    if (!storeId) {
      setProfile(null)
      setProfileError(null)
      return
    }

    let cancelled = false

    async function loadProfile() {
      setProfileLoading(true)
      setProfileError(null)

      try {
        const ref = doc(db, 'stores', storeId)
        const snapshot = await getDoc(ref)
        if (cancelled) return

        if (snapshot.exists()) {
          const mapped = mapStoreSnapshot(snapshot)
          setProfile(mapped)
          setProfileError(null)
          return
        }

        const storesRef = collection(db, 'stores')
        const fallbackQuery = query(storesRef, where('ownerId', '==', storeId))
        const fallbackSnapshot = await getDocs(fallbackQuery)
        if (cancelled) return

        const firstMatch = fallbackSnapshot.docs[0] ?? null
        if (firstMatch) {
          const mapped = mapStoreSnapshot(firstMatch)
          setProfile(mapped)
          setProfileError(null)
        } else {
          setProfile(null)
          setProfileError('We could not find this workspace profile.')
        }
      } catch (error) {
        if (cancelled) return
        console.error('Failed to load store profile', error)
        setProfile(null)
        setProfileError('We could not load the workspace profile.')
        publish({ message: 'Unable to load store details.', tone: 'error' })
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    }

    void loadProfile()

    return () => {
      cancelled = true
    }
  }, [storeId, publish])

  useEffect(() => {
    if (!storeId) {
      setSubscriptionProfile(null)
      setSubscriptionError(null)
      return
    }

    let cancelled = false

    async function loadSubscription() {
      setSubscriptionLoading(true)
      setSubscriptionError(null)

      try {
        const ref = doc(db, 'subscriptions', storeId)
        const snapshot = await getDoc(ref)
        if (cancelled) return

        if (!snapshot.exists()) {
          setSubscriptionProfile(null)
          return
        }

        const mapped = mapSubscriptionSnapshot(snapshot)
        setSubscriptionProfile(mapped)
      } catch (error) {
        if (cancelled) return
        console.error('Failed to load subscription', error)
        setSubscriptionProfile(null)
        setSubscriptionError('We could not load the billing information.')
        publish({ message: 'Unable to load billing information.', tone: 'error' })
      } finally {
        if (!cancelled) setSubscriptionLoading(false)
      }
    }

    void loadSubscription()

    return () => {
      cancelled = true
    }
  }, [storeId, publish])

  useEffect(() => {
    if (!storeId) {
      setRoster([])
      setRosterError(null)
      return
    }

    let cancelled = false

    setRosterLoading(true)
    setRosterError(null)

    const membersRef = collection(db, 'teamMembers')
    const rosterQuery = query(membersRef, where('storeId', '==', storeId))
    getDocs(rosterQuery)
      .then(snapshot => {
        if (cancelled) return
        const members = snapshot.docs.map(mapRosterSnapshot)
        setRoster(members)
        setRosterError(null)
      })
      .catch(error => {
        if (cancelled) return
        console.error('Failed to load roster', error)
        setRoster([])
        setRosterError('We could not load the team roster.')
        publish({ message: 'Unable to load team members.', tone: 'error' })
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [storeId, publish])

  if (storeError) {
    return <div role="alert">{storeError}</div>
  }

  const Heading = headingLevel as keyof JSX.IntrinsicElements

  if (!storeId && !storeLoading) {
    return (
      <div className="account-overview" role="status">
        <Heading>Account overview</Heading>
        <p>Select a workspace to view account details.</p>
      </div>
    )
  }

  const isBusy =
    storeLoading ||
    membershipsLoading ||
    profileLoading ||
    subscriptionLoading ||
    rosterLoading

  return (
    <div className="account-overview">
      <Heading>Account overview</Heading>

      {(membershipsError || profileError || subscriptionError || rosterError) && (
        <div className="account-overview__error" role="alert">
          {membershipsError && <p>We could not load your memberships.</p>}
          {profileError && <p>{profileError}</p>}
          {subscriptionError && <p>{subscriptionError}</p>}
          {rosterError && <p>{rosterError}</p>}
        </div>
      )}

      {isBusy && (
        <p role="status" aria-live="polite">
          Loading account details…
        </p>
      )}

      {profile && (
        <section aria-labelledby="account-overview-profile">
          <h2 id="account-overview-profile">Store profile</h2>
          <dl className="account-overview__grid">
            <div>
              <dt>Workspace name</dt>
              <dd>{formatValue(profile.displayName ?? profile.name)}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{formatValue(profile.email)}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{formatValue(profile.phone)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{formatValue(profile.status)}</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{formatValue(profile.timezone)}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{formatValue(profile.currency)}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>
                {[
                  profile.addressLine1,
                  profile.addressLine2,
                  profile.city,
                  profile.region,
                  profile.postalCode,
                  profile.country,
                ]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatTimestamp(profile.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatTimestamp(profile.updatedAt)}</dd>
            </div>
          </dl>
        </section>
      )}

      <AccountBillingSection
        storeId={storeId ?? null}
        ownerEmail={user?.email ?? null}
        isOwner={isOwner}
        contractStatus={subscriptionProfile?.status ?? profile?.status ?? null}
        billingPlan={subscriptionProfile?.plan ?? profile?.billingPlan ?? null}
        paymentProvider={subscriptionProfile?.provider ?? profile?.paymentProvider ?? null}
      />

      <section aria-labelledby="account-overview-roster">
        <h2 id="account-overview-roster">Team roster</h2>

        {isOwner ? (
          !rosterLoading && roster.length > 0 ? (
            <div className="account-overview__actions">
              <p className="account-overview__subtitle">
                Team members are saved in Firebase. Edit existing teammates directly.
              </p>
              <Link
                to="/staff"
                className="button button--secondary"
                data-testid="account-edit-team"
              >
                Edit team members
              </Link>
            </div>
          ) : (
            <p role="note">Team members will appear here once they are available.</p>
          )
        ) : (
          <p role="note">You have read-only access to the team roster.</p>
        )}

        <div
          className="account-overview__roster"
          role="table"
          aria-label="Team roster"
        >
          <div className="account-overview__roster-header" role="row">
            <span role="columnheader">Email</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">Invited by</span>
            <span role="columnheader">Updated</span>
          </div>
          {roster.length === 0 && !rosterLoading ? (
            <div role="row" className="account-overview__roster-empty">
              <span role="cell" colSpan={4}>
                No team members found.
              </span>
            </div>
          ) : (
            roster.map(member => (
              <div
                role="row"
                key={member.id}
                data-testid={`account-roster-${member.id}`}
                data-uid={member.uid}
                data-store-id={member.storeId ?? undefined}
                data-phone={member.phone ?? undefined}
                data-first-signup-email={member.firstSignupEmail ?? undefined}
              >
                <span role="cell">{formatValue(member.email)}</span>
                <span role="cell">
                  {member.role === 'owner' ? 'Owner' : 'Staff'}
                </span>
                <span role="cell">{formatValue(member.invitedBy)}</span>
                <span role="cell">
                  {formatTimestamp(member.updatedAt ?? member.createdAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
