import React, { useEffect, useRef, useState } from 'react'
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './Receive.css'

type Product = { id: string; name: string; stockCount?: number; storeId: string }

export default function Receive() {
  const { storeId: STORE_ID, isLoading: storeLoading, error: storeError } = useActiveStore()

  const [products, setProducts] = useState<Product[]>([])
  const [selected, setSelected] = useState<string>('')
  const [qty, setQty] = useState<string>('')
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const statusTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        window.clearTimeout(statusTimeoutRef.current)
        statusTimeoutRef.current = null
      }
    }
  }, [])

  function showStatus(tone: 'success' | 'error', message: string) {
    setStatus({ tone, message })
    if (statusTimeoutRef.current) {
      window.clearTimeout(statusTimeoutRef.current)
    }
    statusTimeoutRef.current = window.setTimeout(() => {
      setStatus(null)
      statusTimeoutRef.current = null
    }, 4000)
  }

  useEffect(() => {
    if (!STORE_ID) return
    const q = query(collection(db,'products'), where('storeId','==',STORE_ID), orderBy('name'))
    return onSnapshot(q, snap => setProducts(snap.docs.map(d=>({id:d.id, ...(d.data() as any)}))))
  }, [STORE_ID])

  async function receive() {
    if (!STORE_ID) {
      showStatus('error', 'Store access is not ready. Please refresh and try again.')
      return
    }
    if (!selected || qty === '') return
    const p = products.find(x=>x.id===selected); if (!p) return
    const amount = Number(qty)
    if (!Number.isFinite(amount) || amount <= 0) {
      showStatus('error', 'Enter a valid quantity greater than zero.')
      return
    }
    setBusy(true)
    try {
      await updateDoc(doc(db,'products', selected), { stockCount: (p.stockCount || 0) + amount })
      setQty('')
      showStatus('success', 'Stock received successfully.')
    } catch (error) {
      console.error('[receive] Failed to update stock', error)
      showStatus('error', 'Unable to record stock receipt. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (storeLoading) return <div>Loading…</div>
  if (!STORE_ID) return <div>We were unable to determine your store access. Please sign out and back in.</div>

  return (
    <div className="page receive-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Receive stock</h2>
          <p className="page__subtitle">Log deliveries against your Firestore inventory so shelves stay replenished.</p>
        </div>
      </header>

      <section className="card receive-page__card">
        <div className="receive-page__form">
          <div className="field">
            <label className="field__label" htmlFor="receive-product">Product</label>
            <select
              id="receive-product"
              value={selected}
              onChange={e => setSelected(e.target.value)}
            >
              <option value="">Select product…</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} (Stock {p.stockCount ?? 0})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="receive-qty">Quantity received</label>
            <input
              id="receive-qty"
              type="number"
              min={1}
              placeholder="0"
              value={qty}
              onChange={e => setQty(e.target.value)}
            />
          </div>
          <div className="receive-page__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={receive}
              disabled={!selected || !qty || busy}
            >
              Add stock
            </button>
          </div>
          {status && (
            <p
              className={`receive-page__message receive-page__message--${status.tone}`}
              role={status.tone === 'error' ? 'alert' : 'status'}
            >
              {status.message}
            </p>
          )}
          {storeError && (
            <p className="receive-page__message receive-page__message--error" role="alert">{storeError}</p>
          )}
        </div>
      </section>
    </div>
  )
}
