// web/src/pages/ProductEdit.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  doc,
  getDoc,
  rosterDb,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  type Timestamp,
} from '../lib/db'
import { useActiveStore } from '../hooks/useActiveStore'
import { useToast } from '../components/ToastProvider'
import './form.css'

type ProductDoc = {
  name: string
  sku?: string | null
  price?: number
  cost?: number
  stockQty?: number
  category?: string | null
  imageUrl?: string | null
  description?: string | null
  active?: boolean
  storeId: string
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

type Form = {
  name: string
  sku: string
  price: string
  cost: string
  stockQty: string
  category: string
  imageUrl: string
  description: string
  active: boolean
}

export default function ProductEdit() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const { storeId } = useActiveStore()
  const { pushToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [initial, setInitial] = useState<ProductDoc | null>(null)
  const [values, setValues] = useState<Form>({
    name: '',
    sku: '',
    price: '',
    cost: '',
    stockQty: '',
    category: '',
    imageUrl: '',
    description: '',
    active: true,
  })

  const canEdit = useMemo(() => {
    if (!initial || !storeId) return false
    return initial.storeId === storeId
  }, [initial, storeId])

  useEffect(() => {
    if (!id) return
    ;(async () => {
      try {
        setLoading(true)
        const ref = doc(rosterDb, 'products', id)
        const snap = await getDoc(ref)
        if (!snap.exists()) {
          pushToast({ type: 'error', message: 'Product not found' })
          nav('/products')
          return
        }
        const data = snap.data() as ProductDoc
        setInitial(data)
        setValues({
          name: data.name ?? '',
          sku: data.sku ?? '',
          price: (typeof data.price === 'number' ? String(data.price) : '') ?? '',
          cost: (typeof data.cost === 'number' ? String(data.cost) : '') ?? '',
          stockQty: (typeof data.stockQty === 'number' ? String(data.stockQty) : '') ?? '',
          category: data.category ?? '',
          imageUrl: data.imageUrl ?? '',
          description: data.description ?? '',
          active: !!data.active,
        })
      } catch (e: any) {
        console.error(e)
        pushToast({ type: 'error', message: e?.message || 'Failed to load product' })
      } finally {
        setLoading(false)
      }
    })()
  }, [id, nav, pushToast])

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type, checked } = e.target as any
    setValues(prev => ({ ...prev, [name]: type === 'checkbox' ? !!checked : value }))
  }

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    if (!canEdit) {
      pushToast({ type: 'error', message: 'You do not have access to edit this product.' })
      return
    }

    try {
      setSaving(true)
      const ref = doc(rosterDb, 'products', id)
      await updateDoc(ref, {
        name: values.name.trim(),
        sku: values.sku.trim() || null,
        price: values.price ? Number(values.price) : 0,
        cost: values.cost ? Number(values.cost) : 0,
        stockQty: values.stockQty ? Number(values.stockQty) : 0,
        category: values.category.trim() || null,
        imageUrl: values.imageUrl.trim() || null,
        description: values.description.trim() || null,
        active: !!values.active,
        updatedAt: serverTimestamp(),
      })
      pushToast({ type: 'success', message: 'Product updated' })
    } catch (e: any) {
      console.error(e)
      pushToast({ type: 'error', message: e?.message || 'Update failed' })
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!id) return
    if (!canEdit) {
      pushToast({ type: 'error', message: 'You do not have access to delete this product.' })
      return
    }
    if (!window.confirm('Delete this product? This cannot be undone.')) return
    try {
      await deleteDoc(doc(rosterDb, 'products', id))
      pushToast({ type: 'success', message: 'Product deleted' })
      nav('/products')
    } catch (e: any) {
      console.error(e)
      pushToast({ type: 'error', message: e?.message || 'Delete failed' })
    }
  }

  if (loading) {
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    )
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <h1 className="title" style={{ margin: 0 }}>Edit Product</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem' }}>
          <Link to="/products" style={{ textDecoration: 'none' }}>← Back to list</Link>
          <button
            onClick={onDelete}
            style={{ padding: '.5rem .9rem', borderRadius: 8, border: '1px solid #eee', cursor: 'pointer' }}
          >
            Delete
          </button>
        </div>
      </div>

      {!canEdit ? (
        <div style={{ color: '#b00' }}>
          You don’t have permission to edit this product in the current workspace.
        </div>
      ) : (
        <form className="form" onSubmit={onSave}>
          <div className="grid">
            <label>
              <span>Name *</span>
              <input name="name" required value={values.name} onChange={onChange} />
            </label>
            <label>
              <span>SKU</span>
              <input name="sku" value={values.sku} onChange={onChange} />
            </label>
            <label>
              <span>Price</span>
              <input name="price" type="number" step="0.01" value={values.price} onChange={onChange} />
            </label>
            <label>
              <span>Cost</span>
              <input name="cost" type="number" step="0.01" value={values.cost} onChange={onChange} />
            </label>
            <label>
              <span>Stock Qty</span>
              <input name="stockQty" type="number" step="1" value={values.stockQty} onChange={onChange} />
            </label>
            <label>
              <span>Category</span>
              <input name="category" value={values.category} onChange={onChange} />
            </label>
            <label>
              <span>Image URL</span>
              <input name="imageUrl" value={values.imageUrl} onChange={onChange} placeholder="https://…" />
            </label>
            <label className="row">
              <input name="active" type="checkbox" checked={values.active} onChange={onChange} />
              <span>Active</span>
            </label>
            <label className="col-span">
              <span>Description</span>
              <textarea name="description" rows={4} value={values.description} onChange={onChange} />
            </label>
          </div>

          <div className="actions">
            <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </form>
      )}
    </div>
  )
}
