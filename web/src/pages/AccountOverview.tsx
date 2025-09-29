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
import { auth, db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useMemberships, type Membership } from '../hooks/useMemberships'
import { manageStaffAccount } from '../controllers/storeController'
import { useToast } from '../components/ToastProvider'
import { fetchSheetRows, findUserRow } from '../sheetClient'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  email: string | null
  role: Membership['role']
  invitedBy: string | null
  createdAt: Timestamp | null
  updatedAt: Timestamp | null
}

// SHEET: additional type for sheet info
type SheetInfo = {
  ok: boolean
  existsOnSheet?: boolean
  email?: string
  storeId?: string | null
  role?: 'owner' | 'staff'
  company?: string | null
  contractStart?: string | null
  contractEnd?: string | null
  paymentStatus?: string | null
  amountPaid?: string | null
  name?: string | null
} | null

function toNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function isTimestamp(value: unknown): value is Timestamp {
  return typeof value === 'object' && value !== null && typeof (value as Timestamp).toDate === 'function'
}

function mapStoreSnapshot(snapshot: DocumentSnapshot<DocumentData> | null): StoreProfile | null {
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

  return {
    id: snapshot.id,
    email: toNullableString(data.email),
    role,
    invitedBy: toNullableString(data.invitedBy),
    createdAt: isTimestamp(data.createdAt) ? data.createdAt : null,
    updatedAt: isTimestamp(data.updatedAt) ? data.updatedAt : null,
  }
}

function formatValue(value: string | null | undefined) {
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

export default function AccountOverview() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const membershipsStoreId = storeLoading ? undefined : storeId ?? null
  const {
    memberships,
    loading: membershipsLoading,
    error: membershipsError,
  } = useMemberships(membershipsStoreId)
  const { publish } = useToast()

  const [profile, setProfile] = useState<StoreProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [roster, setRoster] = useState<RosterMember[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [rosterVersion, setRosterVersion] = useState(0)

  // SHEET: state for sheet data
  const [sheetInfo, setSheetInfo] = useState<SheetInfo>(null)
  const [sheetLoading, setSheetLoading] = useState(false)
  const [sheetError, setSheetError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Membership['role']>('staff')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const activeMembership = useMemo(() => {
    if (!storeId) return null
    return memberships.find(m => m.storeId === storeId) ?? null
  }, [memberships, storeId])

  const isOwner = activeMembership?.role === 'owner'

  // SHEET: fetch sheet info for the signed-in user
  useEffect(() => {
    let cancelled = false
    setSheetLoading(true)
    setSheetError(null)

    const userEmail = auth.currentUser?.email?.trim()
    if (!userEmail) {
      setSheetInfo(null)
      setSheetLoading(false)
    } else {
      fetchSheetRows()
        .then(rows => {
          if (cancelled) return
          const row = findUserRow(rows, userEmail)
          if (!row) {
            setSheetInfo({ ok: true, existsOnSheet: false, email: userEmail })
            return
          }

          const normalizedRole = row.role === 'owner' ? 'owner' : row.role === 'staff' ? 'staff' : undefined

          setSheetInfo({
            ok: true,
            existsOnSheet: true,
            email: row.email,
            storeId: toNullableString(row.storeId),
            role: normalizedRole,
            company: toNullableString(row.company),
            contractStart: toNullableString(row.contractStart),
            contractEnd: toNullableString(row.contractEnd),
            paymentStatus: toNullableString(row.paymentStatus),
            amountPaid: toNullableString(row.amountPaid),
            name: toNullableString(row.name),
          })
        })
        .catch((err: any) => {
          if (cancelled) return
          console.error('Failed to load sheet info', err)
          setSheetInfo(null)
          setSheetError('We could not load your Google Sheet account info.')
          publish({ message: 'Unable to load sheet info.', tone: 'error' })
        })
        .finally(() => {
          if (!cancelled) setSheetLoading(false)
        })
    }

    return () => {
      cancelled = true
    }
  }, [publish])

  useEffect(() => {
    if (!storeId) {
      setProfile(null)
      setProfileError(null)
      return
    }

    let cancelled = false

    setProfileLoading(true)
    setProfileError(null)

    const ref = doc(db, 'stores', storeId)
    getDoc(ref)
      .then(snapshot => {
        if (cancelled) return

        if (snapshot.exists()) {
          const mapped = mapStoreSnapshot(snapshot)
          setProfile(mapped)
          setProfileError(null)
        } else {
          setProfile(null)
          setProfileError('We could not find this workspace profile.')
        }
      })
      .catch(error => {
        if (cancelled) return
        console.error('Failed to load store profile', error)
        setProfile(null)
        setProfileError('We could not load the workspace profile.')
        publish({ message: 'Unable to load store details.', tone: 'error' })
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false)
      })

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

  const isBusy = storeLoading || membershipsLoading || profileLoading || rosterLoading || sheetLoading

  return (
    <div className="account-overview">
      <h1>Account overview</h1>

      {(membershipsError || profileError || rosterError || sheetError) && (
        <div className="account-overview__error" role="alert">
          {membershipsError && <p>We could not load your memberships.</p>}
          {profileError && <p>{profileError}</p>}
          {rosterError && <p>{rosterError}</p>}
          {sheetError && <p>{sheetError}</p>}
        </div>
      )}

      {isBusy && (
        <p role="status" aria-live="polite">
          Loading account details…
        </p>
      )}

      {/* SHEET: show a quick sheet summary if present */}
      {sheetInfo?.existsOnSheet === false && (
        <p role="note">This account email isn’t on the Sedifex sheet.</p>
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
          {/* SHEET: new rows from the sheet */}
          <div>
            <dt>Store ID (from Sheet)</dt>
            <dd>{formatValue(sheetInfo?.storeId)}</dd>
          </div>
          <div>
            <dt>Role (from Sheet)</dt>
            <dd>{formatValue(sheetInfo?.role ?? null)}</dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>{formatValue(sheetInfo?.company ?? null)}</dd>
          </div>
          <div>
            <dt>Contract start</dt>
            <dd>{formatValue(sheetInfo?.contractStart ?? null)}</dd>
          </div>
          <div>
            <dt>Contract end</dt>
            <dd>{formatValue(sheetInfo?.contractEnd ?? null)}</dd>
          </div>
          <div>
            <dt>Payment status</dt>
            <dd>{formatValue(sheetInfo?.paymentStatus ?? null)}</dd>
          </div>
          <div>
            <dt>Amount paid</dt>
            <dd>{formatValue(sheetInfo?.amountPaid ?? null)}</dd>
          </div>

          {/* existing Firestore billing/profile fields */}
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
              <div role="row" key={member.id} data-testid={`account-roster-${member.id}`}>
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
