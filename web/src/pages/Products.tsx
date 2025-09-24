import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  collection, addDoc, onSnapshot, query, where, orderBy,
  doc, updateDoc, deleteDoc, deleteField
} from 'firebase/firestore'
import { db, auth } from '../firebase'

type Product = {
  id?: string
  storeId: string
  name: string
  price: number
  stockCount?: number
  barcode?: string
  minStock?: number
  updatedAt?: number
}

export default function Products() {
  const user = auth.currentUser
  const STORE_ID = useMemo(() => user?.uid || null, [user?.uid])

  const [items, setItems] = useState<Product[]>([])
  const [name, setName] = useState('')
  const [price, setPrice] = useState<string>('')
  const [barcode, setBarcode] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPrice, setEditPrice] = useState<string>('')
  const [editStock, setEditStock] = useState<string>('')
  const [editBarcode, setEditBarcode] = useState('')
  const [scanningFor, setScanningFor] = useState<'new' | 'edit' | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanMessage, setScanMessage] = useState('Point your camera at a barcode')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number>()

  useEffect(() => {
    if (!STORE_ID) return
    const q = query(
      collection(db, 'products'),
      where('storeId', '==', STORE_ID),
      orderBy('name')
    )
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as Product) }))
      setItems(rows)
    })
    return () => unsub()
  }, [STORE_ID])

  async function addProduct(e: React.FormEvent) {
    e.preventDefault()
    if (!STORE_ID || !name || price === '') return
    const trimmedBarcode = barcode.trim()

    const newProduct: Omit<Product, 'id'> = {
      storeId: STORE_ID,
      name,
      price: Number(price),
      stockCount: 0,
      updatedAt: Date.now()
    }

    if (trimmedBarcode) {
      (newProduct as Product).barcode = trimmedBarcode
    }

    await addDoc(collection(db, 'products'), newProduct)
    setName(''); setPrice(''); setBarcode('')
  }

  function beginEdit(p: Product) {
    setEditing(p.id!)
    setEditName(p.name)
    setEditPrice(String(p.price))
    setEditStock(String(p.stockCount ?? 0))
    setEditBarcode(p.barcode ?? '')
  }

  async function saveEdit(id: string) {
    const trimmed = editBarcode.trim()

    const payload: Record<string, unknown> = {
      name: editName,
      price: Number(editPrice),
      stockCount: Number(editStock),
      updatedAt: Date.now()
    }

    payload.barcode = trimmed ? trimmed : deleteField()

    await updateDoc(doc(db, 'products', id), payload)
    setEditing(null)
  }

  async function remove(id: string) {
    await deleteDoc(doc(db, 'products', id))
  }

  if (!STORE_ID) return <div>Loading…</div>

  function stopScanning() {
    setScanningFor(null)
    setScanError(null)
    setScanMessage('Point your camera at a barcode')
  }

  useEffect(() => {
    if (!scanningFor) {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = undefined
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
      return
    }

    let cancelled = false

    async function initScanner() {
      setScanError(null)
      setScanMessage('Point your camera at a barcode')

      const Detector = (window as any).BarcodeDetector
      if (!Detector) {
        setScanError('Barcode scanning is not supported on this device. You can still type the barcode manually.')
        return
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setScanError('Camera access is not available on this device. You can enter the barcode manually instead.')
        return
      }

      let detector: any
      try {
        detector = new Detector({
          formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf']
        })
      } catch (err) {
        console.error(err)
        setScanError('Unable to start the barcode scanner.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false
        })
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        setScanMessage('Looking for a barcode…')

        const detectLoop = async () => {
          if (cancelled) return
          try {
            if (!videoRef.current) return
            const barcodes = await detector.detect(videoRef.current)
            const value = barcodes[0]?.rawValue?.trim()
            if (value) {
              if (scanningFor === 'new') {
                setBarcode(value)
              } else if (scanningFor === 'edit') {
                setEditBarcode(value)
              }
              stopScanning()
              return
            }
            frameRef.current = requestAnimationFrame(detectLoop)
          } catch (error) {
            console.error(error)
            setScanError('An error occurred while scanning. You can enter the barcode manually or close this window.')
            if (frameRef.current) {
              cancelAnimationFrame(frameRef.current)
              frameRef.current = undefined
            }
            if (streamRef.current) {
              streamRef.current.getTracks().forEach(track => track.stop())
              streamRef.current = null
            }
            if (videoRef.current) {
              videoRef.current.srcObject = null
            }
          }
        }

        detectLoop()
      } catch (err) {
        console.error(err)
        setScanError('We could not access the camera. Please allow camera access or enter the barcode manually.')
      }
    }

    initScanner()

    return () => {
      cancelled = true
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = undefined
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null
      }
    }
  }, [scanningFor])

  return (
    <div>
      <h2 style={{color:'#4338CA'}}>Products</h2>

      <form
        onSubmit={addProduct}
        style={{
          display:'grid',
          gridTemplateColumns:'2fr 1fr 1.5fr auto',
          gap:8,
          marginTop:12,
          alignItems:'center'
        }}
      >
        <input placeholder="Name" value={name} onChange={e=>setName(e.target.value)} />
        <input placeholder="Price (GHS)" type="number" min={0} step="0.01"
               value={price} onChange={e=>setPrice(e.target.value)} />
        <div style={{display:'flex', gap:8}}>
          <input
            placeholder="Barcode"
            value={barcode}
            onChange={e=>setBarcode(e.target.value)}
            style={{flex:1}}
          />
          <button
            type="button"
            onClick={()=>setScanningFor('new')}
            style={{background:'#e5e7eb', border:'1px solid #d1d5db', borderRadius:8, padding:'8px 12px'}}
          >
            Scan
          </button>
        </div>
        <button type="submit" style={{background:'#4338CA', color:'#fff', border:0, borderRadius:8, padding:'8px 12px'}}>Add</button>
      </form>

      <table style={{width:'100%', marginTop:16, borderCollapse:'collapse'}}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th align="right">Price (GHS)</th>
            <th align="right">Stock</th>
            <th align="left">Barcode</th>
            <th align="right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map(p=>(
            <tr key={p.id} style={{borderTop:'1px solid #eee'}}>
              <td>
                {editing===p.id
                  ? <input value={editName} onChange={e=>setEditName(e.target.value)} />
                  : p.name}
              </td>
              <td align="right">
                {editing===p.id
                  ? <input style={{textAlign:'right'}} type="number" min={0} step="0.01"
                           value={editPrice} onChange={e=>setEditPrice(e.target.value)} />
                  : p.price?.toFixed(2)}
              </td>
              <td align="right">
                {editing===p.id
                  ? <input style={{textAlign:'right'}} type="number" min={0} step="1"
                           value={editStock} onChange={e=>setEditStock(e.target.value)} />
                  : (p.stockCount ?? 0)}
              </td>
              <td>
                {editing===p.id ? (
                  <div style={{display:'flex', gap:8}}>
                    <input
                      value={editBarcode}
                      onChange={e=>setEditBarcode(e.target.value)}
                      placeholder="Barcode"
                    />
                    <button
                      type="button"
                      onClick={()=>setScanningFor('edit')}
                      style={{background:'#e5e7eb', border:'1px solid #d1d5db', borderRadius:8, padding:'4px 8px'}}
                    >
                      Scan
                    </button>
                  </div>
                ) : (
                  p.barcode || '—'
                )}
              </td>
              <td align="right" style={{whiteSpace:'nowrap'}}>
                {editing===p.id ? (
                  <>
                    <button onClick={()=>saveEdit(p.id!)} style={{marginRight:8}}>Save</button>
                    <button onClick={()=>setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={()=>beginEdit(p)} style={{marginRight:8}}>Edit</button>
                    <button onClick={()=>remove(p.id!)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {scanningFor && (
        <div
          style={{
            position:'fixed',
            inset:0,
            background:'rgba(17,24,39,0.6)',
            display:'flex',
            alignItems:'center',
            justifyContent:'center',
            zIndex:50
          }}
        >
          <div style={{background:'#fff', borderRadius:16, padding:24, width:'min(480px, 90%)'}}>
            <h3 style={{marginTop:0, marginBottom:12}}>Scan barcode</h3>
            {scanError ? (
              <p style={{color:'#b91c1c'}}>{scanError}</p>
            ) : (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  style={{width:'100%', borderRadius:12, background:'#000', aspectRatio:'3 / 2'}}
                  muted
                />
                <p style={{marginTop:12, color:'#4b5563'}}>{scanMessage}</p>
              </>
            )}
            <button
              onClick={stopScanning}
              style={{marginTop:16, background:'#4338CA', color:'#fff', border:0, borderRadius:8, padding:'10px 16px'}}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
