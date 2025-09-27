// web/src/pages/Gate.tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FirebaseError } from 'firebase/app';
import { useMemberships } from '../hooks/useMemberships';
import { createMyFirstStore } from '../controllers/storeController';

function isRecoverableMembershipError(error: unknown) {
  if (!error) return false;

  if (error instanceof FirebaseError) {
    if (error.code === 'permission-denied' || error.code === 'resource-exhausted') {
      return true;
    }

    const message = error.message.toLowerCase();
    return message.includes('offline') || message.includes('quota');
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('offline') || message.includes('quota');
  }

  return false;
}

function toErrorMessage(error: unknown) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch (e) {
    return String(error);
  }
}

export default function Gate({ children }: { children: ReactNode }) {
  const { loading, memberships, error } = useMemberships();
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const autoCreateTriggered = useRef(false);

  const attemptCreateStore = useCallback(async () => {
    try {
      setErrMsg(null);
      setBusy(true);
      await createMyFirstStore();
      // reload to re-run membership query and mount the app
      location.reload();
    } catch (e) {
      setErrMsg(toErrorMessage(e) || 'Failed to create store');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (error && !isRecoverableMembershipError(error)) return;
    if (memberships.length !== 0) return;
    if (autoCreateTriggered.current) return;

    autoCreateTriggered.current = true;
    void attemptCreateStore();
  }, [attemptCreateStore, error, loading, memberships]);

  if (loading) return <div className="p-6">Loading…</div>;

  const recoverableMembershipError = isRecoverableMembershipError(error) ? error : null;
  const irrecoverableMembershipError = error && !recoverableMembershipError ? error : null;
  const membershipErrorMessage = toErrorMessage(error);

  const shouldAutoCreateStore =
    memberships.length === 0 && (!error || isRecoverableMembershipError(error));

  // No memberships → show self-serve bootstrap
  if (memberships.length === 0 || error) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-2xl font-semibold mb-2">Let’s set up your workspace</h1>
        <p className="text-sm text-gray-600 mb-6">
          You don’t have a store yet. Create one now and you’ll be the owner.
        </p>

        {recoverableMembershipError && (
          <div className="mb-3 text-sm text-amber-600">
            We couldn’t confirm your memberships: {membershipErrorMessage}
          </div>
        )}

        {irrecoverableMembershipError && (
          <div className="mb-3 text-sm text-red-600">
            Error loading memberships: {membershipErrorMessage}
          </div>
        )}

        {errMsg && <div className="mb-3 text-sm text-red-600">{errMsg}</div>}

        {shouldAutoCreateStore && !errMsg ? (
          <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />
            Creating your store…
          </div>
        ) : (
          <button
            className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-60"
            disabled={busy}
            onClick={() => {
              autoCreateTriggered.current = true;
              void attemptCreateStore();
            }}
          >
            {busy ? 'Creating…' : 'Create my store'}
          </button>
        )}
      </div>
    );
  }

  // Has at least one membership → render the app
  return <>{children}</>;
}
