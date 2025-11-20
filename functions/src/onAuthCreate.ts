// functions/src/onAuthCreate.ts
import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'

/**
 * onAuthCreate
 *  - Runs when a new Firebase Auth user is created
 *  - Seeds:
 *    - teamMembers/<uid> in the DEFAULT Firestore DB
 *    - stores/<uid> workspace record with basic billing + status fields
 *
 * This ensures:
 *  - access checks (teamMembers) work
 *  - AccountOverview can read billingPlan, paymentProvider, status, contractStatus
 */
export const onAuthCreate = functions.auth.user().onCreate(async user => {
  const uid = user.uid
  const email = (user.email || '').trim().toLowerCase() || null
  const phone = user.phoneNumber || null
  const now = admin.firestore.FieldValue.serverTimestamp()

  functions.logger.info('onAuthCreate triggered', {
    uid,
    email,
    phone,
  })

  const teamRef = defaultDb.collection('teamMembers').doc(uid)
  const storeRef = defaultDb.collection('stores').doc(uid)

  try {
    await defaultDb.runTransaction(async tx => {
      // ----- Seed / update teamMembers/{uid} -----
      const teamSnap = await tx.get(teamRef)

      if (!teamSnap.exists) {
        tx.set(
          teamRef,
          {
            uid,
            email,
            phone,
            // Treat the owner as the first (and default) team member
            role: 'owner',
            storeId: uid,
            firstSignupEmail: email,
            createdAt: now,
            updatedAt: now,
          },
          { merge: true },
        )
      } else {
        tx.set(
          teamRef,
          {
            uid,
            email,
            phone,
            updatedAt: now,
          },
          { merge: true },
        )
      }

      // ----- Seed / update stores/{uid} -----
      const storeSnap = await tx.get(storeRef)
      const existing = storeSnap.exists ? storeSnap.data() || {} : {}

      // If a billing map already exists (e.g. created by another function),
      // mirror plan/provider into the top-level fields that the UI reads.
      const billingMap = (existing.billing ?? null) as
        | {
            planId?: string | null
            provider?: string | null
            status?: string | null
          }
        | null

      const inferredBillingPlan =
        typeof billingMap?.planId === 'string' && billingMap.planId.trim()
          ? billingMap.planId.trim()
          : typeof existing.billingPlan === 'string' && existing.billingPlan.trim()
            ? existing.billingPlan.trim()
            : 'starter-monthly'

      const inferredPaymentProvider =
        typeof billingMap?.provider === 'string' && billingMap.provider.trim()
          ? billingMap.provider.trim()
          : typeof existing.paymentProvider === 'string' && existing.paymentProvider.trim()
            ? existing.paymentProvider.trim()
            : 'paystack'

      const inferredContractStatus =
        typeof existing.contractStatus === 'string' && existing.contractStatus.trim()
          ? existing.contractStatus.trim()
          : 'Active'

      const inferredStatus =
        typeof existing.status === 'string' && existing.status.trim() ? existing.status.trim() : 'Active'

      if (!storeSnap.exists) {
        // New workspace record
        tx.set(
          storeRef,
          {
            ownerId: uid,
            ownerEmail: email,
            status: inferredStatus,
            contractStatus: inferredContractStatus,
            billingPlan: inferredBillingPlan,
            paymentProvider: inferredPaymentProvider,
            // Some minimal defaults the rest of the app expects
            inventorySummary: {
              trackedSkus: 0,
              lowStockSkus: 0,
              incomingShipments: 0,
            },
            createdAt: now,
            updatedAt: now,
          },
          { merge: true },
        )
      } else {
        // Keep existing values, but make sure the billing-related fields are present
        tx.set(
          storeRef,
          {
            ownerId: existing.ownerId || uid,
            ownerEmail: existing.ownerEmail || email,
            status: inferredStatus,
            contractStatus: inferredContractStatus,
            billingPlan: inferredBillingPlan,
            paymentProvider: inferredPaymentProvider,
            updatedAt: now,
          },
          { merge: true },
        )
      }
    })

    functions.logger.info('onAuthCreate completed successfully', { uid, email })
  } catch (err) {
    functions.logger.error('onAuthCreate failed', { uid, email, err })
    // Don’t throw: failing here shouldn’t block account creation,
    // but you will see it in Logs.
  }
})
