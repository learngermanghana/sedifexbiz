import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
} from 'firebase/firestore'

import { db } from '../firebase'

const TOP_LEVEL_COLLECTIONS: Array<{ name: string; field: string }> = [
  { name: 'activity', field: 'storeId' },
  { name: 'closeouts', field: 'storeId' },
  { name: 'customers', field: 'storeId' },
  { name: 'expenses', field: 'storeId' },
  { name: 'products', field: 'storeId' },
  { name: 'sales', field: 'storeId' },
  { name: 'staffAudit', field: 'storeId' },
  { name: 'supportTickets', field: 'storeId' },
  { name: 'teamMembers', field: 'storeId' },
]

const WORKSPACE_SUBCOLLECTIONS = ['sales']

async function deleteCollectionByStoreId(
  collectionName: string,
  storeId: string,
  fieldName: string,
): Promise<number> {
  const ref = collection(db, collectionName)
  const snapshot = await getDocs(query(ref, where(fieldName, '==', storeId)))
  await Promise.all(
    snapshot.docs.map(async entry => {
      await deleteDoc(doc(db, collectionName, entry.id))
    }),
  )
  return snapshot.size
}

async function deleteWorkspaceNestedData(storeId: string): Promise<number> {
  let deleted = 0

  for (const subCollection of WORKSPACE_SUBCOLLECTIONS) {
    const nestedRef = collection(db, 'workspaces', storeId, subCollection)
    const snapshot = await getDocs(nestedRef)
    await Promise.all(
      snapshot.docs.map(async entry => {
        await deleteDoc(doc(db, 'workspaces', storeId, subCollection, entry.id))
      }),
    )
    deleted += snapshot.size
  }

  await deleteDoc(doc(db, 'workspaces', storeId)).catch(error => {
    console.warn('[data-deletion] Unable to delete workspaces doc', error)
  })

  return deleted
}

async function deleteStoreDocuments(storeId: string): Promise<number> {
  let deleted = 0

  for (const { name, field } of TOP_LEVEL_COLLECTIONS) {
    deleted += await deleteCollectionByStoreId(name, storeId, field)
  }

  const fallbackQuery = query(
    collection(db, 'stores'),
    where('ownerId', '==', storeId),
  )
  const fallbackSnapshot = await getDocs(fallbackQuery)
  await Promise.all(
    fallbackSnapshot.docs.map(async entry => {
      await deleteDoc(doc(db, 'stores', entry.id))
    }),
  )
  deleted += fallbackSnapshot.size

  await deleteDoc(doc(db, 'stores', storeId)).catch(() => {
    // ignore if already removed by fallback query
  })

  return deleted
}

export async function deleteWorkspaceData(storeId: string): Promise<number> {
  if (!storeId.trim()) {
    throw new Error('storeId is required to delete workspace data')
  }

  let deletedCount = 0

  deletedCount += await deleteStoreDocuments(storeId)
  deletedCount += await deleteWorkspaceNestedData(storeId)

  return deletedCount
}
