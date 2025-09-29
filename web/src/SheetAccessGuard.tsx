import { useEffect, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signOut, User } from 'firebase/auth'
import { auth } from './firebase'
import { fetchSheetRows, findUserRow, isContractActive } from './sheetClient'
import { setPersistedActiveStoreId } from './utils/activeStore'

export default function SheetAccessGuard({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user: User | null) => {
      if (!user?.email) { setReady(true); return }
      setError(null)
      try {
        const rows = await fetchSheetRows()
        const row = findUserRow(rows, user.email)
        if (!row) throw new Error('We could not find a workspace assignment for this account.')
        if (!row.storeId) throw new Error('Your account is missing a workspace store ID.')
        if (!isContractActive(row)) throw new Error('Your Sedifex workspace contract is not active.')
        setPersistedActiveStoreId(row.storeId)
        setReady(true)                           // allowed
      } catch (e: any) {
        setError(e?.message || 'Access denied.') // block
        await signOut(auth)
        setPersistedActiveStoreId(null)
        setReady(true)
      }
    })
    return () => unsub()
  }, [])

  if (!ready) return <p>Checking workspace access…</p>
  return (
    <>
      {error ? <div role="alert">{error}</div> : null}
      {children}
    </>
  )
}
