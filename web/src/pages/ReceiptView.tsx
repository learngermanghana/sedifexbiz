import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { buildReceiptPdf, type ReceiptPayload } from '../utils/receipt'

function formatCurrency(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'GHS 0.00'
  return `GHS ${amount.toFixed(2)}`
}

export default function ReceiptView() {
  const { saleId } = useParams()
  const [loading, setLoading] = useState(true)
  const [receipt, setReceipt] = useState<ReceiptPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!saleId) return
    let active = true

    ;(async () => {
      try {
        setLoading(true)
        setError(null)

        const snap = await getDoc(doc(db, 'receipts', saleId))
        if (!active) return

        if (!snap.exists()) {
          setReceipt(null)
          setError('Receipt not found.')
          return
        }

        setReceipt(snap.data() as ReceiptPayload)
      } catch (e) {
        if (!active) return
        setError('Could not load this receipt.')
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [saleId])

  const pdf = useMemo(() => {
    if (!receipt) return null
    return buildReceiptPdf(receipt)
  }, [receipt])

  if (loading) return <div className="page"><p>Loading receipt…</p></div>

  if (error) {
    return (
      <div className="page">
        <h2>Receipt</h2>
        <p style={{ color: '#b91c1c' }}>{error}</p>
      </div>
    )
  }

  if (!receipt) return null

  return (
    <div className="page">
      <h2>Receipt</h2>
      <p><strong>Sale ID:</strong> {receipt.saleId}</p>
      {receipt.companyName ? <p><strong>Company:</strong> {receipt.companyName}</p> : null}
      {receipt.customerName ? <p><strong>Customer:</strong> {receipt.customerName}</p> : null}
      {receipt.customerPhone ? <p><strong>Phone:</strong> {receipt.customerPhone}</p> : null}
      <p><strong>Payment:</strong> {String(receipt.paymentMethod).replace('_', ' ')}</p>

      <div style={{ marginTop: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', padding: 8 }}>Item</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #e2e8f0', padding: 8 }}>Qty</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #e2e8f0', padding: 8 }}>Price</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #e2e8f0', padding: 8 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((line, idx) => (
              <React.Fragment key={idx}>
                <tr>
                  <td style={{ padding: 8 }}>{line.name}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{line.qty}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{formatCurrency(line.price)}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{formatCurrency(line.price * line.qty)}</td>
                </tr>
                {(line.metadata ?? []).map((m, mi) => (
                  <tr key={`${idx}-m-${mi}`}>
                    <td style={{ padding: 8, color: '#475569' }} colSpan={4}>{m}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 16 }}>
          <p><strong>Subtotal:</strong> {formatCurrency(receipt.totals.subTotal)}</p>
          <p><strong>VAT/Tax:</strong> {formatCurrency(receipt.totals.taxTotal)}</p>
          <p><strong>Discount:</strong> {receipt.discountInput ? receipt.discountInput : 'None'}</p>
          <p><strong>Total:</strong> {formatCurrency(receipt.totals.total)}</p>
        </div>

        {pdf && (
          <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a href={pdf.url} download={pdf.fileName}>Download PDF</a>
          </div>
        )}
      </div>
    </div>
  )
}
