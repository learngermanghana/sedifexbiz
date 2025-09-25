import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
admin.initializeApp()
const db = admin.firestore()

export const commitSale = functions.https.onCall(async (data, context) => {
  const { storeId, branchId, items, totals, cashierId, saleId, payment, customer } = data || {}
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required')
  const claims = context.auth.token as any
  if (!claims?.stores?.includes?.(storeId)) throw new functions.https.HttpsError('permission-denied', 'No store access')

  const saleRef = db.collection('sales').doc(saleId)
  const saleItemsRef = db.collection('saleItems')

  await db.runTransaction(async (tx) => {
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
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    })

    for (const it of normalizedItems) {
      if (!it.productId) {
        throw new functions.https.HttpsError('failed-precondition', 'Bad product')
      }
      const itemId = db.collection('_').doc().id
      tx.set(saleItemsRef.doc(itemId), {
        storeId, saleId, productId: it.productId, qty: it.qty, price: it.price, taxRate: it.taxRate
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
        storeId, branchId, productId: it.productId, qtyChange: -Math.abs(it.qty || 0),
        type: 'sale', refId: saleId, createdAt: admin.firestore.FieldValue.serverTimestamp()
      })
    }
  })

  return { ok: true, saleId }
})

export const receiveStock = functions.https.onCall(async (data, context) => {
  const { storeId, productId, qty, supplier, reference, unitCost } = data || {}
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required')
  const claims = context.auth.token as any
  if (!claims?.stores?.includes?.(storeId)) {
    throw new functions.https.HttpsError('permission-denied', 'No store access')
  }

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
      throw new functions.https.HttpsError('invalid-argument', 'Cost must be zero or greater when provided')
    }
    normalizedUnitCost = parsedCost
  }

  const productRef = db.collection('products').doc(productIdStr)
  const receiptRef = db.collection('receipts').doc()
  const ledgerRef = db.collection('ledger').doc()

  await db.runTransaction(async (tx) => {
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
      lastReceivedCost: normalizedUnitCost
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
      createdAt: timestamp
    })

    tx.set(ledgerRef, {
      storeId,
      productId: productIdStr,
      qtyChange: amount,
      type: 'receipt',
      refId: receiptRef.id,
      createdAt: timestamp
    })
  })

  return { ok: true, receiptId: receiptRef.id }
})
