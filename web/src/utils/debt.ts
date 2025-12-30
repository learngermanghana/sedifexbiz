export type CustomerDebt = {
  debt?: {
    outstandingCents?: number | null
    dueDate?: unknown
  } | null
}

export type DebtSummary = {
  totalOutstandingCents: number
  debtorCount: number
  overdueCents: number
  overdueCount: number
  nextDueDate: Date | null
}

function toDate(value: unknown): Date | null {
  if (!value) return null

  try {
    if (typeof (value as any).toDate === 'function') {
      return (value as any).toDate()
    }
    if (value instanceof Date) return value
    if (typeof value === 'string') {
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
  } catch {
    return null
  }

  return null
}

export function summarizeCustomerDebt(
  customers: Array<CustomerDebt>,
  now: Date = new Date(),
): DebtSummary {
  let totalOutstandingCents = 0
  let debtorCount = 0
  let overdueCents = 0
  let overdueCount = 0
  let nextDueDate: Date | null = null

  customers.forEach(customer => {
    const outstanding = Number(customer.debt?.outstandingCents ?? 0)
    if (!Number.isFinite(outstanding) || outstanding <= 0) {
      return
    }

    debtorCount += 1
    totalOutstandingCents += outstanding

    const dueDate = toDate(customer.debt?.dueDate)
    if (dueDate) {
      if (dueDate.getTime() < now.getTime()) {
        overdueCents += outstanding
        overdueCount += 1
      }

      if (!nextDueDate || dueDate.getTime() < nextDueDate.getTime()) {
        nextDueDate = dueDate
      }
    }
  })

  return {
    totalOutstandingCents,
    debtorCount,
    overdueCents,
    overdueCount,
    nextDueDate,
  }
}

export function formatGhsFromCents(cents: number): string {
  return `GHS ${(cents / 100).toFixed(2)}`
}
