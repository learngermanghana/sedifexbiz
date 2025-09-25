import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'

export type ActivityAction = 'update' | 'delete'

export type RecordActivityParams = {
  storeId: string
  entity: string
  entityId: string
  action: ActivityAction
  actorId: string
  actorEmail?: string | null
}

export async function recordActivity(params: RecordActivityParams) {
  const { storeId, entity, entityId, action, actorId, actorEmail } = params

  const payload: Record<string, unknown> = {
    storeId,
    entity,
    entityId,
    action,
    actorId,
    performedAt: serverTimestamp(),
  }

  if (actorEmail) {
    payload.actorEmail = actorEmail
  }

  await addDoc(collection(db, 'activities'), payload)
}
