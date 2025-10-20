import { getFirestore } from 'firebase/firestore'

import { app } from '../firebase'

export const db = getFirestore(app)
export const rosterDb = getFirestore(app, 'roster')

export * from 'firebase/firestore'
