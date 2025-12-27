import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from '../firestore'

const VALID_ROLES = new Set(['owner', 'staff'])

function getRoleFromToken(token: Record<string, unknown> | undefined) {
  const role = typeof token?.role === 'string' ? (token.role as string) : null
  return role && VALID_ROLES.has(role) ? (role as 'owner' | 'staff') : null
}

function assertStaffAccess(context: functions.https.CallableContext) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required')
  }

  const role = getRoleFromToken(context.auth.token as Record<string, unknown>)
  if (!role) {
    throw new functions.https.HttpsError('permission-denied', 'Staff access required')
  }
}

export const receiveStock = functions.https.onCall(async (data, context) => {
  assertStaffAccess(context)

  const { productId, qty, supplier, reference, unitCost } = data || {}
  const productIdStr = typeof productId === 'string' ? productId : null
  if (!productIdStr) {
    throw new functions.https.HttpsError('invalid-argument', 'A product must be selected')
  }

  const amount = Number(qty)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Quantity must be greater than zero')
  }

  const normalizedSupplier = typeof supplier === 'string' ? supplier.trim() : ''
  if (!normalizedSupplier) {
    throw new functions.https.HttpsError('invalid-argument', 'Supplier is required')
  }

  const normalizedReference = typeof reference === 'string' ? reference.trim() : ''
  if (!normalizedReference) {
    throw new functions.https.HttpsError('invalid-argument', 'Reference number is required')
  }

  let normalizedUnitCost: number | null = null
  if (unitCost !== undefined && unitCost !== null && unitCost !== '') {
    const parsedCost = Number(unitCost)
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Cost must be zero or greater when provided',
      )
    }
    normalizedUnitCost = parsedCost
  }

  const productRef = defaultDb.collection('products').doc(productIdStr)
  const receiptRef = defaultDb.collection('receipts').doc()
  const ledgerRef = defaultDb.collection('ledger').doc()

  await defaultDb.runTransaction(async tx => {
    const pSnap = await tx.get(productRef)
    if (!pSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Bad product')
    }

    const productStoreIdRaw = pSnap.get('storeId')
    const productStoreId =
      typeof productStoreIdRaw === 'string' ? productStoreIdRaw.trim() : null

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
      normalizedUnitCost === null
        ? null
        : Math.round((normalizedUnitCost * amount + Number.EPSILON) * 100) / 100

    tx.set(receiptRef, {
      productId: productIdStr,
      qty: amount,
      supplier: normalizedSupplier,
      reference: normalizedReference,
      unitCost: normalizedUnitCost,
      totalCost,
      receivedBy: context.auth?.uid ?? null,
      createdAt: timestamp,
      storeId: productStoreId,
    })

    tx.set(ledgerRef, {
      productId: productIdStr,
      qtyChange: amount,
      type: 'receipt',
      refId: receiptRef.id,
      storeId: productStoreId,
      createdAt: timestamp,
    })
  })

  return { ok: true, receiptId: receiptRef.id }
})
