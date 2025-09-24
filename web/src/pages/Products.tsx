import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function escapePdfText(text: string) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ')
}

function buildSimplePdf(title: string, lines: string[]): Uint8Array {
  const encoder = new TextEncoder()
  const header = '%PDF-1.4\n'

  let content = 'BT\n'
  content += '/F1 18 Tf\n'
  content += '72 760 Td\n'
  content += `(${escapePdfText(title)}) Tj\n`
  content += '/F1 11 Tf\n'
  content += '0 -20 Td\n'

  lines.forEach((line, index) => {
    content += `(${escapePdfText(line)}) Tj\n`
    if (index < lines.length - 1) {
      content += '0 -16 Td\n'
    }
  })

  content += 'ET\n'

  const contentBytes = encoder.encode(content)

  const objects: string[] = []
  const offsets: number[] = [0]

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n')
  objects.push(`4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n${content}\nendstream\nendobj\n`)
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

  let currentOffset = header.length
  const encodedObjects = objects.map(obj => {
    offsets.push(currentOffset)
    const bytes = encoder.encode(obj)
    currentOffset += bytes.length
    return bytes
  })

  const xrefOffset = currentOffset
  let xref = `xref\n0 ${objects.length + 1}\n`
  xref += '0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i++) {
    xref += offsets[i].toString().padStart(10, '0') + ' 00000 n \n'
  }

  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  const parts: Uint8Array[] = [encoder.encode(header), ...encodedObjects, encoder.encode(xref), encoder.encode(trailer)]

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  parts.forEach(part => {
    result.set(part, offset)
    offset += part.length
  })

  return result
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
  const [searchTerm, setSearchTerm] = useState('')
  const [stockFilter, setStockFilter] = useState<'all' | 'in-stock' | 'low-stock' | 'out-of-stock'>('all')
  const [shareFeedback, setShareFeedback] = useState<string | null>(null)

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

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()

    return items.filter((item) => {
      const matchesTerm = term
        ? [item.name, item.barcode]
            .filter(Boolean)
            .some(value => value!.toLowerCase().includes(term))
        : true

      if (!matchesTerm) return false

      const stock = item.stockCount ?? 0
      const minStock = item.minStock ?? 5

      switch (stockFilter) {
        case 'in-stock':
          return stock > 0
        case 'low-stock':
          return stock > 0 && stock <= minStock
        case 'out-of-stock':
          return stock <= 0
        default:
          return true
      }
    })
  }, [items, searchTerm, stockFilter])

  const exportFile = useCallback((content: BlobPart, type: string, filename: string) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleDownloadCsv = useCallback(() => {
    if (!filteredItems.length) return

    const header = ['Name', 'Price (GHS)', 'Stock', 'Barcode']
    const rows = filteredItems.map(item => [
      `"${item.name.replace(/"/g, '""')}"`,
      item.price?.toFixed(2) ?? '0.00',
      String(item.stockCount ?? 0),
      item.barcode ? `"${item.barcode.replace(/"/g, '""')}"` : ''
    ])

    const csv = [header.join(','), ...rows.map(row => row.join(','))].join('\n')
    exportFile(csv, 'text/csv;charset=utf-8;', 'products.csv')
  }, [exportFile, filteredItems])

  const handleDownloadPdf = useCallback(() => {
    if (!filteredItems.length) return

    const column = (value: string, length: number) => {
      if (value.length > length) {
        return value.slice(0, length - 1) + '…'
      }
      return value.padEnd(length, ' ')
    }

    const lines = [
      '',
      `${column('Name', 24)}${column('Price', 10)}${column('Stock', 8)}Barcode`,
      `${'-'.repeat(24)}${'-'.repeat(10)}${'-'.repeat(8)}${'-'.repeat(12)}`,
      ...filteredItems.map(item => {
        const price = `GHS ${(item.price ?? 0).toFixed(2)}`
        const stock = `${item.stockCount ?? 0}`
        const barcode = item.barcode ?? '—'
        return `${column(item.name, 24)}${column(price, 10)}${column(stock, 8)}${barcode}`
      })
    ]

    const pdfBytes = buildSimplePdf('Products Report', lines)
    const pdfBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer
    exportFile(pdfBuffer, 'application/pdf', 'products.pdf')
  }, [exportFile, filteredItems])

  const handleShare = useCallback(async () => {
    if (!filteredItems.length) return

    const summary = filteredItems
      .map(item => `${item.name} – GHS ${(item.price ?? 0).toFixed(2)} (${item.stockCount ?? 0} in stock)${item.barcode ? ` – ${item.barcode}` : ''}`)
      .join('\n')

    try {
      if (navigator.share) {
        await navigator.share({ title: 'Product list', text: summary })
        setShareFeedback('Shared successfully')
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(summary)
        setShareFeedback('Copied details to clipboard')
      } else {
        exportFile(summary, 'text/plain', 'products.txt')
        setShareFeedback('Downloaded product summary')
      }
    } catch (error) {
      console.error('Failed to share product list', error)
      setShareFeedback('Unable to share right now')
    }

    setTimeout(() => setShareFeedback(null), 4000)
  }, [exportFile, filteredItems])

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

      <div
        style={{
          display:'flex',
          flexWrap:'wrap',
          gap:12,
          alignItems:'center',
          marginTop:16
        }}
      >
        <input
          placeholder="Search by name or barcode"
          value={searchTerm}
          onChange={e=>setSearchTerm(e.target.value)}
          style={{flex:'1 1 240px'}}
        />
        <select
          value={stockFilter}
          onChange={e=>setStockFilter(e.target.value as typeof stockFilter)}
          style={{flex:'0 0 200px'}}
        >
          <option value="all">All stock levels</option>
          <option value="in-stock">In stock</option>
          <option value="low-stock">Low stock</option>
          <option value="out-of-stock">Out of stock</option>
        </select>
        <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
          <button
            type="button"
            onClick={handleDownloadPdf}
            style={{background:'#4338CA', color:'#fff', border:0, borderRadius:8, padding:'8px 12px'}}
            disabled={!filteredItems.length}
          >
            Download PDF
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            style={{background:'#2563EB', color:'#fff', border:0, borderRadius:8, padding:'8px 12px'}}
            disabled={!filteredItems.length}
          >
            Download CSV
          </button>
          <button
            type="button"
            onClick={handleShare}
            style={{background:'#059669', color:'#fff', border:0, borderRadius:8, padding:'8px 12px'}}
            disabled={!filteredItems.length}
          >
            Share
          </button>
        </div>
      </div>

      {shareFeedback && (
        <p style={{marginTop:8, color:'#047857'}}>{shareFeedback}</p>
      )}

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
          {filteredItems.map(p=>(
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
