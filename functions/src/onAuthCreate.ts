// functions/src/onAuthCreate.ts
import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'

/**
 * onAuthCreate
 *
 * Runs once when a new Firebase Auth user is created.
 *
 * It does three things, all in the **default** Firestore database:
 *  1. Creates/merges teamMembers/<uid>
 *  2. Creates/merges teamMembers/<email> (if email exists)
 *  3. Creates a starter stores/<uid> document with billing + inventory fields
 *     and with top-level `billingPlan` + `paymentProvider` so the frontend
 *     Account / Onboarding pages can read them.
 */
export const onAuthCreate = functions.auth.user().onCreate(async user => {
  const uid = user.uid
  const email =
    typeof user.email === 'string' && user.email.trim()
      ? user.email.trim().toLowerCase()
      : null

  const now = admin.firestore.FieldValue.serverTimestamp()
  const trialEndsAt = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14-day trial
  )

  const storeId = uid
  const defaultRole = 'owner'

  functions.logger.info('onAuthCreate triggered', {
    uid,
    email,
    phone: user.phoneNumber ?? null,
    storeId,
  })

  try {
    await defaultDb.runTransaction(async tx => {
      const teamMembersRef = defaultDb.collection('teamMembers')
      const storesRef = defaultDb.collection('stores')

      const teamByUidRef = teamMembersRef.doc(uid)
      const teamByEmailRef = email ? teamMembersRef.doc(email) : null
      const storeRef = storesRef.doc(storeId)

      const baseTeamData = {
        uid,
        email,
        role: defaultRole,
        storeId,
        createdAt: now,
        updatedAt: now,
      }

      // ---- teamMembers/<uid> ----
      const teamByUidSnap = await tx.get(teamByUidRef)
      if (!teamByUidSnap.exists) {
        tx.set(teamByUidRef, baseTeamData)
      } else {
        tx.set(
          teamByUidRef,
          {
            uid,
            email,
            role: defaultRole,
            storeId,
            updatedAt: now,
          },
          { merge: true },
        )
      }

      // ---- teamMembers/<email> (if email present) ----
      if (teamByEmailRef && email) {
        const teamByEmailSnap = await tx.get(teamByEmailRef)
        if (!teamByEmailSnap.exists) {
          tx.set(teamByEmailRef, baseTeamData)
        } else {
          tx.set(
            teamByEmailRef,
            {
              uid,
              email,
              role: defaultRole,
              storeId,
              updatedAt: now,
            },
            { merge: true },
          )
        }
      }

      // ---- stores/<storeId> ----
      const storeSnap = await tx.get(storeRef)

      const baseStoreData = {
        ownerId: uid,
        ownerEmail: email,
        status: 'Active',
        contractStatus: 'Active',

        // Top-level fields the frontend reads directly
        billingPlan: 'starter-monthly',
        paymentProvider: 'paystack',

        // Nested billing object (for backend / reporting)
        billing: {
          planId: 'starter-monthly',
          provider: 'paystack',
          status: 'trial',
          trialEndsAt,
          contractStatus: 'Active',
          createdAt: now,
        },

        inventorySummary: {
          incomingShipments: 0,
          lowStockSkus: 0,
          trackedSkus: 0,
        },

        createdAt: now,
        updatedAt: now,
      }

      if (!storeSnap.exists) {
        // Fresh workspace
        tx.set(storeRef, baseStoreData)
      } else {
        // Workspace already exists – just make sure owner + top-level fields are up to date
        tx.set(
          storeRef,
          {
            ownerId: uid,
            ownerEmail: email,
            status: 'Active',
            contractStatus: 'Active',
            billingPlan: 'starter-monthly',
            paymentProvider: 'paystack',
            updatedAt: now,
          },
          { merge: true },
        )
      }
    })

    functions.logger.info('onAuthCreate completed successfully', { uid, storeId })
  } catch (error) {
    functions.logger.error('onAuthCreate failed', {
      uid,
      error: (error as Error)?.message ?? String(error),
    })
    // Re-throw so Firebase marks the function as failed if something goes wrong
    throw error
  }
})
