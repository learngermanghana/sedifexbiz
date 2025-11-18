import React, { useEffect, useMemo, useState } from 'react'
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
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useMemberships, type Membership } from '../hooks/useMemberships'
import { manageStaffAccount } from '../controllers/storeController'
import { useToast } from '../components/ToastProvider'
import { useAuthUser } from '../hooks/useAuthUser'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type BillingCycle = 'monthly' | 'quarterly' | 'semiannual' | 'annual'

type PlanOption = {
  id: string
  label: string
}

const PLAN_OPTIONS: PlanOption[] = [
  { id: 'space', label: 'Standard' },
]

const BILLING_CYCLE_OPTIONS: { value: BillingCycle; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semiannual', label: 'Semiannual' },
  { value: 'annual', label: 'Annual' },
]

type CreateCheckoutPayload = {
  planId: string
  billingCycle: BillingCycle
  email: string
  storeId: string
  redirectUrl?: string
}

type CreateCheckoutResponse = {
  ok?: boolean
  authorizationUrl?: string | null
  reference?: string | null
}

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
  return typeof value === 'object' && value !== null && typeof (value as Timestamp).toDate === 'function'
}

function mapStoreSnapshot(
  snapshot: DocumentSnapshot<DocumentData> | QueryDocumentSnapshot<DocumentData> | null,
): StoreProfile | null {
  if (!snapshot) return null
  const data = snapshot.data()

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

function mapRosterSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): RosterMember {
  const data = snapshot.data()
  const role = data.role === 'owner' ? 'owner' : 'staff'
  const uid = typeof data.uid === 'string' && data.uid.trim() ? data.uid : snapshot.id
  const storeId = typeof data.storeId === 'string' && data.storeId.trim() ? data.storeId : null

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

function getPlanVariantId(planId: string, billingCycle: BillingCycle) {
  return `${planId}-${billingCycle}`
}

export default function AccountOverview() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const { memberships, loading: membershipsLoading, error: membershipsError } = useMemberships()
  const { publish } = useToast()
  const user = useAuthUser()

  const [profile, setProfile] = useState<StoreProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [roster, setRoster] = useState<RosterMember[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [rosterVersion, setRosterVersion] = useState(0)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Membership['role']>('staff')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [selectedPlanId, setSelectedPlanId] = useState(PLAN_OPTIONS[0]?.id ?? '')
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [startingCheckout, setStartingCheckout] = useState(false)

  const activeMembership = useMemo(() => {
    if (!storeId) return null
    return memberships.find(m => m.storeId === storeId) ?? null
  }, [memberships, storeId])

  const isOwner = activeMembership?.role === 'owner'

  const createCheckout = useMemo(
    () => httpsCallable<CreateCheckoutPayload, CreateCheckoutResponse>(functions, 'createCheckout'),
    [],
  )

  async function handleStartCheckout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (startingCheckout) return

    setCheckoutError(null)

    if (!storeId) {
      const message = 'Select a workspace before starting checkout.'
      setCheckoutError(message)
      publish({ message, tone: 'error' })
      return
    }

    const accountEmail = user?.email?.trim()
    if (!accountEmail) {
      const message = 'A valid account email is required to start checkout.'
      setCheckoutError(message)
      publish({ message, tone: 'error' })
      return
    }

    const planId = getPlanVariantId(selectedPlanId, billingCycle)
    const redirectUrl = `${window.location.origin}${window.location.pathname}#/account`

    setStartingCheckout(true)

    try {
      const payload: CreateCheckoutPayload = {
        planId,
        billingCycle,
        email: accountEmail,
        storeId,
        redirectUrl,
      }

      const { data } = await createCheckout(payload)
      const authorizationUrl = data?.authorizationUrl ?? null

      if (authorizationUrl) {
        window.location.assign(authorizationUrl)
        return
      }

      throw new Error('We could not start the Paystack checkout. Please try again.')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to start the Paystack checkout. Please try again.'
      setCheckoutError(message)
      publish({ message, tone: 'error' })
    } finally {
      setStartingCheckout(false)
    }
  }

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
  }, [storeId, rosterVersion, publish])

  function validateForm() {
    if (!storeId) {
      return 'A storeId is required to manage staff.'
    }

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      return 'Enter the teammate’s email address.'
    }

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      return 'Enter a valid email address.'
    }

    const normalizedRole = role?.trim()
    if (!normalizedRole) {
      return 'Select a role for this teammate.'
    }

    if (normalizedRole !== 'owner' && normalizedRole !== 'staff') {
      return 'Choose either owner or staff for the role.'
    }

    return null
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const error = validateForm()
    if (error) {
      setFormError(error)
      publish({ message: error, tone: 'error' })
      return
    }

    if (!storeId) return

    const payload = {
      storeId,
      email: email.trim().toLowerCase(),
      role,
      password: password.trim() || undefined,
    }

    setSubmitting(true)
    setFormError(null)
    try {
      await manageStaffAccount(payload)
      publish({ message: 'Team member updated.', tone: 'success' })
      setEmail('')
      setRole('staff')
      setPassword('')
      setRosterVersion(version => version + 1)
    } catch (error) {
      console.error('Failed to manage staff account', error)
      const message = error instanceof Error ? error.message : 'We could not submit the request.'
      setFormError(message)
      publish({ message, tone: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  if (storeError) {
    return <div role="alert">{storeError}</div>
  }

  if (!storeId && !storeLoading) {
    return (
      <div className="account-overview" role="status">
        <h1>Account overview</h1>
        <p>Select a workspace to view account details.</p>
      </div>
    )
  }

  const isBusy = storeLoading || membershipsLoading || profileLoading || rosterLoading

  return (
    <div className="account-overview">
      <h1>Account overview</h1>

      {(membershipsError || profileError || rosterError) && (
        <div className="account-overview__error" role="alert">
          {membershipsError && <p>We could not load your memberships.</p>}
          {profileError && <p>{profileError}</p>}
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
                {[profile.addressLine1, profile.addressLine2, profile.city, profile.region, profile.postalCode, profile.country]
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

      <section aria-labelledby="account-overview-contract">
        <h2 id="account-overview-contract">Contract &amp; billing</h2>
        <dl className="account-overview__grid">
          <div>
            <dt>Contract status</dt>
            <dd>{formatValue(profile?.status ?? null)}</dd>
          </div>
          <div>
            <dt>Billing plan</dt>
            <dd>{formatValue(profile?.billingPlan ?? null)}</dd>
          </div>
          <div>
            <dt>Payment provider</dt>
            <dd>{formatValue(profile?.paymentProvider ?? null)}</dd>
          </div>
        </dl>

        {isOwner ? (
          <form onSubmit={handleStartCheckout} className="account-overview__form">
            <fieldset disabled={startingCheckout || storeLoading || membershipsLoading}>
              <legend className="sr-only">Start Paystack checkout</legend>
              <div className="account-overview__form-grid">
                <label>
                  <span>Plan</span>
                  <select
                    value={selectedPlanId}
                    onChange={event => setSelectedPlanId(event.target.value)}
                    required
                  >
                    {PLAN_OPTIONS.map(plan => (
                      <option key={plan.id} value={plan.id}>
                        {plan.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Billing cycle</span>
                  <select
                    value={billingCycle}
                    onChange={event => setBillingCycle(event.target.value as BillingCycle)}
                    required
                  >
                    {BILLING_CYCLE_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <button type="submit" className="button button--primary">
                  {startingCheckout ? 'Redirecting…' : 'Pay with Paystack'}
                </button>
              </div>

              <p className="form__hint">We’ll send you to Paystack to confirm your subscription.</p>
              {checkoutError && <p className="account-overview__form-error">{checkoutError}</p>}
            </fieldset>
          </form>
        ) : (
          <p role="note">Only workspace owners can start billing checkout.</p>
        )}
      </section>

      <section aria-labelledby="account-overview-roster">
        <h2 id="account-overview-roster">Team roster</h2>

        {isOwner ? (
          <form onSubmit={handleSubmit} data-testid="account-invite-form" className="account-overview__form">
            <fieldset disabled={submitting}>
              <legend className="sr-only">Invite or update a teammate</legend>
              <div className="account-overview__form-grid">
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                  />
                </label>
                <label>
                  <span>Role</span>
                  <select value={role} onChange={event => setRole(event.target.value as Membership['role'])}>
                    <option value="owner">Owner</option>
                    <option value="staff">Staff</option>
                  </select>
                </label>
                <label>
                  <span>Password (optional)</span>
                  <input
                    type="password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <button type="submit" className="button button--primary">
                  {submitting ? 'Sending…' : 'Send invite'}
                </button>
              </div>
              {formError && <p className="account-overview__form-error">{formError}</p>}
            </fieldset>
          </form>
        ) : (
          <p role="note">You have read-only access to the team roster.</p>
        )}

        <div className="account-overview__roster" role="table" aria-label="Team roster">
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
                <span role="cell">{member.role === 'owner' ? 'Owner' : 'Staff'}</span>
                <span role="cell">{formatValue(member.invitedBy)}</span>
                <span role="cell">{formatTimestamp(member.updatedAt ?? member.createdAt)}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
