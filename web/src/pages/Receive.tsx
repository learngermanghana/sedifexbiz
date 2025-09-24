import React, { useEffect, useMemo, useState } from 'react'
import { collection, query, where, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore'
import { db, auth } from '../firebase'
import './Receive.css'

type Product = { id: string; name: string; stockCount?: number; storeId: string }

export default function Receive() {
  const user = auth.currentUser
  const STORE_ID = useMemo(() => user?.uid || null, [user?.uid])

  const [products, setProducts] = useState<Product[]>([])
  const [selected, setSelected] = useState<string>('')
  const [qty, setQty] = useState<string>('')

  useEffect(() => {
    if (!STORE_ID) return
    const q = query(collection(db,'products'), where('storeId','==',STORE_ID), orderBy('name'))
    return onSnapshot(q, snap => setProducts(snap.docs.map(d=>({id:d.id, ...(d.data() as any)}))))
  }, [STORE_ID])

  async function receive() {
    if (!selected || qty === '') return
    const p = products.find(x=>x.id===selected); if (!p) return
    await updateDoc(doc(db,'products', selected), { stockCount: (p.stockCount || 0) + Number(qty) })
    setQty('')
  }

  if (!STORE_ID) return <div>Loading…</div>

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
              disabled={!selected || !qty}
            >
              Add stock
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
