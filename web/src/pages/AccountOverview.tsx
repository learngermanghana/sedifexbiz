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
  serverTimestamp,
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

 
