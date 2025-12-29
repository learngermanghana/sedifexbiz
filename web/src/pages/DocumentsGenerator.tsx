import React, { useEffect, useMemo, useState } from 'react'
import { buildReceiptPdf, type PaymentMethod, type ReceiptLine } from '../utils/receipt'
import { buildInvoicePdf, type InvoiceLine } from '../utils/invoice'
import './DocumentsGenerator.css'

type DocumentType = 'invoice' | 'receipt'

type LineItemState = {
  id: string
  name: string
  qty: string
  price: string
  detail: string
}

type GeneratedDocument = {
  url: string
  fileName: string
  shareText?: string
}

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'transfer', label: 'Bank transfer' },
]

function createLineItem(): LineItemState {
  return {
    id: Math.random().toString(36).slice(2),
    name: '',
    qty: '1',
    price: '',
    detail: '',
  }
}

function toNumber(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(amount: number): string {
  return `GHS ${amount.toFixed(2)}`
}

export default function DocumentsGenerator() {
  const [docType, setDocType] = useState<DocumentType>('invoice')
  const [companyName, setCompanyName] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [issuedDate, setIssuedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [taxRate, setTaxRate] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [notes, setNotes] = useState('')
  const [lineItems, setLineItems] = useState<LineItemState[]>([createLineItem()])
  const [error, setError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<GeneratedDocument | null>(null)

  const parsedItems = useMemo(() => {
    return lineItems
      .map(item => ({
        id: item.id,
        name: item.name.trim(),
        qty: Math.max(0, toNumber(item.qty)),
        price: Math.max(0, toNumber(item.price)),
        detail: item.detail.trim(),
      }))
      .filter(item => item.name && item.qty > 0)
  }, [lineItems])

  const subTotal = useMemo(
    () => parsedItems.reduce((sum, item) => sum + item.qty * item.price, 0),
    [parsedItems],
  )

  const taxTotal = useMemo(() => {
    const rate = toNumber(taxRate)
    if (!rate) return 0
    return (subTotal * rate) / 100
  }, [subTotal, taxRate])

  const discountValue = useMemo(() => Math.max(0, toNumber(discount)), [discount])
  const total = useMemo(() => Math.max(0, subTotal + taxTotal - discountValue), [subTotal, taxTotal, discountValue])

  useEffect(() => {
    return () => {
      if (generated?.url) {
        URL.revokeObjectURL(generated.url)
      }
    }
  }, [generated])

  function updateLineItem(id: string, patch: Partial<LineItemState>) {
    setLineItems(prev => prev.map(item => (item.id === id ? { ...item, ...patch } : item)))
  }

  function handleAddLineItem() {
    setLineItems(prev => [...prev, createLineItem()])
  }

  function handleRemoveLineItem(id: string) {
    setLineItems(prev => prev.filter(item => item.id !== id))
  }

  function handleGenerate() {
    if (!parsedItems.length) {
      setError('Add at least one line item to generate a document.')
      return
    }

    const normalizedItems = parsedItems.map<ReceiptLine | InvoiceLine>(item => ({
      name: item.name,
      qty: item.qty,
      price: item.price,
      metadata: item.detail ? [item.detail] : undefined,
    }))

    const commonTotals = {
      subTotal,
      taxTotal,
      discount: discountValue,
      total,
    }

    const companyLabel = companyName.trim() || null
    const customerLabel = customerName.trim() || null
    const phoneLabel = customerPhone.trim() || null

    if (generated?.url) {
      URL.revokeObjectURL(generated.url)
    }

    if (docType === 'receipt') {
      const saleId = invoiceNumber.trim() || `receipt-${Date.now()}`
      const discountInput = discountValue > 0 ? formatCurrency(discountValue) : 'None'

      const receipt = buildReceiptPdf({
        saleId,
        items: normalizedItems as ReceiptLine[],
        totals: commonTotals,
        paymentMethod,
        discountInput,
        companyName: companyLabel,
        customerName: customerLabel,
        customerPhone: phoneLabel,
      })

      if (!receipt) {
        setError('Unable to generate a receipt right now. Try again.')
        setGenerated(null)
        return
      }

      setGenerated({
        url: receipt.url,
        fileName: receipt.fileName,
        shareText: receipt.shareText,
      })
      setError(null)
      return
    }

    const invoiceId = invoiceNumber.trim() || `inv-${Date.now()}`
    const invoice = buildInvoicePdf({
      invoiceNumber: invoiceId,
      issuedDate,
      dueDate,
      items: normalizedItems as InvoiceLine[],
      totals: commonTotals,
      companyName: companyLabel,
      customerName: customerLabel,
      customerPhone: phoneLabel,
      notes: notes.trim() || null,
    })

    if (!invoice) {
      setError('Unable to generate an invoice right now. Try again.')
      setGenerated(null)
      return
    }

    setGenerated({
      url: invoice.url,
      fileName: invoice.fileName,
    })
    setError(null)
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Invoice & receipt generator</h2>
          <p className="page__subtitle">
            Build share-ready PDFs without adding another top-level navigation tab.
          </p>
        </div>
      </header>

      <section className="card">
        <div className="documents-generator__toggle" role="tablist" aria-label="Document type">
          {(['invoice', 'receipt'] as DocumentType[]).map(type => (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={docType === type}
              className={
                docType === type
                  ? 'button button--primary button--small'
                  : 'button button--ghost button--small'
              }
              onClick={() => setDocType(type)}
            >
              {type === 'invoice' ? 'Invoice' : 'Receipt'}
            </button>
          ))}
        </div>

        <div className="documents-generator__grid">
          <div className="documents-generator__section">
            <h3 className="card__title">Document details</h3>
            <div className="form">
              <label className="form__field">
                <span className="form__hint">Workspace or company name</span>
                <input
                  className="input"
                  value={companyName}
                  onChange={event => setCompanyName(event.target.value)}
                  placeholder="Sedifex Stores"
                />
              </label>
              <label className="form__field">
                <span className="form__hint">Customer name</span>
                <input
                  className="input"
                  value={customerName}
                  onChange={event => setCustomerName(event.target.value)}
                  placeholder="Customer name"
                />
              </label>
              <label className="form__field">
                <span className="form__hint">Customer phone</span>
                <input
                  className="input"
                  value={customerPhone}
                  onChange={event => setCustomerPhone(event.target.value)}
                  placeholder="+233..."
                />
              </label>

              <label className="form__field">
                <span className="form__hint">Document number</span>
                <input
                  className="input"
                  value={invoiceNumber}
                  onChange={event => setInvoiceNumber(event.target.value)}
                  placeholder={docType === 'invoice' ? 'INV-0001' : 'Receipt ID'}
                />
              </label>

              {docType === 'invoice' ? (
                <>
                  <label className="form__field">
                    <span className="form__hint">Issued date</span>
                    <input
                      className="input"
                      type="date"
                      value={issuedDate}
                      onChange={event => setIssuedDate(event.target.value)}
                    />
                  </label>
                  <label className="form__field">
                    <span className="form__hint">Due date (optional)</span>
                    <input
                      className="input"
                      type="date"
                      value={dueDate}
                      onChange={event => setDueDate(event.target.value)}
                    />
                  </label>
                </>
              ) : (
                <label className="form__field">
                  <span className="form__hint">Payment method</span>
                  <select
                    className="input"
                    value={paymentMethod}
                    onChange={event => setPaymentMethod(event.target.value as PaymentMethod)}
                  >
                    {PAYMENT_METHODS.map(method => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="documents-generator__row">
                <label className="form__field">
                  <span className="form__hint">Tax rate (%)</span>
                  <input
                    className="input"
                    value={taxRate}
                    onChange={event => setTaxRate(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <label className="form__field">
                  <span className="form__hint">Discount (GHS)</span>
                  <input
                    className="input"
                    value={discount}
                    onChange={event => setDiscount(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
              </div>

              {docType === 'invoice' ? (
                <label className="form__field">
                  <span className="form__hint">Invoice notes</span>
                  <textarea
                    className="input documents-generator__notes"
                    value={notes}
                    onChange={event => setNotes(event.target.value)}
                    placeholder="Add payment terms, delivery notes, or thank you text."
                  />
                </label>
              ) : null}
            </div>
          </div>

          <div className="documents-generator__section">
            <h3 className="card__title">Line items</h3>
            <div className="documents-generator__items">
              {lineItems.map((item, index) => (
                <div key={item.id} className="documents-generator__item">
                  <div className="documents-generator__item-header">
                    <span>Item {index + 1}</span>
                    {lineItems.length > 1 ? (
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => handleRemoveLineItem(item.id)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="documents-generator__row">
                    <label className="form__field">
                      <span className="form__hint">Name</span>
                      <input
                        className="input"
                        value={item.name}
                        onChange={event => updateLineItem(item.id, { name: event.target.value })}
                        placeholder="Service or product"
                      />
                    </label>
                    <label className="form__field">
                      <span className="form__hint">Qty</span>
                      <input
                        className="input"
                        value={item.qty}
                        onChange={event => updateLineItem(item.id, { qty: event.target.value })}
                        inputMode="decimal"
                      />
                    </label>
                    <label className="form__field">
                      <span className="form__hint">Price (GHS)</span>
                      <input
                        className="input"
                        value={item.price}
                        onChange={event => updateLineItem(item.id, { price: event.target.value })}
                        inputMode="decimal"
                      />
                    </label>
                  </div>
                  <label className="form__field">
                    <span className="form__hint">Detail (optional)</span>
                    <input
                      className="input"
                      value={item.detail}
                      onChange={event => updateLineItem(item.id, { detail: event.target.value })}
                      placeholder="Batch, serial, or delivery details"
                    />
                  </label>
                </div>
              ))}
              <button
                type="button"
                className="button button--ghost button--small documents-generator__add"
                onClick={handleAddLineItem}
              >
                Add item
              </button>
            </div>
          </div>
        </div>

        <div className="documents-generator__summary">
          <div>
            <h3 className="card__title">Summary</h3>
            <p className="card__subtitle">Preview totals before generating a PDF.</p>
          </div>
          <div className="documents-generator__totals">
            <div>
              <span className="form__hint">Subtotal</span>
              <strong>{formatCurrency(subTotal)}</strong>
            </div>
            <div>
              <span className="form__hint">Tax</span>
              <strong>{formatCurrency(taxTotal)}</strong>
            </div>
            <div>
              <span className="form__hint">Discount</span>
              <strong>{formatCurrency(discountValue)}</strong>
            </div>
            <div>
              <span className="form__hint">Total</span>
              <strong>{formatCurrency(total)}</strong>
            </div>
          </div>
        </div>

        {error ? (
          <p className="status status--error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="documents-generator__actions">
          <button type="button" className="button button--primary" onClick={handleGenerate}>
            Generate {docType === 'invoice' ? 'invoice' : 'receipt'} PDF
          </button>
          {generated ? (
            <div className="documents-generator__download">
              <a className="button button--ghost" href={generated.url} download={generated.fileName}>
                Download PDF
              </a>
              {generated.shareText ? (
                <p className="form__hint">Share text ready for WhatsApp or email.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
