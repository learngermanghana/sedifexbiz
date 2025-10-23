// web/src/pages/Products.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
  collection,
  onSnapshot,
  query,
  db,
  where,
  type QuerySnapshot,
  type Timestamp,
  type DocumentData,
} from '../lib/db'
import { useActiveStore } from '../hooks/useActiveStore'
import { useToast } from '../components/ToastProvider'

type ProductDoc = {
  name?: string
  sku?: string | null
  price?: number | null
  cost?: number | null
  stockQty?: number | null
  category?: string | null
  description?: string | null
  imageUrl?: string | null
  active?: boolean | null
  storeId: string
  updatedAt?: Timestamp
}

type ProductRecord = ProductDoc & { id: string }

function formatCurrency(value: number | null | undefined, formatter: Intl.NumberFormat) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—'
  }
  return formatter.format(value)
}

function formatStock(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—'
  }
  if (!Number.isFinite(value)) {
    return '—'
  }
  return value.toLocaleString()
}

function getStatusBadge(product: ProductRecord) {
  if (!product.active) {
    return <span className="badge badge--out">Inactive</span>
  }

  if (typeof product.stockQty === 'number') {
    if (product.stockQty <= 0) {
      return <span className="badge badge--out">Out of stock</span>
    }
    if (product.stockQty < 5) {
      return <span className="badge badge--low">Low stock</span>
    }
  }

  return <span className="badge badge--ok">Available</span>
}

function formatUpdatedAt(updatedAt?: Timestamp) {
  if (!updatedAt) {
    return '—'
  }
  const date = updatedAt.toDate()
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function Products(): React.ReactElement {
  const { storeId, isLoading: storeLoading } = useActiveStore()
  const { pushToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<ProductRecord[]>([])

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'GHS',
        minimumFractionDigits: 2,
      }),
    [],
  )

  useEffect(() => {
    if (!storeId) {
      setProducts([])
      setLoading(false)
      return
    }

    setLoading(true)

    const productsQuery = query(collection(db, 'products'), where('storeId', '==', storeId))

    const unsubscribe = onSnapshot(
      productsQuery,
      (snapshot: QuerySnapshot<DocumentData>) => {
        const items: ProductRecord[] = snapshot.docs.map(doc => {
          const data = doc.data() as ProductDoc
          return {
            id: doc.id,
            ...data,
          }
        })
        items.sort((a, b) => {
          const nameA = (a.name ?? '').toLocaleLowerCase()
          const nameB = (b.name ?? '').toLocaleLowerCase()
          return nameA.localeCompare(nameB)
        })
        setProducts(items)
        setLoading(false)
      },
      error => {
        console.error('[products] Failed to load products', error)
        pushToast({ type: 'error', message: 'We could not load products for this workspace.' })
        setLoading(false)
      },
    )

    return () => unsubscribe()
  }, [pushToast, storeId])

  if (storeLoading && loading) {
    return (
      <div className="page">
        <p>Loading workspace…</p>
      </div>
    )
  }

  if (!storeId) {
    return (
      <div className="page">
        <header className="page__header">
          <div>
            <h1 className="page__title">Products</h1>
            <p className="page__subtitle">Select a workspace to view inventory.</p>
          </div>
        </header>
        <section className="card">
          <div className="empty-state">
            <p>No workspace selected.</p>
            <p>Choose a workspace from the switcher above to see products.</p>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Products</h1>
          <p className="page__subtitle">Track inventory, pricing, and availability across your stores.</p>
        </div>
      </header>

      <section className="card card--flush">
        {loading ? (
          <div className="empty-state">
            <p>Loading products…</p>
          </div>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <p>No products yet.</p>
            <p>Products you add to your workspace will appear here.</p>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table" role="grid">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Category</th>
                  <th scope="col">Price</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {products.map(product => (
                  <tr key={product.id}>
                    <td>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <span style={{ fontWeight: 600 }}>
                          {product.name ?? 'Untitled product'}
                        </span>
                        {product.sku ? (
                          <span style={{ fontSize: 12, color: '#64748b' }}>SKU: {product.sku}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>{product.category ?? '—'}</td>
                    <td>{formatCurrency(product.price, currencyFormatter)}</td>
                    <td>{formatCurrency(product.cost, currencyFormatter)}</td>
                    <td>{formatStock(product.stockQty)}</td>
                    <td>{getStatusBadge(product)}</td>
                    <td>{formatUpdatedAt(product.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
