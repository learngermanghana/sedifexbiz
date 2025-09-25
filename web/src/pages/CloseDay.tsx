import React, { useEffect, useState } from 'react'
import { collection, query, where, orderBy, onSnapshot, Timestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'

type Sale = { total: number; createdAt?: any; storeId: string }

export default function CloseDay() {
  const { storeId: STORE_ID, isLoading: storeLoading, error: storeError } = useActiveStore()

  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!STORE_ID) return
    const start = new Date(); start.setHours(0,0,0,0)
    const q = query(
      collection(db,'sales'),
      where('storeId','==',STORE_ID),
      where('createdAt','>=', Timestamp.fromDate(start)),
      orderBy('createdAt','desc')
    )
    return onSnapshot(q, snap => {
      let sum = 0
      snap.forEach(d => sum += (d.data().total || 0))
      setTotal(sum)
    })
  }, [STORE_ID])

  if (storeLoading) return <div>Loading…</div>
  if (!STORE_ID) return <div>We were unable to determine your store access. Please sign out and back in.</div>

  return (
    <div>
      <h2 style={{color:'#4338CA'}}>Close Day</h2>
      {storeError && <p style={{ color: '#b91c1c' }}>{storeError}</p>}
      <p>Today’s sales total</p>
      <div style={{fontSize:32, fontWeight:800}}>GHS {total.toFixed(2)}</div>
      <p style={{marginTop:12}}>Next: cash count & variance sheet.</p>
    </div>
  )
}
