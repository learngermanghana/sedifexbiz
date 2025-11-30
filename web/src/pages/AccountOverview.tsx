// web/src/pages/AccountOverview.tsx
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
  setDoc,
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
  contractStatus: string | null
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
  // 🔹 Public directory fields
  isPublicDirectory: boolean
  publicDescription: string | null
}

type SubscriptionProfile = {
  status: string | null
  plan: string | null
  provider: string | null
  currentPeriodStart: Timestamp | null
  currentPeriodEnd: Timestamp | null
  lastPaymentAt: Timestamp | null
  receiptUrl: string | null
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
  snapshot:
    | DocumentSnapshot<DocumentData>
    | QueryDocumentSnapshot<DocumentData>
    | null,
): StoreProfile | null {
  if (!snapshot) return null
  const data = snapshot.data() || {}
  const billingRaw = (data.billing ?? {}) as Record<string, unknown>

  const billingStatus = toNullableString(billingRaw.status)
  const paymentStatus = toNullableString(
    (data as { paymentStatus?: unknown }).paymentStatus,
  )

  let billingPlan =
    toNullableString((data as { billingPlan?: unknown }).billingPlan) ??
    toNullableString((data as { planKey?: unknown }).planKey) ??
    toNullableString(billingRaw.planKey)

  if (billingStatus === 'trial' || paymentStatus === 'trial') {
    billingPlan = 'trial'
  }

  const paymentProvider =
    toNullableString((data as { paymentProvider?: unknown }).paymentProvider) ??
    toNullableString(billingRaw.provider) ??
    'Paystack'

  const contractStatus =
    toNullableString((data as { contractStatus?: unknown }).contractStatus) ??
    billingStatus ??
    toNullableString(data.status)

  return {
    name: toNullableString(data.name),
    displayName: toNullableString(data.displayName),
    email: toNullableString(data.email),
    phone: toNullableString(data.phone),
    status: toNullableString(data.status),
    contractStatus,
    billingPlan,
    paymentProvider,
    addressLine1: toNullableString(data.addressLine1),
    addressLine2: toNullableString(data.addressLine2),
    city: toNullableString(data.city),
    region: toNullableString(data.region),
    postalCode: toNullableString(data.postalCode),
    country: toNullableString(data.country),
    createdAt: isTimestamp(data.createdAt) ? data.createdAt : null,
    updatedAt: isTimestamp(data.updatedAt) ? data.updatedAt : null,
    isPublicDirectory: Boolean((data as any).isPublicDirectory),
    publicDescription: toNullableString((data as any).publicDescription),
  }
}

function mapSubscriptionSnapshot(
  snapshot:
    | DocumentSnapshot<DocumentData>
    | QueryDocumentSnapshot<DocumentData>
    | null,
): SubscriptionProfile | null {
  if (!snapshot) return null
  const data = snapshot.data() || {}

  return {
    status: toNullableString(data.status),
    plan: toNullableString(data.plan),
    provider: toNullableString(data.provider) ?? 'Paystack',
    currentPeriodStart: isTimestamp(data.currentPeriodStart)
      ? data.currentPeriodStart
      : null,
    currentPeriodEnd: isTimestamp(data.currentPeriodEnd)
      ? data.currentPeriodEnd
      : null,
    lastPaymentAt: isTimestamp(data.lastPaymentAt)
      ? data.lastPaymentAt
      : null,
    receiptUrl: toNullableString(data.receiptUrl),
  }
}

function mapRosterSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): RosterMember {
  const data = snapshot.data() || {}
  const role: Membership['role'] = data.role === 'owner' ? 'owner' : 'staff'
  const uid =
    typeof data.uid === 'string' && data.uid.trim() ? data.uid : snapshot.id

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
    return timestamp
      .toDate()
      .toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
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
  const {
    memberships,
    loading: membershipsLoading,
    error: membershipsError,
  } = useMemberships()
  const { publish } = useToast()
  const user = useAuthUser()

  const [profile, setProfile] = useState<StoreProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [subscriptionProfile, setSubscriptionProfile] =
    useState<SubscriptionProfile | null>(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)

  const [roster, setRoster] = useState<RosterMember[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)

  // Public directory edit state
  const [isSavingPublicProfile, setIsSavingPublicProfile] = useState(false)
  const [publicDescriptionDraft, setPublicDescriptionDraft] = useState('')
  const [isPublicDirectoryDraft, setIsPublicDirectoryDraft] = useState(false)

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

  // Sync public profile drafts with loaded profile
  useEffect(() => {
    if (!profile) return
    setPublicDescriptionDraft(profile.publicDescription ?? '')
    setIsPublicDirectoryDraft(profile.isPublicDirectory ?? false)
  }, [profile])

  const Heading = headingLevel as keyof JSX.IntrinsicElements

  if (storeError) {
    return <div role="alert">{storeError}</div>
  }

  if (storeLoading) {
    return (
      <div className="account-overview">
        <Heading>Account overview</Heading>
        <p role="status" aria-live="polite">
          Loading workspace…
        </p>
      </div>
    )
  }

  if (!storeId) {
    return (
      <div className="account-overview" role="status">
        <Heading>Account overview</Heading>
        <p>Select a workspace to view account details.</p>
      </div>
    )
  }

  const isBusy =
    membershipsLoading ||
    profileLoading ||
    subscriptionLoading ||
    rosterLoading

  const contractStatus =
    subscriptionProfile?.status ??
    profile?.contractStatus ??
    profile?.status ??
    null

  const billingPlan =
    subscriptionProfile?.plan ?? profile?.billingPlan ?? null

  const isTrial = contractStatus === 'trial' || billingPlan === 'trial'

  const lastPaymentDisplay = formatTimestamp(
    subscriptionProfile?.lastPaymentAt ??
      subscriptionProfile?.currentPeriodStart ??
      null,
  )

  const expiryDisplay = formatTimestamp(
    subscriptionProfile?.currentPeriodEnd ?? null,
  )

  async function handleSavePublicProfile() {
    if (!storeId) return
    if (!isOwner) {
      publish({
        message: 'Only the workspace owner can update public details.',
        tone: 'error',
      })
      return
    }

    try {
      setIsSavingPublicProfile(true)
      const ref = doc(db, 'stores', storeId)

      await setDoc(
        ref,
        {
          isPublicDirectory: isPublicDirectoryDraft,
          publicDescription: publicDescriptionDraft.trim() || null,
          displayName: profile?.displayName ?? profile?.name ?? null,
          addressLine1: profile?.addressLine1 ?? null,
          city: profile?.city ?? null,
          country: profile?.country ?? null,
          phone: profile?.phone ?? null,
          email: profile?.email ?? null,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      )

      publish({ message: 'Public profile updated.', tone: 'success' })
    } catch (error) {
      console.error('[account] Failed to save public profile', error)
      publish({
        message: 'Unable to save public profile. Please try again.',
        tone: 'error',
      })
    } finally {
      setIsSavingPublicProfile(false)
    }
  }

  return (
    <div className="account-overview">
      <Heading>Account overview</Heading>

      {profile && (
        <p className="account-overview__subtitle">
          Workspace{' '}
          <strong>{profile.displayName ?? profile.name ?? '—'}</strong>
          {activeMembership && (
            <>
              {' · '}Your role{' '}
              <strong>{isOwner ? 'Owner' : 'Staff'}</strong>
            </>
          )}
        </p>
      )}

      {isTrial && (
        <div
          className="account-overview__banner account-overview__banner--trial"
          role="status"
          aria-live="polite"
        >
          <p>
            You’re currently on a <strong>trial</strong> plan.
            {isOwner
              ? ' Set up billing to avoid interruptions.'
              : ' Ask the workspace owner to set up billing to avoid interruptions.'}
          </p>
        </div>
      )}

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
        <section
          aria-labelledby="account-overview-profile"
          id="store-profile"
        >
          <div className="account-overview__section-header">
            <h2 id="account-overview-profile">Store profile</h2>

            {isOwner && (
              <div className="account-overview__actions account-overview__actions--profile">
                <button
                  type="button"
                  className="button button--secondary"
                  data-testid="account-edit-store"
                  onClick={() => {
                    const el = document.getElementById('store-profile')
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                  }}
                >
                  Edit workspace details
                </button>
              </div>
            )}
          </div>

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

      {/* Public directory profile section */}
      {profile && (
        <section aria-labelledby="account-overview-public">
          <div className="account-overview__section-header">
            <h2 id="account-overview-public">Public directory profile</h2>
            <p className="account-overview__subtitle">
              Control what customers see on <strong>stores.sedifex.com</strong>.
            </p>
          </div>

          {isOwner ? (
            <div className="account-overview__grid">
              <div>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={isPublicDirectoryDraft}
                    onChange={e => setIsPublicDirectoryDraft(e.target.checked)}
                  />
                  <span>Show this store in the public Sedifex directory</span>
                </label>
                <p style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                  When enabled, your store will appear on stores.sedifex.com with your
                  name, city, country, address and contact details.
                </p>

                {isPublicDirectoryDraft && (
                  <p style={{ fontSize: 12, color: '#374151', marginTop: 8 }}>
                    Preview your listing:{' '}
                    <a
                      href={`https://stores.sedifex.com/store/${encodeURIComponent(
                        storeId,
                      )}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open public store page
                    </a>
                  </p>
                )}
              </div>

              <div>
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <span>What your store does (short description)</span>
                  <textarea
                    rows={3}
                    value={publicDescriptionDraft}
                    onChange={e => setPublicDescriptionDraft(e.target.value)}
                    placeholder="E.g. We sell fresh fish, feed and equipment for aquaculture farms in Accra."
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                </label>
              </div>

              <div>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={handleSavePublicProfile}
                  disabled={isSavingPublicProfile}
                >
                  {isSavingPublicProfile ? 'Saving…' : 'Save public profile'}
                </button>
              </div>
            </div>
          ) : (
            <p role="note">
              Only the workspace owner can change the public directory settings.
            </p>
          )}
        </section>
      )}

      {/* Billing summary */}
      <AccountBillingSection
        storeId={storeId}
        ownerEmail={user?.email ?? null}
        isOwner={isOwner}
        contractStatus={contractStatus}
        billingPlan={billingPlan}
        paymentProvider={
          subscriptionProfile?.provider ??
          profile?.paymentProvider ??
          'Paystack'
        }
        contractEndDate={expiryDisplay}
      />

      {/* Billing history */}
      {subscriptionProfile && (
        <section aria-labelledby="account-overview-billing-history">
          <div className="account-overview__section-header">
            <h2 id="account-overview-billing-history">Billing history</h2>
          </div>

          <dl className="account-overview__grid">
            <div>
              <dt>Last payment</dt>
              <dd>{lastPaymentDisplay}</dd>
            </div>
            <div>
              <dt>Current period ends</dt>
              <dd>{expiryDisplay}</dd>
            </div>
            <div>
              <dt>Receipt</dt>
              <dd>
                {subscriptionProfile.receiptUrl ? (
                  <a
                    href={subscriptionProfile.receiptUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="button button--ghost"
                  >
                    Download receipt
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <section aria-labelledby="account-overview-roster">
        <h2 id="account-overview-roster">Team roster</h2>

        {isOwner ? (
          !rosterLoading && roster.length > 0 ? (
            <div className="account-overview__actions">
              <p className="account-overview__subtitle">
                Team members are saved in Firebase. Edit existing teammates
                directly.
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
            <p role="note">
              Team members will appear here once they are available.
            </p>
          )
        ) : (
          <p role="note">You have read-only access to the team roster.</p>
        )}

        <table
          className="account-overview__roster"
          aria-label="Team roster"
        >
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Invited by</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {roster.length === 0 && !rosterLoading ? (
              <tr className="account-overview__roster-empty">
                <td colSpan={4}>No team members found.</td>
              </tr>
            ) : (
              roster.map(member => (
                <tr
                  key={member.id}
                  data-testid={`account-roster-${member.id}`}
                  data-uid={member.uid}
                  data-store-id={member.storeId ?? undefined}
                  data-phone={member.phone ?? undefined}
                  data-first-signup-email={member.firstSignupEmail ?? undefined}
                >
                  <td>{formatValue(member.email)}</td>
                  <td>{member.role === 'owner' ? 'Owner' : 'Staff'}</td>
                  <td>{formatValue(member.invitedBy)}</td>
                  <td>{formatTimestamp(member.updatedAt ?? member.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
