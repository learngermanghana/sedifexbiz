import { useEffect, useState } from 'react'
import { onAuthStateChanged, signOut, User } from 'firebase/auth'
import { auth } from './firebase'
import { fetchSheetRows, findUserRow, isContractActive } from './sheetClient'

export default function SheetAccessGuard({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user: User | null) => {
      setError(null)
      if (!user?.email) { setReady(true); return }
      try {
        const rows = await fetchSheetRows()
        const row = findUserRow(rows, user.email)
        if (!row) throw new Error('We could not find a workspace assignment for this account.')
        if (!row.storeId) throw new Error('Your account is missing a workspace store ID.')
        if (!isContractActive(row)) throw new Error('Your Sedifex workspace contract is not active.')
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('activeStoreId', row.storeId)
        }
        setReady(true)                           // allowed
      } catch (e: any) {
        setError(e?.message || 'Access denied.') // block
        await signOut(auth)
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('activeStoreId')
        }
        setReady(true)
      }
    })
    return () => unsub()
  }, [])

  if (!ready) return <p>Checking workspace access…</p>
  if (error) return <div role="alert">{error}</div>
  return <>{children}</>
}
