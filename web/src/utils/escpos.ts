import type { PaymentMethod, ReceiptLine, ReceiptTender, ReceiptTotals } from './receipt'

export type EscPosReceiptSize = '58mm' | '80mm'

type ReceiptOptions = {
  saleId: string
  items: ReceiptLine[]
  totals: ReceiptTotals
  paymentMethod: PaymentMethod
  tenders?: ReceiptTender[]
  discountInput: string
  companyName?: string | null
  customerName?: string | null
  customerPhone?: string | null
  receiptSize: EscPosReceiptSize
  receiptDate?: Date
}

type EscPosCommand = number[] | Uint8Array

const encoder = new TextEncoder()
const columnWidths: Record<EscPosReceiptSize, number> = {
  '58mm': 32,
  '80mm': 48,
}

function formatCurrency(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'GHS 0.00'
  return `GHS ${amount.toFixed(2)}`
}

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function pushBytes(target: number[], chunk: EscPosCommand) {
  if (chunk instanceof Uint8Array) {
    chunk.forEach(byte => target.push(byte))
    return
  }
  target.push(...chunk)
}

function textBytes(value: string): Uint8Array {
  return encoder.encode(value)
}

function lineFeed(): number[] {
  return [0x0a]
}

function align(value: 0 | 1 | 2): number[] {
  return [0x1b, 0x61, value]
}

function bold(value: boolean): number[] {
  return [0x1b, 0x45, value ? 1 : 0]
}

function textSize(width: number, height: number): number[] {
  const widthBits = Math.min(7, Math.max(0, width - 1))
  const heightBits = Math.min(7, Math.max(0, height - 1))
  return [0x1d, 0x21, (widthBits << 4) | heightBits]
}

function cutPaper(): number[] {
  return [0x1d, 0x56, 0x42, 0x00]
}

function formatLine(left: string, right: string, width: number): string {
  const cleanLeft = left.trim()
  const cleanRight = right.trim()
  const available = Math.max(0, width - cleanRight.length - 1)
  const truncatedLeft = cleanLeft.length > available ? `${cleanLeft.slice(0, Math.max(0, available - 1))}…` : cleanLeft
  const spacing = Math.max(1, width - truncatedLeft.length - cleanRight.length)
  return `${truncatedLeft}${' '.repeat(spacing)}${cleanRight}`
}

function wrapText(value: string, width: number): string[] {
  const words = value.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (!current) {
      current = word
      continue
    }
    if (current.length + word.length + 1 <= width) {
      current = `${current} ${word}`
      continue
    }
    lines.push(current)
    current = word
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function buildPaymentLabel(method: PaymentMethod, tenders?: ReceiptTender[]): string {
  if (tenders && tenders.length > 1) {
    return tenders
      .map(tender => `${tender.method.replace('_', ' ')} (${formatCurrency(tender.amount)})`)
      .join(' + ')
  }
  return method.replace('_', ' ')
}

export function buildEscPosReceipt(options: ReceiptOptions): Uint8Array {
  const width = columnWidths[options.receiptSize]
  const bytes: number[] = []
  const receiptDate = options.receiptDate ?? new Date()
  const paymentLabel = buildPaymentLabel(options.paymentMethod, options.tenders)
  const customerName = normalizeText(options.customerName) || 'Walk-in'
  const customerPhone = normalizeText(options.customerPhone)

  pushBytes(bytes, [0x1b, 0x40])
  pushBytes(bytes, align(1))
  pushBytes(bytes, bold(true))
  pushBytes(bytes, textSize(2, 2))
  pushBytes(bytes, textBytes(options.companyName ? options.companyName : 'Sale receipt'))
  pushBytes(bytes, lineFeed())
  pushBytes(bytes, textSize(1, 1))
  pushBytes(bytes, bold(false))
  pushBytes(bytes, align(0))
  pushBytes(bytes, textBytes(`Sale ID: ${options.saleId}`))
  pushBytes(bytes, lineFeed())
  pushBytes(bytes, textBytes(`Date: ${receiptDate.toLocaleString()}`))
  pushBytes(bytes, lineFeed())
  pushBytes(bytes, textBytes(`Payment: ${paymentLabel}`))
  pushBytes(bytes, lineFeed())

  if (customerName || customerPhone) {
    const label = `Customer: ${customerName}${customerPhone ? ` (${customerPhone})` : ''}`
    wrapText(label, width).forEach(line => {
      pushBytes(bytes, textBytes(line))
      pushBytes(bytes, lineFeed())
    })
  }

  pushBytes(bytes, lineFeed())
  pushBytes(bytes, bold(true))
  pushBytes(bytes, textBytes('Items'))
  pushBytes(bytes, bold(false))
  pushBytes(bytes, lineFeed())

  options.items.forEach(item => {
    const nameLines = wrapText(item.name, width)
    nameLines.forEach(line => {
      pushBytes(bytes, textBytes(line))
      pushBytes(bytes, lineFeed())
    })

    const qtyLine = `${item.qty} x ${formatCurrency(item.price)}`
    const totalLine = formatCurrency(item.qty * item.price)
    pushBytes(bytes, textBytes(formatLine(qtyLine, totalLine, width)))
    pushBytes(bytes, lineFeed())

    if (item.metadata?.length) {
      item.metadata.forEach(entry => {
        wrapText(`- ${entry}`, width).forEach(line => {
          pushBytes(bytes, textBytes(line))
          pushBytes(bytes, lineFeed())
        })
      })
    }
  })

  pushBytes(bytes, lineFeed())
  pushBytes(bytes, bold(true))
  pushBytes(bytes, textBytes('Summary'))
  pushBytes(bytes, bold(false))
  pushBytes(bytes, lineFeed())

  const discountLabel = options.discountInput ? options.discountInput : formatCurrency(options.totals.discount)
  const summaryLines = [
    formatLine('Subtotal', formatCurrency(options.totals.subTotal), width),
    formatLine('VAT / Tax', formatCurrency(options.totals.taxTotal), width),
    formatLine('Discount', discountLabel, width),
    formatLine('Total', formatCurrency(options.totals.total), width),
    formatLine('Payment', paymentLabel, width),
  ]
  summaryLines.forEach(line => {
    pushBytes(bytes, textBytes(line))
    pushBytes(bytes, lineFeed())
  })

  pushBytes(bytes, lineFeed())
  pushBytes(bytes, align(1))
  pushBytes(bytes, textBytes('Thank you!'))
  pushBytes(bytes, lineFeed())
  pushBytes(bytes, lineFeed())
  pushBytes(bytes, cutPaper())

  return new Uint8Array(bytes)
}

export function buildEscPosCashDrawerKick(): Uint8Array {
  return new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa])
}

export function chunkEscPosBytes(payload: Uint8Array, size = 180): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let index = 0; index < payload.length; index += size) {
    chunks.push(payload.slice(index, index + size))
  }
  return chunks
}
