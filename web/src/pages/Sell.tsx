import React, { useEffect, useMemo, useState } from 'react'
import { collection, query, where, orderBy, onSnapshot, doc, writeBatch, addDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from '../firebase'
import './Sell.css'

type Product = { id: string; name: string; price: number; stockCount?: number; storeId: string }
type CartLine = { productId: string; name: string; price: number; qty: number }

export default function Sell() {
  const user = auth.currentUser
  const STORE_ID = useMemo(() => user?.uid || null, [user?.uid])

  const [products, setProducts] = useState<Product[]>([])
  const [queryText, setQueryText] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0)

  useEffect(() => {
    if (!STORE_ID) return
    const q = query(collection(db,'products'), where('storeId','==',STORE_ID), orderBy('name'))
    return onSnapshot(q, snap => {
      setProducts(snap.docs.map(d => ({ id:d.id, ...(d.data() as any) })))
    })
  }, [STORE_ID])

  function addToCart(p: Product) {
    setCart(cs => {
      const i = cs.findIndex(x => x.productId === p.id)
      if (i >= 0) {
        const copy = [...cs]; copy[i] = { ...copy[i], qty: copy[i].qty + 1 }; return copy
      }
      return [...cs, { productId: p.id, name: p.name, price: p.price, qty: 1 }]
    })
  }
  function setQty(id: string, qty: number) {
    setCart(cs => cs.map(l => l.productId === id ? { ...l, qty: Math.max(0, qty) } : l).filter(l => l.qty > 0))
  }
  async function recordSale() {
    if (!STORE_ID || cart.length === 0) return
    // 1) write a sale with items array
    const saleRef = await addDoc(collection(db, 'sales'), {
      storeId: STORE_ID,
      createdAt: serverTimestamp(),
      items: cart,
      total: subtotal
    })
    // 2) decrement stock with a batch
    const batch = writeBatch(db)
    cart.forEach(line => {
      const pRef = doc(db,'products', line.productId)
      const p = products.find(x=>x.id===line.productId)
      const next = Math.max(0, (p?.stockCount || 0) - line.qty)
      batch.update(pRef, { stockCount: next })
    })
    await batch.commit()
    setCart([])
    alert(`Sale recorded #${saleRef.id}`)
  }

  if (!STORE_ID) return <div>Loading…</div>

  const filtered = products.filter(p => p.name.toLowerCase().includes(queryText.toLowerCase()))

  return (
    <div className="page sell-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Sell</h2>
          <p className="page__subtitle">Build a cart from your product list and record the sale in seconds.</p>
        </div>
        <div className="sell-page__total" aria-live="polite">
          <span className="sell-page__total-label">Subtotal</span>
          <span className="sell-page__total-value">GHS {subtotal.toFixed(2)}</span>
        </div>
      </header>

      <section className="card">
        <div className="field">
          <label className="field__label" htmlFor="sell-search">Find a product</label>
          <input
            id="sell-search"
            placeholder="Search by name"
            value={queryText}
            onChange={e => setQueryText(e.target.value)}
          />
          <p className="field__hint">Tip: start typing and tap a product to add it to the cart.</p>
        </div>
      </section>

      <div className="sell-page__grid">
        <section className="card sell-page__catalog" aria-label="Product list">
          <div className="sell-page__section-header">
            <h3 className="card__title">Products</h3>
            <p className="card__subtitle">{filtered.length} items available to sell.</p>
          </div>
          <div className="sell-page__catalog-list">
            {filtered.length ? (
              filtered.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className="sell-page__product"
                  onClick={() => addToCart(p)}
                >
                  <div>
                    <span className="sell-page__product-name">{p.name}</span>
                    <span className="sell-page__product-meta">GHS {p.price.toFixed(2)} • Stock {p.stockCount ?? 0}</span>
                  </div>
                  <span className="sell-page__product-action">Add</span>
                </button>
              ))
            ) : (
              <div className="empty-state">
                <h3 className="empty-state__title">No products found</h3>
                <p>Try a different search term or add new inventory from the products page.</p>
              </div>
            )}
          </div>
        </section>

        <section className="card sell-page__cart" aria-label="Cart">
          <div className="sell-page__section-header">
            <h3 className="card__title">Cart</h3>
            <p className="card__subtitle">Adjust quantities before recording the sale.</p>
          </div>

          {cart.length ? (
            <>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col" className="sell-page__numeric">Qty</th>
                      <th scope="col" className="sell-page__numeric">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map(line => (
                      <tr key={line.productId}>
                        <td>{line.name}</td>
                        <td className="sell-page__numeric">
                          <input
                            className="input--inline input--align-right"
                            type="number"
                            min={0}
                            value={line.qty}
                            onChange={e => setQty(line.productId, Number(e.target.value))}
                          />
                        </td>
                        <td className="sell-page__numeric">GHS {(line.price * line.qty).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="sell-page__summary">
                <span>Total</span>
                <strong>GHS {subtotal.toFixed(2)}</strong>
              </div>

              <button
                type="button"
                className="button button--primary button--block"
                onClick={recordSale}
                disabled={cart.length === 0}
              >
                Record sale
              </button>
            </>
          ) : (
            <div className="empty-state">
              <h3 className="empty-state__title">Cart is empty</h3>
              <p>Select products from the list to start a new sale.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
