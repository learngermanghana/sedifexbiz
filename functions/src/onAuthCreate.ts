import * as functions from 'firebase-functions'
import { getPersistence } from './persistence'

export const onAuthCreate = functions.auth.user().onCreate(async user => {
  const uid = user.uid
  const adapter = getPersistence()
  const fallbackStoreId = uid

  const existing = await adapter.getTeamMember(uid)
  const storeId = existing?.storeId ?? fallbackStoreId

  await adapter.upsertTeamMember({
    uid,
    storeId,
    role: existing?.role ?? 'owner',
    email: user.email ?? existing?.email ?? null,
    phone: user.phoneNumber ?? existing?.phone ?? null,
  })
})
