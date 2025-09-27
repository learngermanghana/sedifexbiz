import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

admin.initializeApp()
const db = admin.firestore()

// -----------------------------
// Types
// -----------------------------
type StoreUserDoc = {
  storeId: string
  uid: string
  role: string
  email?: string
}

type StoreClaims = {
  stores: string[]
  activeStoreId: string | null
  roleByStore: Record<string, string>
}

type OwnerBootstrapMetadata = {
  ownerEmail?: string | null
  ownerPhone?: string | null
  firstSignupEmail?: string | null
  membershipPhone?: string | null
}

type InitializeStorePayload = {
  storeCode?: unknown
  contact?: {
    phone?: unknown
    firstSignupEmail?: unknown
  }
}

type ResolveStoreAccessPayload = {
  storeCode?: unknown
}

type ManageStaffPayload = {
  storeId?: unknown
  email?: unknown
  role?: unknown
  password?: unknown
}

// -----------------------------
// Constants & helpers
// -----------------------------
const STORE_CODE_PATTERN = /^[A-Z]{6}$/

function genStoreCode(): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join('')
}

async function listStoreMemberships(uid: string) {
  const snapshot = await db.collection('storeUsers').where('uid', '==', uid).get()
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...(doc.data() as StoreUserDoc) }))
    .filter(doc => typeof doc.storeId === 'string' && typeof doc.role === 'string')
}

async function applyStoreClaims(uid: string, preferredActiveStoreId?: string | null): Promise<StoreClaims> {
  const [memberships, userRecord] = await Promise.all([
    listStoreMemberships(uid),
    admin.auth().getUser(uid).catch(() => null),
  ])

  const stores = Array.from(new Set(memberships.map(m => m.storeId).filter(Boolean)))

  const roleByStore = memberships.reduce<Record<string, string>>((acc, m) => {
    if (m.storeId && m.role) acc[m.storeId] = m.role
    return acc
  }, {})

  const existingClaims = (userRecord?.customClaims ?? {}) as Record<string, unknown>
  const preferredActive =
    typeof preferredActiveStoreId === 'string' && stores.includes(preferredActiveStoreId)
      ? preferredActiveStoreId
      : null
  const existingActiveClaim =
    typeof existingClaims.activeStoreId === 'string' && stores.includes(existingClaims.activeStoreId as string)
      ? (existingClaims.activeStoreId as string)
      : null

  let activeStoreId: string | null = preferredActive ?? existingActiveClaim
  if (!activeStoreId) activeStoreId = stores.length > 0 ? stores[0] : null

  const nextClaims = { ...existingClaims, stores, activeStoreId, roleByStore }
  await admin.auth().setCustomUserClaims(uid, nextClaims)

  return { stores, activeStoreId, roleByStore }
}

async function upsertStoreMembership(
  storeId: string,
  uid: string,
  email: string | null,
  role: string,
  invitedBy: string | null,
  contact: { phone?: string | null; firstSignupEmail?: string | null } = {},
) {
  const membershipRef = db.collection('storeUsers').doc(`${storeId}_${uid}`)
  const storeMemberRef = db.collection('stores').doc(storeId).collection('members').doc(uid)

  const [membershipSnap, storeMemberSnap] = await Promise.all([membershipRef.get(), storeMemberRef.get()])
  const timestamp = admin.firestore.FieldValue.serverTimestamp()

  const baseData = {
    storeId,
    uid,
    email: email ?? null,
    role,
    invitedBy,
    phone: contact.phone ?? null,
    firstSignupEmail: contact.firstSignupEmail ?? null,
    updatedAt: timestamp,
  }

  const membershipData = { ...baseData, ...(membershipSnap.exists ? {} : { createdAt: timestamp }) }
  const storeMemberData = { ...baseData, ...(storeMemberSnap.exists ? {} : { createdAt: timestamp }) }

  await Promise.all([
    membershipRef.set(membershipData, { merge: true }),
    storeMemberRef.set(storeMemberData, { merge: true }),
  ])

  return membershipData
}

async function ensureDefaultStoreForUser(
  uid: string,
  metadata: OwnerBootstrapMetadata = {},
  preferredStoreId?: string | null,
) {
  const storeId = typeof preferredStoreId === 'string' ? preferredStoreId.trim() : ''
  if (!storeId) return

  const storeRef = db.collection('stores').doc(storeId)

  await db.runTransaction(async tx => {
    const storeSnap = await tx.get(storeRef)
    const timestamp = admin.firestore.FieldValue.serverTimestamp()

    const storeData: admin.firestore.DocumentData = {
      storeId,
      id: storeId,
      ownerId: storeSnap.exists && storeSnap.get('ownerId') ? storeSnap.get('ownerId') : uid,
      updatedAt: timestamp,
    }

    if (storeSnap.exists) {
      const existingOwnerId = storeSnap.get('ownerId')
      if (existingOwnerId && existingOwnerId !== uid) {
        throw new functions.https.HttpsError('already-exists', 'Store code already assigned to another account')
      }
    } else {
      storeData.createdAt = timestamp
    }

    if (metadata.ownerEmail !== undefined) storeData.ownerEmail = metadata.ownerEmail
    if (metadata.ownerPhone !== undefined) storeData.ownerPhone = metadata.ownerPhone

    const existingFirstSignupEmail = storeSnap.exists ? storeSnap.get('firstSignupEmail') : undefined
    if (existingFirstSignupEmail === undefined || existingFirstSignupEmail === null) {
      if (metadata.firstSignupEmail !== undefined) {
        storeData.firstSignupEmail = metadata.firstSignupEmail
      } else if (!storeSnap.exists && metadata.ownerEmail !== undefined) {
        storeData.firstSignupEmail = metadata.ownerEmail
      }
    }

    tx.set(storeRef, storeData, { merge: true })
  })

  await upsertStoreMembership(
    storeId,
    uid,
    metadata.ownerEmail ?? null,
    'owner',
    null,
    {
      phone: metadata.membershipPhone ?? metadata.ownerPhone ?? null,
      firstSignupEmail:
        metadata.firstSignupEmail !== undefined ? metadata.firstSignupEmail : metadata.ownerEmail ?? null,
    },
  )
}

async function refreshUserClaims(
  uid: string,
  metadata: OwnerBootstrapMetadata = {},
  preferredStoreId?: string | null,
) {
  await ensureDefaultStoreForUser(uid, metadata, preferredStoreId)
  return applyStoreClaims(uid, preferredStoreId)
}

function normalizeStoreCode(value: unknown) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().toUpperCase()
  if (!trimmed) return ''
  if (!STORE_CODE_PATTERN.test(trimmed)) {
    throw new functions.https.HttpsError('invalid-argument', 'Store code must be exactly six letters.')
  }
  return trimmed
}

function normalizeInitializeStorePayload(
  data: InitializeStorePayload | null | undefined,
  { requireStoreCode }: { requireStoreCode: boolean },
) {
  const contact = data?.contact ?? {}
  const rawPhone = typeof contact.phone === 'string' ? contact.phone.trim() : ''
  const phone = rawPhone ? rawPhone : null
  const rawFirstSignupEmail =
    typeof contact.firstSignupEmail === 'string' ? contact.firstSignupEmail.trim().toLowerCase() : ''
  const firstSignupEmail = rawFirstSignupEmail ? rawFirstSignupEmail : null
  const storeCode = normalizeStoreCode(data?.storeCode)

  if (requireStoreCode && !storeCode) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid store code is required.')
  }

  return { phone, firstSignupEmail, storeCode }
}

function assertOwnerAccess(context: functions.https.CallableContext, storeId: string) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required')

  const claims = context.auth.token as Record<string, unknown>
  const stores = Array.isArray(claims.stores) ? claims.stores : []
  if (!stores.includes(storeId)) throw new functions.https.HttpsError('permission-denied', 'No store access')

  const roleByStore = (claims.roleByStore ?? {}) as Record<string, unknown>
  const role = typeof roleByStore[storeId] === 'string' ? (roleByStore[storeId] as string) : null
  if (role !== 'owner') throw new functions.https.HttpsError('permission-denied', 'Owner access required')
}

function normalizeManageStaffPayload(data: ManageStaffPayload) {
  const storeId = typeof data.storeId === 'string' ? data.storeId.trim() : ''
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
  const role = typeof data.role === 'string' ? data.role.trim() : ''
  const passwordRaw = data.password
  let password: string | undefined
  if (passwordRaw === null || passwordRaw === undefined || passwordRaw === '') {
    password = undefined
  } else if (typeof passwordRaw === 'string') {
    password = passwordRaw
  } else {
    throw new functions.https.HttpsError('invalid-argument', 'Password must be a string when provided')
  }

  if (!storeId) throw new functions.https.HttpsError('invalid-argument', 'A valid storeId is required')
  if (!email) throw new functions.https.HttpsError('invalid-argument', 'A valid email is required')
  if (!role) throw new functions.https.HttpsError('invalid-argument', 'A role is required')

  return { storeId, email, role, password }
}

async function ensureAuthUser(email: string, password?: string) {
  try {
    const record = await admin.auth().getUserByEmail(email)
    if (password) await admin.auth().updateUser(record.uid, { password })
    return { record, created: false }
  } catch (error: any) {
    if (error?.code === 'auth/user-not-found') {
      if (!password) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'A password is required when creating a new staff account',
        )
      }
      const record = await admin.auth().createUser({ email, password, emailVerified: false })
      return { record, created: true }
    }
    throw error
  }
}

// -----------------------------
// Auth trigger: create default store on sign-up
// -----------------------------
export const handleUserCreate = functions.auth.user().onCreate(async user => {
  const uid = user.uid
  const email = user.email ?? null
  const storeCode = genStoreCode() // create a default store id like "ABCDEF"

  await refreshUserClaims(
    uid,
    {
      ownerEmail: email,
      ownerPhone: user.phoneNumber ?? null,
      firstSignupEmail: email,
      membershipPhone: user.phoneNumber ?? null,
    },
    storeCode, // pass it so Firestore docs are actually written
  )
})

// -----------------------------
// Callable: initializeStore
// -----------------------------
export const initializeStore = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required')
  }

  const uid = context.auth.uid
  const email = typeof context.auth.token.email === 'string' ? context.auth.token.email : null

  const { phone, firstSignupEmail, storeCode } = normalizeInitializeStorePayload(
    (data ?? {}) as InitializeStorePayload,
    { requireStoreCode: true },
  )

  const claims = await refreshUserClaims(
    uid,
    {
      ownerEmail: email,
      ownerPhone: phone,
      firstSignupEmail: firstSignupEmail ?? email ?? null,
      membershipPhone: phone,
    },
    storeCode,
  )

  return { ok: true, claims, storeId: storeCode ?? null }
})

// -----------------------------
// Callable: resolveStoreAccess
// -----------------------------
export const resolveStoreAccess = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required')
  }

  const uid = context.auth.uid
  const email = typeof context.auth.token.email === 'string' ? context.auth.token.email : null
  const phone = typeof context.auth.token.phone_number === 'string' ? context.auth.token.phone_number : null

  const payload = (data ?? {}) as ResolveStoreAccessPayload
  const storeCode = normalizeStoreCode(payload.storeCode)
  if (!storeCode) throw new functions.https.HttpsError('invalid-argument', 'A valid store code is required.')

  const storeRef = db.collection('stores').doc(storeCode)
  const membershipRef = db.collection('storeUsers').doc(`${storeCode}_${uid}`)
  const storeMemberRef = storeRef.collection('members').doc(uid)

  const [storeSnap, membershipSnap, storeMemberSnap] = await Promise.all([
    storeRef.get(),
    membershipRef.get(),
    storeMemberRef.get(),
  ])

  if (!storeSnap.exists) throw new functions.https.HttpsError('not-found', 'No store matches the provided code.')

  const timestamp = admin.firestore.FieldValue.serverTimestamp()
  const ownerId = storeSnap.get('ownerId')

  const resolveExistingString = (value: unknown): string | null => {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed ? trimmed : null
    }
    return null
  }

  const existingRole =
    resolveExistingString(membershipSnap.get('role')) ??
    resolveExistingString(storeMemberSnap.get('role')) ??
    null

  let role = existingRole ?? 'staff'
  if (!existingRole && resolveExistingString(ownerId) === uid) role = 'owner'

  const existingPhone =
    resolveExistingString(membershipSnap.get('phone')) ??
    resolveExistingString(storeMemberSnap.get('phone')) ??
    null
  const membershipPhone = existingPhone ?? (phone ?? null)

  const existingFirstSignupEmail =
    resolveExistingString(membershipSnap.get('firstSignupEmail')) ??
    resolveExistingString(storeMemberSnap.get('firstSignupEmail')) ??
    null
  const membershipFirstSignupEmail = existingFirstSignupEmail ?? (email ? email.toLowerCase() : null)

  const invitedBy = resolveExistingString(membershipSnap.get('invitedBy'))

  const baseMembership = {
    storeId: storeCode,
    uid,
    email: email ?? null,
    role,
    invitedBy,
    phone: membershipPhone,
    firstSignupEmail: membershipFirstSignupEmail,
    updatedAt: timestamp,
  }

  const membershipData = { ...baseMembership, ...(membershipSnap.exists ? {} : { createdAt: timestamp }) }
  const storeMemberData = { ...baseMembership, ...(storeMemberSnap.exists ? {} : { createdAt: timestamp }) }

  await Promise.all([
    membershipRef.set(membershipData, { merge: true }),
    storeMemberRef.set(storeMemberData, { merge: true }),
  ])

  const claims = await applyStoreClaims(uid, storeCode)
  return { ok: true, storeId: storeCode, claims }
})

// -----------------------------
// Callable: manageStaffAccount
// -----------------------------
export const manageStaffAccount = functions.https.onCall(async (data, context) => {
  const { storeId, email, role, password } = normalizeManageStaffPayload(data as ManageStaffPayload)
  assertOwnerAccess(context, storeId)

  const invitedBy = context.auth?.uid ?? null
  const { record, created } = await ensureAuthUser(email, password)

  await upsertStoreMembership(storeId, record.uid, email, role, invitedBy)
  const claims = await applyStoreClaims(record.uid)

  return {
    ok: true,
    storeId,
    role,
    email,
    uid: record.uid,
    created,
    claims,
  }
})

// -----------------------------
// Callable: commitSale
// -----------------------------
export const commitSale = functions.https.onCall(async (data, context) => {
  const { storeId, branchId, items, totals, cashierId, saleId: saleIdRaw, payment, customer } = data || {}
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required')
  const claims = context.auth.token as any
  if (!claims?.stores?.includes?.(storeId)) throw new functions.https.HttpsError('permission-denied', 'No store access')

  const saleId = typeof saleIdRaw === 'string' ? saleIdRaw.trim() : ''
  if (!saleId) throw new functions.https.HttpsError('invalid-argument', 'A valid saleId is required')

  const saleRef = db.collection('sales').doc(saleId)
  const saleItemsRef = db.collection('saleItems')

  await db.runTransaction(async tx => {
    const existingSale = await tx.get(saleRef)
    if (existingSale.exists) throw new functions.https.HttpsError('already-exists', 'Sale has already been committed')

    const normalizedItems = Array.isArray(items)
      ? items.map((it: any) => {
          const productId = typeof it?.productId === 'string' ? it.productId : null
          const name = typeof it?.name === 'string' ? it.name : null
          const qty = Number(it?.qty ?? 0) || 0
          const price = Number(it?.price ?? 0) || 0
          const taxRate = Number(it?.taxRate ?? 0) || 0
          return { productId, name, qty, price, taxRate }
        })
      : []

    tx.set(saleRef, {
      storeId,
      branchId: branchId ?? null,
      cashierId,
      total: totals?.total ?? 0,
      taxTotal: totals?.taxTotal ?? 0,
      payment: payment ?? null,
      customer: customer ?? null,
      items: normalizedItems,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    for (const it of normalizedItems) {
      if (!it.productId) {
        throw new functions.https.HttpsError('failed-precondition', 'Bad product')
      }
      const itemId = db.collection('_').doc().id
      tx.set(saleItemsRef.doc(itemId), {
        storeId,
        saleId,
        productId: it.productId,
        qty: it.qty,
        price: it.price,
        taxRate: it.taxRate,
      })

      const pRef = db.collection('products').doc(it.productId)
      const pSnap = await tx.get(pRef)
      if (!pSnap.exists || pSnap.get('storeId') !== storeId) {
        throw new functions.https.HttpsError('failed-precondition', 'Bad product')
      }
      const curr = pSnap.get('stockCount') || 0
      const next = curr - Math.abs(it.qty || 0)
      tx.update(pRef, { stockCount: next, updatedAt: admin.firestore.FieldValue.serverTimestamp() })

      const ledgerId = db.collection('_').doc().id
      tx.set(db.collection('ledger').doc(ledgerId), {
        storeId,
        branchId,
        productId: it.productId,
        qtyChange: -Math.abs(it.qty || 0),
        type: 'sale',
        refId: saleId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }
  })

  return { ok: true, saleId }
})

// -----------------------------
// Callable: receiveStock
// -----------------------------
export const receiveStock = functions.https.onCall(async (data, context) => {
  const { storeId, productId, qty, supplier, reference, unitCost } = data || {}
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required')
  const claims = context.auth.token as any
  if (!claims?.stores?.includes?.(storeId)) {
    throw new functions.https.HttpsError('permission-denied', 'No store access')
  }

  const productIdStr = typeof productId === 'string' ? productId : null
  if (!productIdStr) throw new functions.https.HttpsError('invalid-argument', 'A product must be selected')

  const amount = Number(qty)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Quantity must be greater than zero')
  }

  const normalizedSupplier = typeof supplier === 'string' ? supplier.trim() : ''
  if (!normalizedSupplier) throw new functions.https.HttpsError('invalid-argument', 'Supplier is required')

  const normalizedReference = typeof reference === 'string' ? reference.trim() : ''
  if (!normalizedReference) throw new functions.https.HttpsError('invalid-argument', 'Reference number is required')

  let normalizedUnitCost: number | null = null
  if (unitCost !== undefined && unitCost !== null && unitCost !== '') {
    const parsedCost = Number(unitCost)
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Cost must be zero or greater when provided')
    }
    normalizedUnitCost = parsedCost
  }

  const productRef = db.collection('products').doc(productIdStr)
  const receiptRef = db.collection('receipts').doc()
  const ledgerRef = db.collection('ledger').doc()

  await db.runTransaction(async tx => {
    const pSnap = await tx.get(productRef)
    if (!pSnap.exists || pSnap.get('storeId') !== storeId) {
      throw new functions.https.HttpsError('failed-precondition', 'Bad product')
    }

    const currentStock = Number(pSnap.get('stockCount') || 0)
    const nextStock = currentStock + amount
    const timestamp = admin.firestore.FieldValue.serverTimestamp()

    tx.update(productRef, {
      stockCount: nextStock,
      updatedAt: timestamp,
      lastReceivedAt: timestamp,
      lastReceivedQty: amount,
      lastReceivedCost: normalizedUnitCost,
    })

    const totalCost =
      normalizedUnitCost === null ? null : Math.round((normalizedUnitCost * amount + Number.EPSILON) * 100) / 100

    tx.set(receiptRef, {
      storeId,
      productId: productIdStr,
      qty: amount,
      supplier: normalizedSupplier,
      reference: normalizedReference,
      unitCost: normalizedUnitCost,
      totalCost,
      receivedBy: context.auth?.uid ?? null,
      createdAt: timestamp,
    })

    tx.set(ledgerRef, {
      storeId,
      productId: productIdStr,
      qtyChange: amount,
      type: 'receipt',
      refId: receiptRef.id,
      createdAt: timestamp,
    })
  })

  return { ok: true, receiptId: receiptRef.id }
})
