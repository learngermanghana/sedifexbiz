// functions/src/pos/handleUserCreate.ts
import * as functions from 'firebase-functions/v1';
import { admin, defaultDb } from '../firestore';

type SignupMode = 'owner' | 'member';

interface HandleUserCreateData {
  mode?: SignupMode;  // 'owner' | 'member'
  storeId?: string;   // required for member
  company?: string;   // optional friendly name
}

async function createOwnerStoreAndWorkspace(params: {
  uid: string;
  email: string | null;
  storeId: string;
  company?: string;
}) {
  const { uid, email, storeId, company } = params;
  const now = admin.firestore.FieldValue.serverTimestamp();

  // 1) Store document
  await defaultDb.collection('stores').doc(storeId).set(
    {
      ownerId: uid,
      status: 'Active',
      contractStatus: 'trial',
      inventorySummary: {
        trackedSkus: 0,
        lowStockSkus: 0,
        incomingShipments: 0,
      },
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  // 2) Team member document as owner
  await defaultDb.collection('teamMembers').doc(uid).set(
    {
      uid,
      email,
      storeId,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  // 3) Workspace document (ID == storeId)
  await defaultDb.collection('workspaces').doc(storeId).set(
    {
      storeId,
      company: company || 'New Store',
      contactEmail: email,
      plan: 'Growth',
      billingCycle: 'annual',
      paymentStatus: 'trial',
      status: 'active',
      updatedAt: now,
    },
    { merge: true }
  );

  // 4) Custom auth claims
  await admin.auth().setCustomUserClaims(uid, {
    role: 'owner',
    storeId,
  });
}

/**
 * handleUserCreate
 * Called from the web app right after signup.
 *
 * - mode: 'owner' or 'member'
 *   - owner:
 *       - auto-creates store + teamMember + workspace
 *       - storeId defaults to uid if not supplied
 *   - member:
 *       - requires storeId, verifies store exists
 *       - creates teamMember with role 'staff'
 */
export const handleUserCreate = functions.https.onCall(
  async (data: HandleUserCreateData, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'You must be signed in to complete onboarding.'
      );
    }

    const uid = context.auth.uid;
    const email =
      (context.auth.token.email as string | undefined) ?? null;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const mode: SignupMode = data?.mode === 'member' ? 'member' : 'owner';
    let storeId = (data?.storeId || '').trim();

    // ────────────────────────────────────────────────────────────
    // OWNER FLOW
    // ────────────────────────────────────────────────────────────
    if (mode === 'owner') {
      if (!storeId) {
        // simplest rule: owner's default store uses uid as ID
        storeId = uid;
      }

      await createOwnerStoreAndWorkspace({
        uid,
        email,
        storeId,
        company: data?.company,
      });

      return { ok: true, mode: 'owner', storeId };
    }

    // ────────────────────────────────────────────────────────────
    // MEMBER FLOW
    // ────────────────────────────────────────────────────────────
    if (!storeId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Store ID is required for team members.'
      );
    }

    const storeRef = defaultDb.collection('stores').doc(storeId);
    const storeSnap = await storeRef.get();

    if (!storeSnap.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'No store found with that Store ID.'
      );
    }

    await defaultDb.collection('teamMembers').doc(uid).set(
      {
        uid,
        email,
        storeId,
        role: 'staff',
        createdAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    await admin.auth().setCustomUserClaims(uid, {
      role: 'staff',
      storeId,
    });

    // Workspace will be ensured by ensureCanonicalWorkspace
    return { ok: true, mode: 'member', storeId };
  }
);
