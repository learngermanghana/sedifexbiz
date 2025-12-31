import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'
import { findFirstMembership, upsertMembership } from './utils/teamMembers'

export const ensureCanonicalWorkspace = functions.https.onCall(
  async (rawData, context) => {
    const uid = context.auth?.uid
    const email = context.auth?.token?.email ?? null

    if (!uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'You must be authenticated to call ensureCanonicalWorkspace.',
      )
    }

    const data = (rawData ?? {}) as {
      role?: 'owner' | 'member'
      storeId?: string
      companyName?: string
    }

    const now = admin.firestore.FieldValue.serverTimestamp()
    const legacyMemberRef = defaultDb.collection('teamMembers').doc(uid)
    const legacyMemberSnap = await legacyMemberRef.get()
    const existingMember = legacyMemberSnap.exists ? legacyMemberSnap.data() : null

    const finalize = async (storeId: string, role: 'owner' | 'member') => {
      const claims = { storeId, role }
      await admin.auth().setCustomUserClaims(uid, claims)
      return {
        ok: true,
        workspaceSlug: storeId,
        storeId,
        claims,
      }
    }

    // 🔹 Normalize inputs
    const requestedStoreId = (data.storeId ?? '').trim()
    const requestedRole = data.role === 'owner' ? 'owner' : data.role === 'member' ? 'member' : null

    // ─────────────────────────────────────────────────────────────
    // NEW EXPLICIT MODE (frontend passes role + storeId)
    // ─────────────────────────────────────────────────────────────
    if (requestedRole) {
      let storeId = requestedStoreId
      const companyName = (data.companyName ?? '').trim() || 'My Store'

      if (requestedRole === 'owner') {
        if (!storeId) {
          storeId = `store-${uid}-${Date.now()}`
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

        await upsertMembership(
          defaultDb,
          uid,
          storeId,
          {
            email,
            role: 'owner',
            createdAt: existingMember?.createdAt ?? now,
            updatedAt: now,
          },
          true,
        )

        return finalize(storeId, 'owner')
      }

      // requestedRole === 'member'
      if (!storeId) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'storeId is required when role is "member".',
        )
      }

      // Optionally verify workspace exists:
      const wsSnap = await defaultDb.collection('workspaces').doc(storeId).get()
      if (!wsSnap.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          'No workspace was found with that Store ID.',
        )
      }

      await upsertMembership(
        defaultDb,
        uid,
        storeId,
        {
          email,
          role: 'member',
          createdAt: existingMember?.createdAt ?? now,
          updatedAt: now,
        },
        true,
      )

      return finalize(storeId, 'member')
    }

    // ─────────────────────────────────────────────────────────────
    // LEGACY / AUTO MODE (no role passed)
    // 🔹 PATCHED: if data.storeId is present, treat as member join
    // ─────────────────────────────────────────────────────────────
    if (requestedStoreId) {
      const storeId = requestedStoreId

      // Ensure workspace exists
      const wsSnap = await defaultDb.collection('workspaces').doc(storeId).get()
      if (!wsSnap.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          'No workspace was found with that Store ID.',
        )
      }

      await upsertMembership(
        defaultDb,
        uid,
        storeId,
        {
          email,
          role: 'member',
          createdAt: existingMember?.createdAt ?? now,
          updatedAt: now,
        },
        true,
      )

      return finalize(storeId, 'member')
    }

    // Legacy auto-flow with no role and no storeId:
    // Case 1: re-use existing member.storeId
    if (
      existingMember &&
      typeof (existingMember as any).storeId === 'string' &&
      (existingMember as any).storeId.trim()
    ) {
      const storeId = (existingMember as any).storeId.trim()
      const role = ((existingMember as any).role ?? 'owner') as 'owner' | 'member'
      return finalize(storeId, role)
    }

    const firstMembership = await findFirstMembership(defaultDb, uid)
    if (firstMembership) {
      const storeId =
        typeof firstMembership.data.storeId === 'string'
          ? firstMembership.data.storeId.trim()
          : ''
      if (storeId) {
        const role =
          ((firstMembership.data.role ?? 'owner') as 'owner' | 'member')
        return finalize(storeId, role)
      }
    }

    // Case 2: auto-provision owner store
    const generatedStoreId = `store-${uid}-${Date.now()}`
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

    await upsertMembership(
      defaultDb,
      uid,
      generatedStoreId,
      {
        email,
        role: 'owner',
        createdAt: existingMember?.createdAt ?? now,
        updatedAt: now,
      },
      true,
    )

    return finalize(generatedStoreId, 'owner')
  },
)
