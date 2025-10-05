import * as admin from 'firebase-admin'
import { getFirestore } from 'firebase-admin/firestore'

if (!admin.apps.length) {
  admin.initializeApp()
}

export const defaultDb = getFirestore()
export const rosterDb = getFirestore(admin.app(), 'roster')

export const supabaseAdmin = {
  from() {
    throw new Error('Supabase admin client is not configured')
  },
  auth: {
    admin: {
      updateUserById() {
        throw new Error('Supabase admin client is not configured')
      },
    },
  },
} as any

export { admin }
