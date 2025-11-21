import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from '../firestore'

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

type InitializeStoreContact = {
  phone?: unknown
  firstSignupEmail?: unknown
  ownerName?: unknown
  businessName?: unknown
  country?: unknown
  town?: unknown
  signupRole?: unknown
}

function normalizeSignupRole(value: unknown): 'owner' | 'team-member' {
  if (typeof value === 'string' && value.trim().toLowerCase() === 'team-member') {
    return 'team-member'
  }
  return 'owner'
}

export const initializeStore = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.')
  }

  const storeIdInput = normalizeString(data?.storeId)
  const storeId = storeIdInput || context.auth.uid
  const now = admin.firestore.FieldValue.serverTimestamp()

  const contact = (data?.contact || {}) as InitializeStoreContact
  const signupRole = normalizeSignupRole(contact.signupRole)

  const signupContact = {
    phone: normalizeString(contact.phone),
    firstSignupEmail: normalizeString(contact.firstSignupEmail),
    ownerName: normalizeString(contact.ownerName),
    businessName: normalizeString(contact.businessName),
    country: normalizeString(contact.country),
    town: normalizeString(contact.town),
    signupRole,
  }

  await defaultDb.runTransaction(async tx => {
    const storeRef = defaultDb.collection('stores').doc(storeId)
    const teamRef = defaultDb.collection('teamMembers').doc(context.auth!.uid)
    const teamAliasRef = contact.firstSignupEmail
      ? defaultDb.collection('teamMembers').doc(contact.firstSignupEmail.toString().toLowerCase())
      : null

    tx.set(
      storeRef,
      {
        storeId,
        workspaceSlug: storeId,
        updatedAt: now,
        signupContact,
      },
      { merge: true },
    )

    const baseTeamData = {
      uid: context.auth.uid,
      storeId,
      role: signupRole === 'team-member' ? 'staff' : 'owner',
      email: normalizeString(contact.firstSignupEmail),
      phone: normalizeString(contact.phone),
      updatedAt: now,
    }

    tx.set(teamRef, baseTeamData, { merge: true })

    if (teamAliasRef) {
      tx.set(teamAliasRef, baseTeamData, { merge: true })
    }
  })

  return {
    ok: true,
    storeId,
    claims: null,
    role: signupRole,
  }
})
