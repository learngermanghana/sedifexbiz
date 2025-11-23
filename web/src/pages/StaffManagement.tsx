import React, { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  type DocumentData,
  getDocs,
  query,
  type QueryDocumentSnapshot,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { useToast } from '../components/ToastProvider'
import { manageStaffAccount, type StaffRole } from '../controllers/storeController'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useMemberships, type Membership } from '../hooks/useMemberships'
import './StaffManagement.css'

type StaffMember = {
  id: string
  uid: string
  storeId: string | null
  email: string | null
  role: StaffRole
  invitedBy: string | null
  status: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

function toNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function mapMember(docSnap: QueryDocumentSnapshot<DocumentData>): StaffMember {
  const data = docSnap.data() || {}
  const role: StaffRole = data.role === 'owner' ? 'owner' : 'staff'

  return {
    id: docSnap.id,
    uid: typeof data.uid === 'string' && data.uid.trim() ? data.uid.trim() : docSnap.id,
    storeId: typeof data.storeId === 'string' ? data.storeId : null,
    email: toNullableString(data.email),
    role,
    invitedBy: toNullableString(data.invitedBy),
    status: toNullableString(data.status),
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
    updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : null,
  }
}

function formatDate(value: Date | null) {
  if (!value) return '—'
  try {
    return value.toLocaleString()
  } catch (error) {
    console.warn('[staff] Unable to format date', error)
    return '—'
  }
}

export default function StaffManagement() {
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore()
  const { memberships } = useMemberships()
  const { publish } = useToast()

  const [members, setMembers] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Membership['role']>('staff')
  const [invitePassword, setInvitePassword] = useState('')
  const [inviting, setInviting] = useState(false)

  const activeMembership = useMemo(() => {
    if (!storeId) return null
    return memberships.find(membership => membership.storeId === storeId) ?? null
  }, [memberships, storeId])

  const isOwner = activeMembership?.role === 'owner'

  useEffect(() => {
    if (!storeId) {
      setMembers([])
      setError(storeError)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    const membersRef = collection(db, 'teamMembers')
    const staffQuery = query(membersRef, where('storeId', '==', storeId))

    getDocs(staffQuery)
      .then(snapshot => {
        if (cancelled) return
        const mapped = snapshot.docs.map(mapMember)
        setMembers(mapped)
        setError(null)
      })
      .catch(err => {
        if (cancelled) return
        console.warn('[staff] Failed to load staff list', err)
        setMembers([])
        setError('We could not load the staff list.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [storeId, storeError, refreshToken])

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!storeId || inviting) return

    const normalizedEmail = inviteEmail.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Enter an email to invite a staff member.')
      publish({ message: 'Enter an email to invite a staff member.', tone: 'error' })
      return
    }

    setInviting(true)
    setError(null)
    try {
      await manageStaffAccount({
        storeId,
        email: normalizedEmail,
        role: inviteRole,
        password: invitePassword.trim() || undefined,
      })
      publish({ message: 'Staff invite sent.', tone: 'success' })
      setInviteEmail('')
      setInvitePassword('')
      setInviteRole('staff')
      setRefreshToken(token => token + 1)
    } catch (err) {
      console.warn('[staff] Failed to invite staff', err)
      const message = err instanceof Error ? err.message : 'We could not send the invite.'
      setError(message)
      publish({ message, tone: 'error' })
    } finally {
      setInviting(false)
    }
  }

  async function handleResetPassword(member: StaffMember) {
    if (!storeId) return
    if (!member.email) {
      publish({ message: 'Cannot reset password without an email address.', tone: 'error' })
      return
    }

    const nextPassword = window.prompt(
      `Enter a new password for ${member.email}`,
      '',
    )

    if (nextPassword === null) return
    const trimmed = nextPassword.trim()
    if (!trimmed) {
      publish({ message: 'Password cannot be empty.', tone: 'error' })
      return
    }

    try {
      await manageStaffAccount({
        storeId,
        email: member.email,
        role: member.role,
        password: trimmed,
      })
      publish({ message: 'Password reset successfully.', tone: 'success' })
    } catch (err) {
      console.warn('[staff] Failed to reset password', err)
      const message = err instanceof Error ? err.message : 'Unable to reset the password.'
      publish({ message, tone: 'error' })
    }
  }

  async function handleDeactivate(member: StaffMember) {
    if (!storeId) return

    const confirmed = window.confirm(`Deactivate ${member.email ?? member.id}?`)
    if (!confirmed) return

    try {
      await setDoc(
        doc(db, 'teamMembers', member.id),
        { status: 'inactive', updatedAt: serverTimestamp() },
        { merge: true },
      )
      publish({ message: 'Staff member deactivated.', tone: 'success' })
      setRefreshToken(token => token + 1)
    } catch (err) {
      console.warn('[staff] Failed to deactivate member', err)
      const message = err instanceof Error ? err.message : 'Unable to deactivate this member.'
      publish({ message, tone: 'error' })
    }
  }

  if (storeError) {
    return <div role="alert">{storeError}</div>
  }

  if (!storeId && !storeLoading) {
    return (
      <div className="page staff-page" role="status">
        <h1>Staff management</h1>
        <p>Select a workspace to manage staff accounts.</p>
      </div>
    )
  }

  return (
    <div className="page staff-page">
      <header className="page__header">
        <div>
          <p className="page__eyebrow">Workspace</p>
          <h1 className="page__title">Staff management</h1>
          <p className="page__subtitle">
            Invite new teammates, reset passwords, or deactivate access.
          </p>
        </div>
      </header>

      {error && (
        <div className="staff-page__error" role="alert">
          {error}
        </div>
      )}

      <section className="card staff-card" aria-labelledby="staff-actions">
        <div className="staff-card__header">
          <div>
            <p className="staff-card__eyebrow">Team actions</p>
            <h2 id="staff-actions">Invite staff</h2>
            <p className="staff-card__hint">
              New staff will get an account and team member record automatically.
            </p>
          </div>
        </div>

        <form className="staff-card__form" onSubmit={handleInvite}>
          <label>
            <span>Email</span>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={event => setInviteEmail(event.target.value)}
              placeholder="teammate@example.com"
              autoComplete="email"
            />
          </label>

          <label>
            <span>Role</span>
            <select
              value={inviteRole}
              onChange={event => setInviteRole(event.target.value as Membership['role'])}
            >
              <option value="owner">Owner</option>
              <option value="staff">Staff</option>
            </select>
          </label>

          <label>
            <span>Password (optional)</span>
            <input
              type="password"
              value={invitePassword}
              onChange={event => setInvitePassword(event.target.value)}
              placeholder="Auto-generate if empty"
              autoComplete="new-password"
            />
          </label>

          <button
            type="submit"
            className="button button--primary"
            disabled={!isOwner || inviting}
            data-testid="invite-staff-button"
          >
            {inviting ? 'Sending…' : 'Invite staff'}
          </button>
        </form>

        {!isOwner && (
          <p className="staff-card__hint" role="note">
            Only workspace owners can send staff invites.
          </p>
        )}
      </section>

      <section className="card staff-card" aria-labelledby="staff-list">
        <div className="staff-card__header">
          <div>
            <p className="staff-card__eyebrow">Team roster</p>
            <h2 id="staff-list">Current staff</h2>
            <p className="staff-card__hint">Filtered by this workspace ID.</p>
          </div>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setRefreshToken(token => token + 1)}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        <div className="staff-table" role="table" aria-label="Staff list">
          <div className="staff-table__row staff-table__header" role="row">
            <span role="columnheader">Email</span>
            <span role="columnheader">Role</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Updated</span>
            <span role="columnheader" className="staff-table__actions">Actions</span>
          </div>

          {members.length === 0 && !loading ? (
            <div className="staff-table__row" role="row">
              <span role="cell" className="staff-table__empty" colSpan={5}>
                No staff found for this workspace.
              </span>
            </div>
          ) : (
            members.map(member => (
              <div
                className="staff-table__row"
                role="row"
                key={member.id}
                data-testid={`staff-member-${member.id}`}
              >
                <span role="cell">{member.email ?? '—'}</span>
                <span role="cell">{member.role === 'owner' ? 'Owner' : 'Staff'}</span>
                <span role="cell">
                  {member.status ? (
                    <span className="staff-table__status" data-variant={member.status}>
                      {member.status}
                    </span>
                  ) : (
                    'Active'
                  )}
                </span>
                <span role="cell">{formatDate(member.updatedAt ?? member.createdAt)}</span>
                <span role="cell" className="staff-table__actions" data-label="Actions">
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => handleResetPassword(member)}
                    disabled={!isOwner}
                  >
                    Reset password
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={() => handleDeactivate(member)}
                    disabled={!isOwner}
                  >
                    Deactivate staff
                  </button>
                </span>
              </div>
            ))
          )}
        </div>

        {loading && (
          <p className="staff-card__hint" role="status">
            Loading staff…
          </p>
        )}
      </section>
    </div>
  )
}
