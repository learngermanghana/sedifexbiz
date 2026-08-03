import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from '../firestore'

type SaleLine = {
  productId?: unknown
  qty?: unknown
  quantity?: unknown
  type?: unknown
  isService?: unknown
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

async function assertOwner(uid: string, storeId: string) {
  const direct = await defaultDb.collection('teamMembers').doc(uid).get()
  if (direct.exists && text(direct.get('storeId')) === storeId && text(direct.get('role')).toLowerCase() === 'owner') {
    return
  }

  const matches = await defaultDb.collection('teamMembers').where('uid', '==', uid).where('storeId', '==', storeId).limit(5).get()
  if (matches.docs.some(member => text(member.get('role')).toLowerCase() === 'owner')) return

  throw new functions.https.HttpsError('permission-denied', 'Only a workspace owner can void a sale')
}

/**
 * Voids a completed POS sale without deleting its audit history. Inventory is
 * restored and a reversing ledger entry is written in the same transaction.
 */
export const voidSale = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required')

  const storeId = text(data?.storeId)
  const saleId = text(data?.saleId)
  const reason = text(data?.reason)
  if (!storeId || !saleId) throw new functions.https.HttpsError('invalid-argument', 'Workspace and sale are required')
  if (reason.length < 5 || reason.length > 500) {
    throw new functions.https.HttpsError('invalid-argument', 'Enter a correction reason between 5 and 500 characters')
  }

  await assertOwner(context.auth.uid, storeId)

  const saleRef = defaultDb.collection('sales').doc(saleId)
  const now = admin.firestore.FieldValue.serverTimestamp()

  await defaultDb.runTransaction(async tx => {
    const saleSnap = await tx.get(saleRef)
    if (!saleSnap.exists) throw new functions.https.HttpsError('not-found', 'Sale not found')
    if (text(saleSnap.get('storeId') ?? saleSnap.get('branchId')) !== storeId) {
      throw new functions.https.HttpsError('permission-denied', 'Sale does not belong to this workspace')
    }
    if (text(saleSnap.get('status')).toLowerCase() === 'voided') {
      throw new functions.https.HttpsError('already-exists', 'This sale has already been voided')
    }

    const items = Array.isArray(saleSnap.get('items')) ? saleSnap.get('items') as SaleLine[] : []
    const restoreByProduct = new Map<string, number>()
    for (const item of items) {
      const productId = text(item.productId)
      const itemType = text(item.type).toLowerCase()
      if (!productId || item.isService === true || itemType === 'service') continue
      const quantity = positiveNumber(item.qty ?? item.quantity)
      if (quantity) restoreByProduct.set(productId, (restoreByProduct.get(productId) ?? 0) + quantity)
    }

    const productSnapshots = new Map<string, FirebaseFirestore.DocumentSnapshot>()
    for (const productId of restoreByProduct.keys()) {
      const productRef = defaultDb.collection('products').doc(productId)
      productSnapshots.set(productId, await tx.get(productRef))
    }

    for (const [productId, quantity] of restoreByProduct) {
      const productRef = defaultDb.collection('products').doc(productId)
      const productSnap = productSnapshots.get(productId)
      if (!productSnap?.exists) {
        throw new functions.https.HttpsError('failed-precondition', `Cannot restore missing product ${productId}`)
      }
      const productStoreId = text(productSnap.get('storeId'))
      if (productStoreId && productStoreId !== storeId) {
        throw new functions.https.HttpsError('failed-precondition', `Product ${productId} belongs to another workspace`)
      }

      tx.update(productRef, {
        stockCount: Number(productSnap.get('stockCount') ?? 0) + quantity,
        updatedAt: now,
      })
      tx.set(defaultDb.collection('ledger').doc(), {
        productId,
        qtyChange: quantity,
        type: 'sale_void',
        refId: saleId,
        storeId,
        reason,
        createdAt: now,
        createdBy: context.auth?.uid ?? null,
      })
    }

    tx.update(saleRef, {
      status: 'voided',
      voidReason: reason,
      voidedAt: now,
      voidedBy: context.auth?.uid ?? null,
      updatedAt: now,
    })
    tx.set(defaultDb.collection('activity').doc(), {
      storeId,
      type: 'sale.voided',
      summary: 'POS sale voided',
      detail: `Sale ${saleId} was voided: ${reason}`,
      actor: context.auth?.token.email ?? context.auth?.uid ?? 'Owner',
      refId: saleId,
      createdAt: now,
    })
  })

  return { ok: true, saleId, status: 'voided' }
})
