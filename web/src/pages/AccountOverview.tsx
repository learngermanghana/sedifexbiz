// web/src/pages/AccountOverview.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  serverTimestamp,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { deleteUser } from 'firebase/auth'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useMemberships, type Membership } from '../hooks/useMemberships'
import { useToast } from '../components/ToastProvider'
import { useAuthUser } from '../hooks/useAuthUser'
import { AccountBillingSection } from '../components/AccountBillingSection'
import { deleteWorkspaceData } from '../controllers/dataDeletion'
import { getStoreIdFromRecord } from '../utils/storeId'
import './AccountOverview.css'

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
  // 🔹 Billing/trial fields
  trialEndsAt: Timestamp | null
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
  status: string | null
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

  // 🔹 Trial end from billing (supports trialEndsAt/trialEnd)
  const trialEndsRaw =
    (billingRaw.trialEndsAt as unknown) ?? (billingRaw.trialEnd as unknown)
  const trialEndsAt = isTimestamp(trialEndsRaw) ? trialEndsRaw : null

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
    trialEndsAt,
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
    status: toNullableString(data.status),
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

function formatStatus(status: string | null) {
  if (!status || status === 'active') return 'Active'
  if (status === 'pending') return 'Pending approval'
  if (status === 'inactive') return 'Inactive'
  return status
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
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false)
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)

  const [profileDraft, setProfileDraft] = useState({
    displayName: '',
    email: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    region: '',
    postalCode: '',
    country: '',
  })
  const [isSavingProfile, setIsSavingProfile] = useState(false)

  // Public directory edit state
  const [isSavingPublicProfile, setIsSavingPublicProfile] = useState(false)
  const [publicDescriptionDraft, setPublicDescriptionDraft] = useState('')
  const [isPublicDirectoryDraft, setIsPublicDirectoryDraft] = useState(false)

  const activeMembership = useMemo(() => {
    if (!storeId) return null
    return memberships.find(m => m.storeId === storeId) ?? null
  }, [memberships, storeId])

  const isOwner = activeMembership?.role === 'owner'
  const pendingMembers = useMemo(
    () => roster.filter(member => member.status === 'pending'),
    [roster],
  )

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

  useEffect(() => {
    if (!profile) return

    setProfileDraft({
      displayName: profile.displayName ?? profile.name ?? '',
      email: profile.email ?? '',
      phone: profile.phone ?? '',
      addressLine1: profile.addressLine1 ?? '',
      addressLine2: profile.addressLine2 ?? '',
      city: profile.city ?? '',
      region: profile.region ?? '',
      postalCode: profile.postalCode ?? '',
      country: profile.country ?? '',
    })
  }, [profile])

  function updateProfileDraft(
    key: keyof typeof profileDraft,
    value: string,
  ): void {
    setProfileDraft(current => ({ ...current, [key]: value }))
  }

  function normalizeInput(value: string) {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }

  async function handleSaveProfile(event?: React.FormEvent) {
    event?.preventDefault()
    if (!storeId) return

    if (!isOwner) {
      publish({
        message: 'Only the workspace owner can update details.',
        tone: 'error',
      })
      return
    }

    try {
      setIsSavingProfile(true)
      const updatedAt = Timestamp.now()
      const ref = doc(db, 'stores', storeId)

      const payload = {
        displayName: normalizeInput(profileDraft.displayName),
        name: normalizeInput(profileDraft.displayName),
        email: normalizeInput(profileDraft.email),
        phone: normalizeInput(profileDraft.phone),
        addressLine1: normalizeInput(profileDraft.addressLine1),
        addressLine2: normalizeInput(profileDraft.addressLine2),
        city: normalizeInput(profileDraft.city),
        region: normalizeInput(profileDraft.region),
        postalCode: normalizeInput(profileDraft.postalCode),
        country: normalizeInput(profileDraft.country),
        updatedAt,
      }

      await setDoc(ref, payload, { merge: true })

      setProfile(current =>
        current
          ? {
              ...current,
              displayName: payload.displayName,
              name:
                payload.name ??
                current.displayName ??
                current.name ??
                null,
              email: payload.email,
              phone: payload.phone,
              addressLine1: payload.addressLine1,
              addressLine2: payload.addressLine2,
              city: payload.city,
              region: payload.region,
              postalCode: payload.postalCode,
              country: payload.country,
              updatedAt,
            }
          : current,
      )

      publish({ message: 'Workspace details updated.', tone: 'success' })
    } catch (error) {
      console.error('[account] Failed to save workspace profile', error)
      publish({
        message: 'Unable to save workspace details. Please try again.',
        tone: 'error',
      })
    } finally {
      setIsSavingProfile(false)
    }
  }

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

  // 🔹 Trial end (from store billing)
  const trialEndDisplay = formatTimestamp(profile?.trialEndsAt ?? null)

  // 🔹 Period start (from subscription)
  const periodStartDisplay = formatTimestamp(
    subscriptionProfile?.currentPeriodStart ?? null,
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

  async function handleDeleteWorkspaceData() {
    if (!storeId) return

    if (!isOwner) {
      publish({
        message: 'Only the workspace owner can delete workspace data.',
        tone: 'error',
      })
      return
    }

    const confirmed = window.confirm(
      'This will permanently delete all workspace data, including products, sales, customers, expenses, team members and activity. This action cannot be undone. Continue?',
    )

    if (!confirmed) return

    try {
      setIsDeletingWorkspace(true)
      await deleteWorkspaceData(storeId)
      publish({
        message: 'All workspace data deleted.',
        tone: 'success',
      })
    } catch (error) {
      console.error('[account] Failed to delete workspace data', error)
      publish({
        message: 'Unable to delete workspace data. Please try again.',
        tone: 'error',
      })
    } finally {
      setIsDeletingWorkspace(false)
    }
  }

  async function handleDeleteAccount() {
    if (!user) {
      publish({
        message: 'You need to be signed in to delete your account.',
        tone: 'error',
      })
      return
    }

    const confirmed = window.confirm(
      'This will permanently delete your Sedifex account and remove you from all workspaces. This action cannot be undone. Continue?',
    )

    if (!confirmed) return

    try {
      setIsDeletingAccount(true)

      const membershipQuery = query(
        collection(db, 'teamMembers'),
        where('uid', '==', user.uid),
      )
      const membershipSnapshot = await getDocs(membershipQuery)

      await Promise.all(
        membershipSnapshot.docs.map(snapshot =>
          deleteDoc(doc(db, 'teamMembers', snapshot.id)),
        ),
      )

      await deleteUser(user)

      publish({
        message: 'Your account has been deleted.',
        tone: 'success',
      })
    } catch (error) {
      console.error('[account] Failed to delete account', error)

      const errorCode = (error as { code?: unknown })?.code
      const message =
        errorCode === 'auth/requires-recent-login'
          ? 'Please sign in again to delete your account.'
          : 'Unable to delete your account. Please try again.'

      publish({ message, tone: 'error' })
    } finally {
      setIsDeletingAccount(false)
    }
  }

  async function handleApprovePending(member: RosterMember) {
    if (!storeId || !isOwner) return

    setPendingActionId(member.id)
    try {
      await setDoc(
        doc(db, 'teamMembers', member.id),
        { status: 'active', updatedAt: serverTimestamp() },
        { merge: true },
      )
      setRoster(current =>
        current.map(entry =>
          entry.id === member.id
            ? { ...entry, status: 'active', updatedAt: Timestamp.now() }
            : entry,
        ),
      )
      publish({
        message: `Approved ${member.email ?? 'staff member'}.`,
        tone: 'success',
      })
    } catch (error) {
      console.warn('[account] Failed to approve pending staff', error)
      publish({
        message: 'Unable to approve this staff member. Please try again.',
        tone: 'error',
      })
    } finally {
      setPendingActionId(null)
    }
  }

  async function handleRejectPending(member: RosterMember) {
    if (!storeId || !isOwner) return

    setPendingActionId(member.id)
    try {
      await setDoc(
        doc(db, 'teamMembers', member.id),
        { status: 'inactive', updatedAt: serverTimestamp() },
        { merge: true },
      )
      setRoster(current =>
        current.map(entry =>
          entry.id === member.id
            ? { ...entry, status: 'inactive', updatedAt: Timestamp.now() }
            : entry,
        ),
      )
      publish({
        message: `Removed ${member.email ?? 'staff member'} from your workspace.`,
        tone: 'success',
      })
    } catch (error) {
      console.warn('[account] Failed to reject pending staff', error)
      publish({
        message: 'Unable to remove this staff member. Please try again.',
        tone: 'error',
      })
    } finally {
      setPendingActionId(null)
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
            {profile?.trialEndsAt && (
              <>
                {' '}Your trial ends on{' '}
                <strong>{trialEndDisplay}</strong>.
              </>
            )}
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

          {isOwner && (
            <form
              className="account-overview__profile-form"
              onSubmit={handleSaveProfile}
              data-testid="account-profile-form"
            >
              <div className="account-overview__form-grid">
                <label>
                  <span>Workspace name</span>
                  <input
                    type="text"
                    value={profileDraft.displayName}
                    onChange={event =>
                      updateProfileDraft('displayName', event.target.value)
                    }
                    placeholder="e.g. Sedifex Coffee"
                    data-testid="account-profile-name"
                  />
                </label>

                <label>
                  <span>Contact email</span>
                  <input
                    type="email"
                    value={profileDraft.email}
                    onChange={event =>
                      updateProfileDraft('email', event.target.value)
                    }
                    placeholder="you@example.com"
                    data-testid="account-profile-email"
                  />
                </label>

                <label>
                  <span>Phone number</span>
                  <input
                    type="tel"
                    value={profileDraft.phone}
                    onChange={event =>
                      updateProfileDraft('phone', event.target.value)
                    }
                    placeholder="+233 20 123 4567"
                    data-testid="account-profile-phone"
                  />
                </label>

                <label>
                  <span>Address line 1</span>
                  <input
                    type="text"
                    value={profileDraft.addressLine1}
                    onChange={event =>
                      updateProfileDraft('addressLine1', event.target.value)
                    }
                    placeholder="Street and house number"
                    data-testid="account-profile-address1"
                  />
                </label>

                <label>
                  <span>Address line 2</span>
                  <input
                    type="text"
                    value={profileDraft.addressLine2}
                    onChange={event =>
                      updateProfileDraft('addressLine2', event.target.value)
                    }
                    placeholder="Apartment, suite, etc."
                    data-testid="account-profile-address2"
                  />
                </label>

                <label>
                  <span>City</span>
                  <input
                    type="text"
                    value={profileDraft.city}
                    onChange={event =>
                      updateProfileDraft('city', event.target.value)
                    }
                    placeholder="Nairobi"
                    data-testid="account-profile-city"
                  />
                </label>

                <label>
                  <span>Region / State</span>
                  <input
                    type="text"
                    value={profileDraft.region}
                    onChange={event =>
                      updateProfileDraft('region', event.target.value)
                    }
                    placeholder="Nairobi County"
                    data-testid="account-profile-region"
                  />
                </label>

                <label>
                  <span>Postal code</span>
                  <input
                    type="text"
                    value={profileDraft.postalCode}
                    onChange={event =>
                      updateProfileDraft('postalCode', event.target.value)
                    }
                    placeholder="00100"
                    data-testid="account-profile-postal"
                  />
                </label>

                <label>
                  <span>Country</span>
                  <input
                    type="text"
                    value={profileDraft.country}
                    onChange={event =>
                      updateProfileDraft('country', event.target.value)
                    }
                    placeholder="Kenya or Ghana"
                    data-testid="account-profile-country"
                  />
                </label>
              </div>

              <div className="account-overview__actions">
                <p className="account-overview__hint">
                  Update your workspace name and contact details for invoices and
                  public listings.
                </p>
                <button
                  type="submit"
                  className="button button--primary"
                  disabled={isSavingProfile}
                >
                  {isSavingProfile ? 'Saving…' : 'Save workspace details'}
                </button>
              </div>
            </form>
          )}
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
                      href={`https://stores.sedifex.com/${encodeURIComponent(
                        storeId,
                      )}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Visit stores.sedifex.com with your store ID
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
                    placeholder="E.g. We sell fresh fish, feed and equipment for aquaculture farms across Lagos."
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
              <dt>Current period starts</dt>
              <dd>{periodStartDisplay}</dd>
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

      <section aria-labelledby="account-overview-deletion">
        <div className="account-overview__section-header">
          <h2 id="account-overview-deletion">Data controls</h2>
          <p className="account-overview__subtitle">
            Delete your workspace data instantly when you no longer want to keep
            it.
          </p>
        </div>

        <div className="account-overview__data-grid">
          <article className="account-overview__card">
            <h3>Delete workspace data</h3>
            <p className="account-overview__hint">
              Remove products, customers, sales, expenses, team members, the
              activity log, and your workspace profile from Firebase. This
              action cannot be undone.
            </p>
            <div className="account-overview__danger-actions">
              <button
                type="button"
                className="button button--danger"
                onClick={handleDeleteWorkspaceData}
                disabled={!isOwner || isDeletingWorkspace}
                data-testid="account-delete-data"
              >
                {isDeletingWorkspace
                  ? 'Deleting workspace data…'
                  : 'Delete all workspace data'}
              </button>
              {!isOwner && (
                <p className="account-overview__hint" role="note">
                  Only the workspace owner can delete data.
                </p>
              )}
            </div>
          </article>

          <article className="account-overview__card">
            <h3>Delete your account</h3>
            <p className="account-overview__hint">
              Remove your Sedifex account and leave all workspaces. You may need
              to sign in again before deleting. This action cannot be undone.
            </p>
            <div className="account-overview__danger-actions">
              <button
                type="button"
                className="button button--danger"
                onClick={handleDeleteAccount}
                disabled={!user || isDeletingAccount}
                data-testid="account-delete-account"
              >
                {isDeletingAccount ? 'Deleting account…' : 'Delete my account'}
              </button>
              {!user && (
                <p className="account-overview__hint" role="note">
                  Sign in to delete your account.
                </p>
              )}
            </div>
          </article>

          <article className="account-overview__card">
            <h3>Open Firebase console</h3>
            <p className="account-overview__hint">
              Authentication, billing records, and roster data are stored in
              Firebase. Review or export what you need directly from the
              console.
            </p>
            <a
              className="button button--ghost"
              href="https://console.firebase.google.com/"
              target="_blank"
              rel="noreferrer noopener"
            >
              Go to Firebase
            </a>
          </article>
        </div>
      </section>

      <section aria-labelledby="account-overview-roster">
        <h2 id="account-overview-roster">Team roster</h2>

        {isOwner && pendingMembers.length > 0 && (
          <div
            className="account-overview__alert"
            role="alert"
            aria-live="polite"
            data-testid="account-pending-approvals"
          >
            <p className="account-overview__eyebrow">Action needed</p>
            <p className="account-overview__subtitle">
              These people signed up with your Store ID. Approve to grant access or
              reject to block it.
            </p>
            <div className="account-overview__approvals">
              {pendingMembers.map(member => (
                <article
                  key={member.id}
                  className="account-overview__approval-card"
                  data-testid={`account-roster-pending-${member.id}`}
                >
                  <div className="account-overview__approval-meta">
                    <p className="account-overview__approval-email">
                      {formatValue(member.email ?? member.firstSignupEmail)}
                    </p>
                    <p className="account-overview__hint">
                      Pending approval · Requested access as staff
                    </p>
                  </div>
                  <div className="account-overview__approval-actions">
                    <button
                      type="button"
                      className="button button--primary button--small"
                      onClick={() => handleApprovePending(member)}
                      disabled={pendingActionId === member.id}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => handleRejectPending(member)}
                      disabled={pendingActionId === member.id}
                    >
                      Reject
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

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
              <th scope="col">Status</th>
              <th scope="col">Invited by</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {roster.length === 0 && !rosterLoading ? (
              <tr className="account-overview__roster-empty">
                <td colSpan={5}>No team members found.</td>
              </tr>
            ) : (
              roster.map(member => (
                <tr
                  key={member.id}
                  data-testid={`account-roster-${member.id}`}
                  data-uid={member.uid}
                  data-store-id={member.storeId ?? undefined}
                  data-phone={member.phone ?? undefined}
                  data-status={member.status ?? undefined}
                  data-first-signup-email={member.firstSignupEmail ?? undefined}
                >
                  <td>{formatValue(member.email)}</td>
                  <td>{member.role === 'owner' ? 'Owner' : 'Staff'}</td>
                  <td>
                    <span
                      className="account-overview__status"
                      data-variant={member.status ?? 'active'}
                    >
                      {formatStatus(member.status)}
                    </span>
                  </td>
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
