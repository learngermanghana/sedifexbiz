import { buildSimplePdf } from './pdf'

type PaymentMethod = 'cash' | 'card' | 'mobile_money' | 'transfer'

type ReceiptLine = {
  name: string
  qty: number
  price: number
  metadata?: string[]
}

type ReceiptTender = { method: PaymentMethod; amount: number }

type ReceiptTotals = { subTotal: number; taxTotal: number; discount: number; total: number }

type ReceiptPayload = {
  saleId: string
  items: ReceiptLine[]
  totals: ReceiptTotals
  paymentMethod: PaymentMethod
  tenders?: ReceiptTender[]
  discountInput: string
  companyName?: string | null
  companyEmail?: string | null
  companyAddress?: string | null
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
}

function formatCurrency(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'GHS 0.00'
  return `GHS ${amount.toFixed(2)}`
}

function normalizeLines(lines: ReceiptLine[]): ReceiptLine[] {
  return lines
    .map(line => ({
      name: typeof line.name === 'string' ? line.name : 'Item',
      qty: Number.isFinite(line.qty) ? line.qty : 0,
      price: Number.isFinite(line.price) ? line.price : 0,
      metadata: Array.isArray(line.metadata)
        ? line.metadata
            .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
            .filter(Boolean)
        : [],
    }))
    .filter(line => line.qty > 0)
}

function normalizeTotals(totals: ReceiptTotals): ReceiptTotals {
  return {
    subTotal: Number.isFinite(totals.subTotal) ? totals.subTotal : 0,
    taxTotal: Number.isFinite(totals.taxTotal) ? totals.taxTotal : 0,
    discount: Number.isFinite(totals.discount) ? totals.discount : 0,
    total: Number.isFinite(totals.total) ? totals.total : 0,
  }
}

function appendMultiline(lines: string[], value?: string | null) {
  if (!value) return
  value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => lines.push(line))
}

function formatCustomerLine(options: Pick<ReceiptPayload, 'customerName' | 'customerPhone' | 'customerEmail'>) {
  const name = options.customerName ?? 'Walk-in'
  const phone = options.customerPhone ? ` (${options.customerPhone})` : ''
  const email = options.customerEmail ? ` • ${options.customerEmail}` : ''
  return `Customer: ${name}${phone}${email}`
}

export function buildReceiptPdf(options: ReceiptPayload) {
  try {
    const receiptDate = new Date().toLocaleString()
    const items = normalizeLines(options.items)
    const totals = normalizeTotals(options.totals)

    const paymentLabel =
      options.tenders && options.tenders.length > 1
        ? options.tenders
            .map(tender =>
              `${tender.method.replace('_', ' ')} (${formatCurrency(tender.amount)})`,
            )
            .join(' + ')
        : options.paymentMethod.replace('_', ' ')

    const customerLine =
      options.customerName || options.customerPhone || options.customerEmail
        ? formatCustomerLine(options)
        : ''

    const lines: string[] = [
      options.companyName ? options.companyName : 'Sale receipt',
    ]
    appendMultiline(lines, options.companyAddress)
    if (options.companyEmail) {
      lines.push(options.companyEmail)
    }

    lines.push(
      `Sale ID: ${options.saleId}`,
      `Date: ${receiptDate}`,
      `Payment: ${paymentLabel}`,
      customerLine,
      'Items:',
    )

    const filteredLines = lines.filter(Boolean)

    items.forEach(item => {
      const total = formatCurrency(item.price * item.qty)
      filteredLines.push(`• ${item.qty} x ${item.name} @ ${formatCurrency(item.price)} = ${total}`)
      if (item.metadata?.length) {
        item.metadata.forEach(entry => {
          filteredLines.push(`   - ${entry}`)
        })
      }
    })

    filteredLines.push('Summary:')
    filteredLines.push(`Subtotal: ${formatCurrency(totals.subTotal)}`)
    filteredLines.push(`VAT / Tax: ${formatCurrency(totals.taxTotal)}`)
    filteredLines.push(`Discount: ${options.discountInput ? options.discountInput : formatCurrency(totals.discount)}`)
    filteredLines.push(`Total: ${formatCurrency(totals.total)}`)

    const pdfBytes = buildSimplePdf('Sale receipt', filteredLines)
    const blob = new Blob([pdfBytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)

    const shareText = [
      options.companyName ? `${options.companyName} receipt` : `Sale receipt (${receiptDate})`,
      `Total: ${formatCurrency(totals.total)}`,
      `Payment: ${paymentLabel}`,
      customerLine || null,
      `Items: ${items.length}`,
    ]
      .filter(Boolean)
      .join('\n')

    return { url, fileName: `${options.saleId}.pdf`, shareText }
  } catch (error) {
    console.error('[receipt] Unable to build receipt PDF', error)
    return null
  }
}

export type {
  PaymentMethod,
  ReceiptLine,
  ReceiptPayload,
  ReceiptTender,
  ReceiptTotals,
}
