// web/src/hooks/useEnsureOnboarded.ts
import { httpsCallable } from 'firebase/functions';
import { getAuth, onIdTokenChanged } from 'firebase/auth';
import { functions } from '../firebase';

export function useEnsureOnboarded() {
  // Call once after login or when token changes
  React.useEffect(() => {
    const auth = getAuth();

    const unsub = onIdTokenChanged(auth, async (user) => {
      if (!user) return;
      // Try to read claims
      const token = await user.getIdTokenResult();
      const hasStore = !!token.claims?.storeId;

      if (!hasStore) {
        try {
          const backfill = httpsCallable(functions, 'backfillMyStore');
          await backfill({});
          // Force refresh claims
          await user.getIdToken(true);
        } catch (e) {
          console.error('[onboarding] backfill failed', e);
        }
      }
    });

    return () => unsub();
  }, []);
}
