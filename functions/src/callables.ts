// functions/src/callables.ts

import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'

/**
 * Request shape from the frontend (new flow):
 *
 * - role: 'owner' | 'member'
 * - storeId: optional for owner, required for member
 * - companyName: optional readable company/store name for owner
 *
 * Legacy / auto flow (current frontend):
 * - data is undefined or has no role
 * - we then try to infer workspace from teamMembers/<uid>.storeId
 *   If none exists yet, we auto-provision a default store and treat
 *   the user as an owner.
 */

type EnsureCanonicalWorkspaceRequest = {
  role?: 'owner' | 'member'
  storeId?: string
  companyName?: string
}

type RawEnsureCanonicalWorkspaceResponse = {
  ok: boolean
  workspaceSlug: string | null
  storeId: string | null
  claims?: unknown
}

export const ensureCanonicalWorkspace = functions.https.onCall(
  async (rawData: unknown, context): Promise<RawEnsureCanonicalWorkspaceResponse> => {
    const uid = context.auth?.uid
    const email = (context.auth?.token?.email as string | undefined) ?? null

    if (!uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'You must be authenticated to call ensureCanonicalWorkspace.',
      )
    }

    const data = (rawData ?? {}) as EnsureCanonicalWorkspaceRequest
    const now = admin.firestore.FieldValue.serverTimestamp()

    const memberRef = defaultDb.collection('teamMembers').doc(uid)
    const memberSnap = await memberRef.get()
    const existingMember = memberSnap.exists ? (memberSnap.data() as any) : null

    // Helper to set auth claims and build the response
    const finalize = async (
      storeId: string,
      role: 'owner' | 'member',
    ): Promise<RawEnsureCanonicalWorkspaceResponse> => {
      const claims = { storeId, role }
      await admin.auth().setCustomUserClaims(uid, claims)

      return {
        ok: true,
        workspaceSlug: storeId, // we now treat storeId as the workspace id
        storeId,
        claims,
      }
    }

    // ─────────────────────────────────────────────────────────────
    // LEGACY / AUTO MODE (current frontend)
    // No role passed => we infer or auto-create a workspace.
    // ─────────────────────────────────────────────────────────────
    if (!data.role) {
      // Case 1: teamMembers/<uid> already has a storeId → reuse it.
      if (
        existingMember &&
        typeof existingMember.storeId === 'string' &&
        existingMember.storeId.trim()
      ) {
        const storeId = existingMember.storeId.trim()
        const role =
          (existingMember.role as 'owner' | 'member' | undefined) ?? 'owner'
        return finalize(storeId, role)
      }

      // Case 2: No storeId yet → auto-provision a default store and
      // treat this user as an owner.
      const generatedStoreId = `store-${uid}`

      // Optional but useful: keep a workspace document keyed by storeId
      const workspaceRef = defaultDb.collection('workspaces').doc(generatedStoreId)
      await workspaceRef.set(
        {
          company: email || 'My Store',
          storeId: generatedStoreId,
          status: 'active',
          contractStatus: 'trial',
          paymentStatus: 'trial',
          plan: 'Starter',
          billingCycle: 'monthly',
          contactEmail: email,
          createdAt: existingMember?.createdAt ?? now,
          updatedAt: now,
        },
        { merge: true },
      )

      // Upsert the team member as owner of this store
      await memberRef.set(
        {
          uid,
          email,
          role: 'owner',
          storeId: generatedStoreId,
          createdAt: existingMember?.createdAt ?? now,
          updatedAt: now,
        },
        { merge: true },
      )

      return finalize(generatedStoreId, 'owner')
    }

    // ─────────────────────────────────────────────────────────────
    // NEW EXPLICIT MODE (when frontend passes role + storeId)
    // ─────────────────────────────────────────────────────────────
    const role: 'owner' | 'member' = data.role === 'owner' ? 'owner' : 'member'
    let storeId = (data.storeId ?? '').trim()
    const companyName = (data.companyName ?? '').trim() || 'My Store'

    if (role === 'owner') {
      // If owner did not provide a storeId, generate one from uid
      if (!storeId) {
        storeId = `store-${uid}`
      }

      const workspaceRef = defaultDb.collection('workspaces').doc(storeId)
      await workspaceRef.set(
        {
          company: companyName,
          storeId,
          status: 'active',
          contractStatus: 'trial',
          paymentStatus: 'trial',
          plan: 'Starter',
          billingCycle: 'monthly',
          contactEmail: email,
          createdAt: existingMember?.createdAt ?? now,
          updatedAt: now,
        },
        { merge: true },
      )

      await memberRef.set(
        {
          uid,
          email,
          role: 'owner',
          storeId,
          createdAt: existingMember?.createdAt ?? now,
          updatedAt: now,
        },
        { merge: true },
      )

      return finalize(storeId, 'owner')
    } else {
      // role === 'member'
      if (!storeId) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'storeId is required when role is "member".',
        )
      }

      // Optionally verify workspace exists here if you want:
      // const workspaceSnap = await defaultDb.collection('workspaces').doc(storeId).get()
      // if (!workspaceSnap.exists) { throw new HttpsError(...); }

      await memberRef.set(
        {
          uid,
          email,
          role: 'member',
          storeId,
          createdAt: existingMember?.createdAt ?? now,
          updatedAt: now,
        },
        { merge: true },
      )

      return finalize(storeId, 'member')
    }
  },
)
