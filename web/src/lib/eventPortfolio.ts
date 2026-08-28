export type EventPortfolioSource = Record<string, unknown> & { id: string }

export type EventPortfolioRow = {
  id: string
  eventCode: string
  title: string
  clientName: string
  eventDate: Date | null
  eventDateText: string
  status: string
  planningPackage: string
  guestCount: number
  progress: number
  checklistTaskCount: number
  checklistCompletedCount: number
  openChecklistTasks: number
  contractStatus: string
  contractValue: number | null
  invoiced: number
  received: number
  clientBalance: number | null
  vendorQuoted: number
  vendorPaid: number
  vendorOutstanding: number
  expenses: number
  expectedProfit: number | null
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function eventDate(value: unknown) {
  const raw = text(value)
  if (!raw) return null
  const parsed = new Date(`${raw}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function recordEventId(record: Record<string, unknown>) {
  return text(record.eventId ?? record.event_id)
}

function vendorTotals(event: Record<string, unknown>) {
  const integrations = objectValue(event.integrations)
  const vendors = Array.isArray(integrations.vendors) ? integrations.vendors : []
  return vendors.reduce((totals, value) => {
    const vendor = objectValue(value)
    if (text(vendor.status).toLowerCase() === 'cancelled') return totals
    const quoted = Math.max(0, numberValue(vendor.quotedAmount))
    const paid = Math.max(0, Math.min(numberValue(vendor.depositPaid), quoted || numberValue(vendor.depositPaid)))
    return {
      quoted: totals.quoted + quoted,
      paid: totals.paid + paid,
      outstanding: totals.outstanding + Math.max(quoted - paid, 0),
    }
  }, { quoted: 0, paid: 0, outstanding: 0 })
}

function eventContractValue(event: Record<string, unknown>) {
  const integrations = objectValue(event.integrations)
  const finance = objectValue(integrations.finance)
  return typeof finance.contractValue === 'number' && Number.isFinite(finance.contractValue)
    ? Math.max(0, finance.contractValue)
    : null
}

export function eventStatusLabel(status: string) {
  const labels: Record<string, string> = {
    new: 'New enquiry',
    planning: 'Planning',
    awaiting_client: 'Awaiting client',
    confirmed: 'Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return labels[status] || status || 'New enquiry'
}

export function eventPackageLabel(planningPackage: string) {
  const labels: Record<string, string> = {
    full_planning: 'Full planning',
    partial_planning: 'Partial planning',
    coordination_only: 'Coordination only',
    staffing_only: 'Staffing only',
  }
  return labels[planningPackage] || planningPackage || 'Full planning'
}

export function buildEventPortfolioRows(
  events: EventPortfolioSource[],
  invoices: EventPortfolioSource[],
  receipts: EventPortfolioSource[],
  expenses: EventPortfolioSource[],
): EventPortfolioRow[] {
  const invoiceTotals = new Map<string, number>()
  invoices.forEach(invoice => {
    const eventId = recordEventId(invoice)
    if (!eventId) return
    invoiceTotals.set(eventId, (invoiceTotals.get(eventId) || 0) + Math.max(0, numberValue(invoice.total)))
  })

  const receiptTotals = new Map<string, number>()
  receipts.forEach(receipt => {
    const eventId = recordEventId(receipt)
    if (!eventId) return
    receiptTotals.set(eventId, (receiptTotals.get(eventId) || 0) + Math.max(0, numberValue(receipt.amountPaid ?? receipt.amount)))
  })

  const expenseTotals = new Map<string, number>()
  expenses.forEach(expense => {
    const eventId = recordEventId(expense)
    if (!eventId) return
    expenseTotals.set(eventId, (expenseTotals.get(eventId) || 0) + Math.max(0, numberValue(expense.amount)))
  })

  return events.map(event => {
    const vendors = vendorTotals(event)
    const contractApproval = objectValue(event.contractApproval)
    const contractValue = eventContractValue(event)
    const invoiced = invoiceTotals.get(event.id) || 0
    const received = receiptTotals.get(event.id) || 0
    const eventExpenses = expenseTotals.get(event.id) || 0
    const checklistTaskCount = Math.max(0, Math.floor(numberValue(event.checklistTaskCount)))
    const checklistCompletedCount = Math.max(0, Math.floor(numberValue(event.checklistCompletedCount)))
    const progress = Math.max(0, Math.min(100, numberValue(event.progress)))

    return {
      id: event.id,
      eventCode: text(event.eventCode, `EVT-${event.id.slice(0, 6).toUpperCase()}`),
      title: text(event.title, 'Untitled event'),
      clientName: text(event.clientName, 'Client not assigned'),
      eventDate: eventDate(event.eventDate),
      eventDateText: text(event.eventDate),
      status: text(event.status, 'new'),
      planningPackage: text(event.planningPackage, 'full_planning'),
      guestCount: Math.max(0, Math.floor(numberValue(event.guestCount))),
      progress,
      checklistTaskCount,
      checklistCompletedCount,
      openChecklistTasks: Math.max(checklistTaskCount - checklistCompletedCount, 0),
      contractStatus: text(contractApproval.status, 'draft'),
      contractValue,
      invoiced,
      received,
      clientBalance: contractValue === null ? null : Math.max(contractValue - received, 0),
      vendorQuoted: vendors.quoted,
      vendorPaid: vendors.paid,
      vendorOutstanding: vendors.outstanding,
      expenses: eventExpenses,
      expectedProfit: contractValue === null ? null : contractValue - eventExpenses - vendors.outstanding,
    }
  }).sort((a, b) => {
    const aTime = a.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    const bTime = b.eventDate?.getTime() ?? Number.MAX_SAFE_INTEGER
    return aTime - bTime || a.title.localeCompare(b.title)
  })
}
