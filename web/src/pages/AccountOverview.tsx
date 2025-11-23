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
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase'
import { useToast } from '../components/ToastProvider'
import { useActiveStore } from '../hooks/useActiveStore'
import { useMemberships } from '../hooks/useMemberships'
import { useAuthUser } from '../hooks/useAuthUser'
import { manageStaffAccount, type StaffRole } from '../controllers/storeController'
import { getStoreIdFromRecord } from '../utils/storeId'

function formatDate(value: Timestamp | Date | null | undefined) {
  const asDate = value instanceof Timestamp ? value.toDate() : value instanceof Date ? value : null
  return asDate ? asDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

function mapTeamMember(snapshot: QueryDocumentSnapshot<DocumentData>) {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    uid: typeof data.uid === 'string' && data.uid.trim() ? data.uid : snapshot.id,
    storeId: getStoreIdFromRecord(data),
    email: typeof data.email === 'string' ? data.email : 'Unknown user',
    role: data.role === 'owner' ? 'owner' : 'staff',
    invitedBy: typeof data.invitedBy === 'string' ? data.invitedBy : '—',
    phone: typeof data.phone === 'string' ? data.phone : null,
    firstSignupEmail: typeof data.firstSignupEmail === 'string' ? data.firstSignupEmail : null,
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : null,
  }
}

type StoreRecord = {
  id: string
  displayName?: string
  status?: string
  currency?: string
  billingPlan?: string
  paymentProvider?: string
  createdAt?: Timestamp
  updatedAt?: Timestamp
  ownerId?: string
  ownerEmail?: string
  planId?: string
  provider?: string
  trialEndsAt?: Timestamp
  contractStatus?: string
  inventorySummary?: {
    incomingShipments?: number
    lowStockSkus?: number
    trackedSkus?: number
  }
}

function StoreSummary({ store, canShowSensitive }: { store: StoreRecord | null; canShowSensitive: boolean }) {
  if (!store) return (
    <section style={sectionStyle}>
      <h2 style={sectionTitle}>Account overview</h2>
      <p style={mutedText}>Select a workspace to view its account details.</p>
    </section>
  )

  const billingLabel = store.planId ?? store.billingPlan ?? 'Not set'
  const providerLabel = store.provider ?? store.paymentProvider ?? '—'
  const statusLabel = store.status ?? '—'

  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitle}>Account overview</h2>
      <dl style={gridList}>
        <div>
          <dt style={termStyle}>Workspace</dt>
          <dd style={valueStyle}>{store.displayName ?? store.id}</dd>
        </div>
        <div>
          <dt style={termStyle}>Status</dt>
          <dd style={valueStyle}>{statusLabel}</dd>
        </div>
        <div>
          <dt style={termStyle}>Billing plan</dt>
          <dd style={valueStyle}>{billingLabel}</dd>
        </div>
        <div>
          <dt style={termStyle}>Payment provider</dt>
          <dd style={valueStyle}>{providerLabel}</dd>
        </div>
        <div>
          <dt style={termStyle}>Created</dt>
          <dd style={valueStyle}>{formatDate(store.createdAt ?? null)}</dd>
        </div>
        <div>
          <dt style={termStyle}>Last updated</dt>
          <dd style={valueStyle}>{formatDate(store.updatedAt ?? null)}</dd>
        </div>
        {canShowSensitive && (
          <>
            <div>
              <dt style={termStyle}>Contract status</dt>
              <dd style={valueStyle}>{store.contractStatus ?? '—'}</dd>
            </div>
            <div>
              <dt style={termStyle}>Trial ends</dt>
              <dd style={valueStyle}>{formatDate(store.trialEndsAt ?? null)}</dd>
            </div>
            <div>
              <dt style={termStyle}>Owner email</dt>
              <dd style={valueStyle}>{store.ownerEmail ?? '—'}</dd>
            </div>
          </>
        )}
      </dl>

      {canShowSensitive && store.inventorySummary && (
        <div style={{ marginTop: 16, padding: 16, border: '1px solid #E2E8F0', borderRadius: 12 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 16, color: '#0F172A' }}>Inventory snapshot</h3>
          <dl style={{ ...gridList, margin: 0 }}>
            <div>
              <dt style={termStyle}>Tracked SKUs</dt>
              <dd style={valueStyle}>{store.inventorySummary.trackedSkus ?? 0}</dd>
            </div>
            <div>
              <dt style={termStyle}>Low stock SKUs</dt>
              <dd style={valueStyle}>{store.inventorySummary.lowStockSkus ?? 0}</dd>
            </div>
            <div>
              <dt style={termStyle}>Incoming shipments</dt>
              <dd style={valueStyle}>{store.inventorySummary.incomingShipments ?? 0}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  )
}

export default function AccountOverview() {
  const { publish } = useToast()
  const { storeId, error: storeError } = useActiveStore()
  const { memberships } = useMemberships()
  const user = useAuthUser()

  const [store, setStore] = useState<StoreRecord | null>(null)
  const [roster, setRoster] = useState<ReturnType<typeof mapTeamMember>[]>([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterError, setRosterError] = useState<string | null>(null)

  const [inviteForm, setInviteForm] = useState({ email: '', role: 'staff' as StaffRole, password: '' })
  const isOwner = useMemo(() => memberships.find(m => m.storeId === storeId)?.role === 'owner', [memberships, storeId])
  const canShowSensitive = useMemo(
    () => !!user && (!!storeId && user.uid === storeId || (!!store && store.ownerId === user.uid)),
    [storeId, store, user],
  )

  useEffect(() => {
    let cancelled = false
    async function loadStore() {
      if (!storeId) return
      try {
        const storeRef = doc(db, 'stores', storeId)
        const snapshot = await getDoc(storeRef)

        if (cancelled) return

        if (snapshot.exists()) {
          setStore({ id: snapshot.id, ...(snapshot.data() as DocumentData) })
          return
        }

        const fallbackRef = collection(db, 'stores')
        const fallbackQuery = query(fallbackRef, where('ownerId', '==', storeId))
        const fallbackSnapshot = await getDocs(fallbackQuery)
        if (cancelled) return

        const [first] = fallbackSnapshot.docs
        if (first) {
          setStore({ id: first.id, ...(first.data() as DocumentData) })
        }
      } catch (err) {
        if (!cancelled) {
          publish({ message: 'Could not load workspace details. Please try again.', tone: 'error' })
        }
      }
    }

    loadStore()
    return () => {
      cancelled = true
    }
  }, [publish, storeId])

  useEffect(() => {
    let cancelled = false
    async function loadRoster() {
      if (!storeId) return
      setRosterLoading(true)
      setRosterError(null)
      try {
        const membersRef = collection(db, 'teamMembers')
        const membersQuery = query(membersRef, where('storeId', '==', storeId))
        const snapshot = await getDocs(membersQuery)
        if (cancelled) return

        setRoster(snapshot.docs.map(mapTeamMember))
      } catch (err) {
        if (!cancelled) setRosterError('Could not load team members.')
      } finally {
        if (!cancelled) setRosterLoading(false)
      }
    }

    loadRoster()
    return () => {
      cancelled = true
    }
  }, [storeId])

  async function handleInviteSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!storeId) return

    try {
      await manageStaffAccount({
        storeId,
        email: inviteForm.email,
        role: inviteForm.role,
        password: inviteForm.password || undefined,
      })
      publish({ message: 'Team member updated.', tone: 'success' })
      setInviteForm({ email: '', role: 'staff', password: '' })
      const membersRef = collection(db, 'teamMembers')
      const membersQuery = query(membersRef, where('storeId', '==', storeId))
      const snapshot = await getDocs(membersQuery)
      setRoster(snapshot.docs.map(mapTeamMember))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'We could not manage the staff account.'
      publish({ message, tone: 'error' })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StoreSummary store={store} canShowSensitive={canShowSensitive} />

      <section style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h2 style={sectionTitle}>Team access</h2>
            <p style={mutedText}>Manage who can access this workspace and how they sign in.</p>
          </div>
          {storeError && <span style={{ color: '#B91C1C' }}>{storeError}</span>}
        </div>

        {rosterLoading && <p style={mutedText}>Loading team…</p>}
        {rosterError && <p style={{ color: '#B91C1C' }}>{rosterError}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {roster.map(member => (
            <div
              key={member.id}
              data-testid={`account-roster-${member.id}`}
              data-uid={member.uid}
              data-store-id={member.storeId ?? ''}
              data-phone={member.phone ?? undefined}
              data-first-signup-email={member.firstSignupEmail ?? undefined}
              style={{
                border: '1px solid #E2E8F0',
                borderRadius: 12,
                padding: 12,
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr',
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, color: '#0F172A' }}>{member.email}</div>
                <div style={mutedText}>{member.phone ?? 'No phone added'}</div>
              </div>
              <div>
                <div style={termStyle}>Role</div>
                <div style={valueStyle}>{member.role}</div>
              </div>
              <div>
                <div style={termStyle}>Invited by</div>
                <div style={valueStyle}>{member.invitedBy}</div>
              </div>
              <div>
                <div style={termStyle}>Updated</div>
                <div style={valueStyle}>{formatDate(member.updatedAt)}</div>
              </div>
            </div>
          ))}
        </div>

        {isOwner ? (
          <form
            data-testid="account-invite-form"
            onSubmit={handleInviteSubmit}
            style={{
              marginTop: 16,
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              alignItems: 'end',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={termStyle} htmlFor="invite-email">Email</label>
              <input
                id="invite-email"
                type="email"
                required
                value={inviteForm.email}
                onChange={event => setInviteForm(prev => ({ ...prev, email: event.target.value }))}
                style={inputStyle}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={termStyle} htmlFor="invite-role">Role</label>
              <select
                id="invite-role"
                value={inviteForm.role}
                onChange={event => setInviteForm(prev => ({ ...prev, role: event.target.value as StaffRole }))}
                style={inputStyle}
              >
                <option value="owner">Owner</option>
                <option value="staff">Staff</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={termStyle} htmlFor="invite-password">Password</label>
              <input
                id="invite-password"
                type="password"
                value={inviteForm.password}
                onChange={event => setInviteForm(prev => ({ ...prev, password: event.target.value }))}
                style={inputStyle}
              />
            </div>
            <button
              type="submit"
              className="button button--primary"
              style={{ height: 44 }}
            >
              Send invite
            </button>
          </form>
        ) : (
          <p style={mutedText}>Read-only access. Contact an owner to invite new teammates.</p>
        )}
      </section>
    </div>
  )
}

const sectionStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 16,
  border: '1px solid #E2E8F0',
  padding: 16,
}

const sectionTitle: React.CSSProperties = { margin: 0, fontSize: 18, color: '#0F172A' }
const mutedText: React.CSSProperties = { margin: 0, color: '#475569', fontSize: 14 }
const gridList: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
  padding: 0,
  margin: '12px 0 0',
}
const termStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.3 }
const valueStyle: React.CSSProperties = { margin: 0, fontSize: 14, color: '#0F172A', fontWeight: 600 }
const inputStyle: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid #CBD5E1',
  padding: '10px 12px',
  fontSize: 14,
  color: '#0F172A',
}
