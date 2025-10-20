'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Timestamp,
  collection,
  getDocs,
  query,
  rosterDb,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from '../lib/db'; // roster DB handle (default DB is used inside the loader)
import { useActiveStore } from '../hooks/useActiveStore';
import { useMemberships, type Membership } from '../hooks/useMemberships';
import { manageStaffAccount } from '../controllers/storeController';
import { useToast } from '../components/ToastProvider';
import './AccountOverview.css';
import { useAutoRerun } from '../hooks/useAutoRerun';
import { normalizeStaffRole } from '../utils/normalizeStaffRole';
import { useAuthUser } from '../hooks/useAuthUser';

// Current workspace slug selected in the header (provider you added)
import { useSelectedWorkspaceSlug } from '../hooks/useWorkspaceSelect';

// Slug-first loader + roster-backed store resolution + mapper
import {
  getActiveStoreId,
  loadWorkspaceProfile,
  mapAccount,
  type WorkspaceAccountProfile,
} from '../data/loadWorkspace';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RosterMember = {
  id: string;
  uid: string;
  storeId: string | null;
  email: string | null;
  role: Membership['role'];
  invitedBy: string | null;
  phone: string | null;
  firstSignupEmail: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
};

function toNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
function isTimestamp(value: unknown): value is Timestamp {
  return typeof value === 'object' && value !== null && typeof (value as Timestamp).toDate === 'function';
}
function mapRosterSnapshot(snapshot: QueryDocumentSnapshot<DocumentData>): RosterMember {
  const data = snapshot.data();
  const role = normalizeStaffRole(data.role);
  const uid = typeof data.uid === 'string' && data.uid.trim() ? data.uid : snapshot.id;
  const storeId = typeof data.storeId === 'string' && data.storeId.trim() ? data.storeId : null;

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
  };
}

function formatValue(value: string | null) {
  return value ?? '—';
}
function formatTimestamp(value: Timestamp | Date | null) {
  if (!value) return '—';
  try {
    if (value instanceof Timestamp) return value.toDate().toLocaleString();
    if (value instanceof Date) return value.toLocaleString();
    if (typeof value === 'object' && value && typeof (value as Timestamp).toDate === 'function') {
      return (value as Timestamp).toDate().toLocaleString();
    }
  } catch {}
  return '—';
}

/** Minor-unit aware currency formatter (default 2dp currencies like GHS/USD) */
function formatAmountPaid(amount: number | null, currency: string | null, minor = 100): string {
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    const value = amount / (minor || 100);
    const formatted = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency ? `${currency} ${formatted}` : formatted;
  }
  return '—';
}

async function copyToClipboard(text: string) {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

export default function AccountOverview() {
  const user = useAuthUser();
  const uid = user?.uid ?? null;

  // Legacy/roster-based active store (still useful for roster queries)
  const { storeId, isLoading: storeLoading, error: storeError } = useActiveStore();

  const { memberships, loading: membershipsLoading, error: membershipsError } = useMemberships();
  const { publish } = useToast();

  // SOURCE OF TRUTH for workspace choice
  const selectedSlug = useSelectedWorkspaceSlug();

  const [resolvedStoreId, setResolvedStoreId] = useState<string | null>(storeId ?? null);
  const { token: autoRefreshToken, trigger: requestAutoRefresh } = useAutoRerun(Boolean(resolvedStoreId));

  const [profile, setProfile] = useState<WorkspaceAccountProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterVersion, setRosterVersion] = useState(0);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Membership['role']>('staff');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const activeMembership = useMemo(() => {
    if (storeId) return memberships.find(m => m.storeId === storeId) ?? null;
    if (resolvedStoreId) return memberships.find(m => m.storeId === resolvedStoreId) ?? null;
    return memberships.length === 1 ? memberships[0] : null;
  }, [memberships, resolvedStoreId, storeId]);

  // Prefer the UI-selected slug; fall back to membership’s slug if selector not set yet
  const profileSlug = selectedSlug || activeMembership?.workspaceSlug || null;
  const isOwner = activeMembership?.role === 'owner';

  const inviteLink = useMemo(() => {
    if (!resolvedStoreId || typeof window === 'undefined') return '';
    const { origin, pathname } = window.location;
    const base = `${origin}${pathname}`;
    const normalized = base.endsWith('/') ? base : `${base}/`;
    return `${normalized}#/`;
  }, [resolvedStoreId]);

  const inviteMailtoHref = useMemo(() => {
    if (!inviteLink) return '';
    const workspaceName = profile?.displayName ?? profile?.name ?? 'our Sedifex workspace';
    const subject = encodeURIComponent(`Join ${workspaceName} on Sedifex`);
    const body = [
      'Hi there,',
      '',
      `You have been invited to join ${workspaceName} on Sedifex.`,
      `Sign in here: ${inviteLink}`,
      (profileSlug ?? resolvedStoreId) ? `Workspace ID: ${profileSlug ?? resolvedStoreId}` : null,
      '',
      'Use the email address we invited and the password provided by your workspace admin.',
    ]
      .filter(Boolean)
      .join('\n');
    return `mailto:?subject=${subject}&body=${encodeURIComponent(body)}`;
  }, [inviteLink, profile?.displayName, profile?.name, resolvedStoreId, profileSlug]);

  useEffect(() => {
    if (copyStatus === 'idle') return;
    const t = setTimeout(() => setCopyStatus('idle'), 4000);
    return () => clearTimeout(t);
  }, [copyStatus]);

  // Resolve storeId from roster if hook didn’t provide one
  useEffect(() => {
    let cancelled = false;

    if (storeId) {
      setResolvedStoreId(prev => (prev === storeId ? prev : storeId));
      return () => { cancelled = true; };
    }

    if (!uid) {
      setResolvedStoreId(null);
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        const nextStoreId = await getActiveStoreId(uid);
        if (!cancelled) setResolvedStoreId(nextStoreId);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to resolve active store ID', err);
          setResolvedStoreId(null);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [storeId, uid]);

  // SLUG-FIRST workspace load (falls back to storeId → query)
  useEffect(() => {
    if (!profileSlug && !resolvedStoreId) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    let cancelled = false;

    (async () => {
      setProfileLoading(true);
      setProfileError(null);

      try {
        const ws = await loadWorkspaceProfile({ slug: profileSlug, storeId: resolvedStoreId });
        if (cancelled) return;

        if (!ws) {
          setProfile(null);
          setProfileError('We could not find this workspace profile.');
          return;
        }

        const mapped = mapAccount(ws);
        setProfile(mapped);
        setProfileError(null);

        // Keep roster in sync with the loaded workspace
        if (mapped.storeId && mapped.storeId !== resolvedStoreId) {
          setResolvedStoreId(mapped.storeId);
        }
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load store profile', error);
        setProfile(null);
        setProfileError('We could not load the workspace profile.');
        publish({ message: 'Unable to load store details.', tone: 'error' });
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [autoRefreshToken, profileSlug, publish, resolvedStoreId]);

  // Roster (always by storeId, from roster DB)
  useEffect(() => {
    if (!resolvedStoreId) {
      setRoster([]);
      setRosterError(null);
      return;
    }

    let cancelled = false;
    setRosterLoading(true);
    setRosterError(null);

    const membersRef = collection(rosterDb, 'teamMembers');
    const rosterQuery = query(membersRef, where('storeId', '==', resolvedStoreId));

    getDocs(rosterQuery)
      .then(snapshot => {
        if (cancelled) return;
        const members = snapshot.docs.map(mapRosterSnapshot);
        setRoster(members);
        setRosterError(null);
      })
      .catch(error => {
        if (cancelled) return;
        console.error('Failed to load roster', error);
        setRoster([]);
        setRosterError('We could not load the team roster.');
        publish({ message: 'Unable to load team members.', tone: 'error' });
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });

    return () => { cancelled = true; };
  }, [autoRefreshToken, publish, resolvedStoreId, rosterVersion]);

  function validateForm() {
    if (!resolvedStoreId) return 'A storeId is required to manage staff.';
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return 'Enter the teammate’s email address.';
    if (!EMAIL_PATTERN.test(normalizedEmail)) return 'Enter a valid email address.';
    const normalizedRole = role?.trim();
    if (!normalizedRole) return 'Select a role for this teammate.';
    if (normalizedRole !== 'owner' && normalizedRole !== 'staff') return 'Choose either owner or staff for the role.';
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const error = validateForm();
    if (error) {
      setFormError(error);
      publish({ message: error, tone: 'error' });
      return;
    }
    if (!resolvedStoreId) return;

    const payload = {
      storeId: resolvedStoreId,
      email: email.trim().toLowerCase(),
      role,
      password: password.trim() || undefined,
    };

    setSubmitting(true);
    setFormError(null);
    try {
      await manageStaffAccount(payload);
      publish({ message: 'Team member updated.', tone: 'success' });
      setEmail('');
      setRole('staff');
      setPassword('');
      setRosterVersion(v => v + 1);
      requestAutoRefresh();
    } catch (error) {
      console.error('Failed to manage staff account', error);
      const message = error instanceof Error ? error.message : 'We could not submit the request.';
      setFormError(message);
      publish({ message, tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  if (storeError) return <div role="alert">{storeError}</div>;

  if (!resolvedStoreId && !storeLoading) {
    return (
      <div className="account-overview" role="status">
        <h1>Account overview</h1>
        <p>Select a workspace to view account details.</p>
      </div>
    );
  }

  const isBusy =
    storeLoading ||
    membershipsLoading ||
    (profileLoading && !profile) ||
    (rosterLoading && roster.length === 0);

  const workspaceIdentifier = profileSlug ?? resolvedStoreId ?? null;

  return (
    <div className="account-overview">
      <h1>
        Account overview
        {workspaceIdentifier ? ` / ${workspaceIdentifier}` : ''}
      </h1>

      {(membershipsError || profileError || rosterError) && (
        <div className="account-overview__error" role="alert">
          {membershipsError && <p>We could not load your memberships.</p>}
          {profileError && <p>{profileError}</p>}
          {rosterError && <p>{rosterError}</p>}
        </div>
      )}

      {isBusy && (
        <p role="status" aria-live="polite">
          {workspaceIdentifier
            ? `Loading account details for workspace/${workspaceIdentifier}…`
            : 'Loading account details…'}
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
            <dt>Plan</dt>
            <dd>{formatValue(profile?.plan ?? null)}</dd>
          </div>
          <div>
            <dt>Payment status</dt>
            <dd>{formatValue(profile?.paymentStatus ?? null)}</dd>
          </div>
          <div>
            <dt>Contract start</dt>
            <dd>{formatTimestamp(profile?.contractStart ?? null)}</dd>
          </div>
          <div>
            <dt>Contract end</dt>
            <dd>{formatTimestamp(profile?.contractEnd ?? null)}</dd>
          </div>
          <div>
            <dt>Amount paid</dt>
            <dd>{formatAmountPaid(profile?.amountPaid ?? null, profile?.currency ?? null)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="account-overview-roster">
        <h2 id="account-overview-roster">Team roster</h2>

        {isOwner ? (
          <>
            {/* Invite link */}
            {inviteLink && (
              <section className="account-overview__invite" aria-labelledby="account-overview-invite-heading">
                <h3 id="account-overview-invite-heading">Share an invite link</h3>
                <p className="account-overview__invite-description">
                  Copy this link or share it via email so teammates can sign in to your Sedifex workspace.
                </p>
                <div className="account-overview__invite-link">
                  <input
                    type="url"
                    value={inviteLink}
                    readOnly
                    onFocus={e => e.target.select()}
                    className="account-overview__invite-input"
                    aria-label="Invite link"
                    data-testid="account-invite-link"
                  />
                  <button type="button" className="button button--outline" onClick={() => copyToClipboard(inviteLink)}>
                    {copyStatus === 'copied' ? 'Link copied' : 'Copy invite link'}
                  </button>
                  {inviteMailtoHref && (
                    <a className="button button--ghost" href={inviteMailtoHref} data-testid="account-share-invite-email">
                      Share via email
                    </a>
                  )}
                </div>
                {copyStatus === 'copied' && (
                  <p className="account-overview__invite-feedback" role="status">
                    Invite link copied to clipboard.
                  </p>
                )}
                {copyStatus === 'error' && (
                  <p className="account-overview__invite-feedback account-overview__invite-feedback--error" role="alert">
                    We couldn't copy the invite link. You can still select the link above or share it via email.
                  </p>
                )}
              </section>
            )}

            {/* Invite form */}
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
          </>
        ) : (
          <p role="note">You have read-only access to the team roster.</p>
        )}

        {/* Roster list */}
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
  );
}
