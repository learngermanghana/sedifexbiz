// web/src/hooks/useEnsureOnboarded.ts
import React from 'react';
import { getAuth, onIdTokenChanged } from 'firebase/auth';

export function useEnsureOnboarded() {
  // Call once after login or when token changes
  React.useEffect(() => {
    const auth = getAuth();

    const unsub = onIdTokenChanged(auth, async user => {
      if (!user) return;

      try {
        const token = await user.getIdTokenResult();
        const stores = Array.isArray(token.claims?.stores)
          ? token.claims.stores.filter((value): value is string => typeof value === 'string' && value.length > 0)
          : [];

        if (stores.length === 0) {
          await user.getIdToken(true);
        }
      } catch (error) {
        console.error('[onboarding] Unable to refresh store claims', error);
      }
    });

    return () => unsub();
  }, []);
}
