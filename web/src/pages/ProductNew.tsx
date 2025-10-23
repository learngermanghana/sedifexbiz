// web/src/pages/ProductNew.tsx
import React, { useState } from 'react'
import { addDoc, collection, serverTimestamp, db } from '../lib/db'
import { useActiveStore } from '../hooks/useActiveStore'
import { useToast } from '../components/ToastProvider'
import './form.css'

type ProductForm = {
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

export default function ProductNew() {
  const { storeId } = useActiveStore()
  const { pushToast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [values, setValues] = useState<ProductForm>({
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

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type, checked } = e.target as any
    setValues(prev => ({ ...prev, [name]: type === 'checkbox' ? !!checked : value }))
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!storeId) {
      pushToast({ type: 'error', message: 'No active workspace selected.' })
      return
    }
    try {
      setIsSaving(true)
      const payload = {
        name: values.name.trim(),
        sku: values.sku.trim() || null,
        price: values.price ? Number(values.price) : 0,
        cost: values.cost ? Number(values.cost) : 0,
        stockQty: values.stockQty ? Number(values.stockQty) : 0,
        category: values.category.trim() || null,
        imageUrl: values.imageUrl.trim() || null,
        description: values.description.trim() || null,
        active: !!values.active,
        storeId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      // Save to the shared Firestore products collection
      await addDoc(collection(db, 'products'), payload)
      pushToast({ type: 'success', message: 'Product saved!' })
      // reset
      setValues({
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
    } catch (err: any) {
      console.error(err)
      pushToast({ type: 'error', message: err?.message || 'Failed to save product' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="page">
      <h1 className="title">Add Product</h1>
      <form className="form" onSubmit={onSubmit}>
        <div className="grid">
          <label>
            <span>Name *</span>
            <input name="name" required value={values.name} onChange={onChange} placeholder="e.g., Coke 50cl" />
          </label>
          <label>
            <span>SKU</span>
            <input name="sku" value={values.sku} onChange={onChange} placeholder="Optional code" />
          </label>
          <label>
            <span>Price</span>
            <input name="price" type="number" step="0.01" value={values.price} onChange={onChange} placeholder="0.00" />
          </label>
          <label>
            <span>Cost</span>
            <input name="cost" type="number" step="0.01" value={values.cost} onChange={onChange} placeholder="0.00" />
          </label>
          <label>
            <span>Stock Qty</span>
            <input name="stockQty" type="number" step="1" value={values.stockQty} onChange={onChange} placeholder="0" />
          </label>
          <label>
            <span>Category</span>
            <input name="category" value={values.category} onChange={onChange} placeholder="e.g., Drinks" />
          </label>
          <label>
            <span>Image URL</span>
            <input name="imageUrl" value={values.imageUrl} onChange={onChange} placeholder="https://..." />
          </label>
          <label className="row">
            <input name="active" type="checkbox" checked={values.active} onChange={onChange} />
            <span>Active</span>
          </label>
          <label className="col-span">
            <span>Description</span>
            <textarea name="description" rows={4} value={values.description} onChange={onChange} placeholder="Optional notes" />
          </label>
        </div>
        <div className="actions">
          <button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Product'}</button>
        </div>
        <p className="hint">Saved to Firestore with your current workspace ID.</p>
      </form>
    </div>
  )
}
