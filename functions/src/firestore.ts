import * as admin from 'firebase-admin'
import { getFirestore } from 'firebase-admin/firestore'

if (!admin.apps.length) {
  admin.initializeApp()
}

const app = admin.app()

export const defaultDb = getFirestore(app)
export const rosterDb = getFirestore(app, 'roster')

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
