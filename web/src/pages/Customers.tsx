import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  limit,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { Timestamp } from 'firebase/firestore'
import { Link, useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import './Customers.css'
import {
  CUSTOMER_CACHE_LIMIT,
  SALES_CACHE_LIMIT,
  loadCachedCustomers,
  loadCachedSales,
  saveCachedCustomers,
  saveCachedSales,
} from '../utils/offlineCache'

type Customer = {
  id: string
  name: string
  displayName?: string
  phone?: string
  email?: string
  notes?: string
  tags?: string[]
  birthdate?: string | Timestamp | null
  createdAt?: Timestamp | null
  updatedAt?: Timestamp | null
  debt?: {
    outstandingCents?: number | null
    dueDate?: Timestamp | null
    lastReminderAt?: Timestamp | null
  } | null
}

type SaleHistoryEntry = {
  id: string
  total: number
  createdAt: Date | null
  paymentMethod?: string | null
  amountPaid?: number | null
  changeDue?: number | null
  items: { name?: string | null; qty?: number | null }[]
}

type CustomerStats = {
  visits: number
  totalSpend: number
  lastVisit: Date | null
}

type CachedSaleRecord = {
  id: string
  customer?: { id?: string | null; name?: string | null; phone?: string | null } | null
  createdAt?: unknown
  total?: unknown
  payment?: { method?: unknown; amountPaid?: unknown; changeDue?: unknown } | null
  items?: unknown
} & Record<string, unknown>

type MessageChannel = 'whatsapp' | 'telegram' | 'email'
type CustomerTab = 'view' | 'add' | 'invite'

const RECENT_VISIT_DAYS = 90
const HIGH_VALUE_THRESHOLD = 1000
const REMINDER_TEMPLATE_IDS = new Set(['payment-reminder', 'overdue-notice'])

function getCustomerPrimaryName(customer: Pick<Customer, 'displayName' | 'name'>): string {
  const displayName = customer.displayName?.trim()
  if (displayName) {
    return displayName
  }
  const legacyName = customer.name?.trim()
  if (legacyName) {
    return legacyName
  }
  return ''
}

function getCustomerSortKey(
  customer: Pick<Customer, 'displayName' | 'name' | 'email' | 'phone'>,
): string {
  const primary = getCustomerPrimaryName(customer)
  if (primary) {
    return primary
  }
  const email = customer.email?.trim()
  if (email) {
    return email
  }
  const phone = customer.phone?.trim()
  if (phone) {
    return phone
  }
  return ''
}

function getCustomerDisplayName(
  customer: Pick<Customer, 'displayName' | 'name' | 'email' | 'phone'>,
): string {
  const primary = getCustomerPrimaryName(customer)
  if (primary) {
    return primary
  }
  const email = customer.email?.trim()
  if (email) {
    return email
  }
  const phone = customer.phone?.trim()
  if (phone) {
    return phone
  }
  return '—'
}

function normalizeTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean)
        .map(tag => tag.replace(/^#/, ''))
    )
  )
}

function normalizeDateLike(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value)
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : new Date(parsed)
  }
  if (typeof value === 'object') {
    const anyValue = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number }
    if (typeof anyValue.toDate === 'function') {
      try {
        return anyValue.toDate()
      } catch (error) {
        console.warn('[customers] Failed to convert timestamp via toDate', error)
      }
    }
    if (typeof anyValue.seconds === 'number') {
      const millis = anyValue.seconds * 1000 + Math.round((anyValue.nanoseconds ?? 0) / 1_000_000)
      return Number.isFinite(millis) ? new Date(millis) : null
    }
  }
  return null
}

function getOutstandingCents(customer: Pick<Customer, 'debt'>): number {
  const raw = customer.debt?.outstandingCents
  const asNumber = typeof raw === 'number' ? raw : Number(raw ?? 0)
  return Number.isFinite(asNumber) ? asNumber : 0
}

function parseAmountToCents(input: string): number | null {
  const normalized = input.replace(/,/g, '').trim()
  if (!normalized) return null
  const value = Number.parseFloat(normalized)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}

function parseDateInput(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? null : new Date(parsed)
}

function normalizeBirthdateInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }
  const normalized = new Date(parsed)
  return Number.isNaN(normalized.getTime()) ? null : normalized.toISOString().slice(0, 10)
}

function normalizeBirthdate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : new Date(parsed)
  }
  return normalizeDateLike(value)
}

function formatDate(date: Date | null): string {
  if (!date) return '—'
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let current = ''
  let row: string[] = []
  let insideQuotes = false

  const pushValue = () => {
    row.push(current)
    current = ''
  }

  const pushRow = () => {
    if (!row.length) return
    rows.push(row.map(cell => cell.trim()))
    row = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (insideQuotes && text[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        insideQuotes = !insideQuotes
      }
    } else if (char === ',' && !insideQuotes) {
      pushValue()
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1
      }
      pushValue()
      if (row.some(cell => cell.trim().length > 0)) {
        pushRow()
      } else {
        row = []
      }
    } else {
      current += char
    }
  }

  if (current.length > 0 || row.length > 0) {
    pushValue()
    if (row.some(cell => cell.trim().length > 0)) {
      pushRow()
    }
  }

  return rows
}

function buildCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const AFRICAN_COUNTRY_CODES = [
  '233',
  '234',
  '225',
  '221',
  '237',
  '254',
  '255',
  '256',
  '250',
  '251',
  '260',
  '263',
  '27',
  '20',
  '212',
  '213',
  '216',
]

export function normalizePhoneNumber(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''

  const hasPlusPrefix = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (!digits) return ''

  if (hasPlusPrefix) return `+${digits}`

  if (trimmed.startsWith('00')) {
    return `+${digits.replace(/^00/, '')}`
  }

  if (trimmed.startsWith('0')) {
    return `+233${digits.replace(/^0/, '')}`
  }

  const matchesAfricanCode = AFRICAN_COUNTRY_CODES.some(code =>
    digits.startsWith(code),
  )
  if (matchesAfricanCode) {
    return `+${digits}`
  }

  return `+${digits}`
}

function buildPhoneKey(value: string | null | undefined): string {
  if (!value) return ''
  return normalizePhoneNumber(value).replace(/\D/g, '')
}

function createInviteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 24)
  }
  return Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 14)
}

function normalizeColorInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '#4f46e5'
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : '#4f46e5'
}

export default function Customers() {
  const { storeId: activeStoreId } = useActiveStore()
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [birthdateInput, setBirthdateInput] = useState('')
  const [debtAmountInput, setDebtAmountInput] = useState('')
  const [debtDueDateInput, setDebtDueDateInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const messageTimeoutRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [customerStats, setCustomerStats] = useState<Record<string, CustomerStats>>({})
  const [salesHistory, setSalesHistory] = useState<Record<string, SaleHistoryEntry[]>>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [quickFilter, setQuickFilter] = useState<
    'all' | 'recent' | 'noPurchases' | 'highValue' | 'untagged' | 'hasDebt'
  >('all')
  const [messageChannel, setMessageChannel] = useState<MessageChannel | null>(null)
  const [messageBody, setMessageBody] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<CustomerTab>('view')
  const [inviteId, setInviteId] = useState<string | null>(null)
  const [inviteStatus, setInviteStatus] = useState<'active' | 'revoked'>('active')
  const [inviteHeadline, setInviteHeadline] = useState('Hello, kindly scan to join our customer list.')
  const [inviteTagline, setInviteTagline] = useState('Share your details so we can serve you better.')
  const [inviteCta, setInviteCta] = useState('Join now for updates and priority support.')
  const [inviteAccentColor, setInviteAccentColor] = useState('#4f46e5')
  const [inviteLogoUrl, setInviteLogoUrl] = useState('')
  const [savingInviteSettings, setSavingInviteSettings] = useState(false)
  const intakeLink = useMemo(() => {
    if (!inviteId || typeof window === 'undefined') return null
    return `${window.location.origin}/join-customers/${encodeURIComponent(inviteId)}`
  }, [inviteId])
  const intakeQrLink = useMemo(() => {
    if (!intakeLink) return null
    return `${intakeLink}/qr`
  }, [intakeLink])
  useEffect(() => {
    return () => {
      if (messageTimeoutRef.current) {
        window.clearTimeout(messageTimeoutRef.current)
        messageTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadInviteSettings() {
      if (!activeStoreId) {
        setInviteId(null)
        setInviteStatus('active')
        return
      }
      try {
        const snapshot = await getDoc(doc(db, 'stores', activeStoreId))
        const data = snapshot.data() as Record<string, unknown> | undefined
        if (cancelled) return
        setInviteId(
          typeof data?.customerIntakeInviteId === 'string' && data.customerIntakeInviteId.trim()
            ? data.customerIntakeInviteId.trim()
            : null,
        )
        setInviteStatus(data?.customerIntakeInviteStatus === 'revoked' ? 'revoked' : 'active')
        setInviteHeadline(
          typeof data?.customerIntakeHeadline === 'string' && data.customerIntakeHeadline.trim()
            ? data.customerIntakeHeadline.trim()
            : 'Hello, kindly scan to join our customer list.',
        )
        setInviteTagline(
          typeof data?.customerIntakeTagline === 'string' && data.customerIntakeTagline.trim()
            ? data.customerIntakeTagline.trim()
            : 'Share your details so we can serve you better.',
        )
        setInviteCta(
          typeof data?.customerIntakeCta === 'string' && data.customerIntakeCta.trim()
            ? data.customerIntakeCta.trim()
            : 'Join now for updates and priority support.',
        )
        setInviteAccentColor(
          normalizeColorInput(typeof data?.customerIntakeAccentColor === 'string' ? data.customerIntakeAccentColor : ''),
        )
        setInviteLogoUrl(
          typeof data?.customerIntakeLogoUrl === 'string' ? data.customerIntakeLogoUrl.trim() : '',
        )
      } catch (loadError) {
        console.error('[customers] Failed to load invite settings', loadError)
      }
    }
    void loadInviteSettings()
    return () => {
      cancelled = true
    }
  }, [activeStoreId])

  function showSuccess(message: string) {
    setSuccess(message)
    if (messageTimeoutRef.current) {
      window.clearTimeout(messageTimeoutRef.current)
    }
    messageTimeoutRef.current = window.setTimeout(() => {
      setSuccess(null)
      messageTimeoutRef.current = null
    }, 4000)
  }

  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setCustomers([])
      return () => {
        cancelled = true
      }
    }

    loadCachedCustomers<Customer>({ storeId: activeStoreId })
      .then(cached => {
        if (!cancelled && cached.length) {
          setCustomers(
            [...cached].sort((a, b) =>
              getCustomerSortKey(a).localeCompare(getCustomerSortKey(b), undefined, {
                sensitivity: 'base',
              }),
            ),
          )
        }
      })
      .catch(error => {
        console.warn('[customers] Failed to load cached customers', error)
      })

    const q = query(
      collection(db, 'customers'),
      where('storeId', '==', activeStoreId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(CUSTOMER_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(q, snap => {
      const rows = snap.docs.map(docSnap => {
        const data = docSnap.data() as Omit<Customer, 'id'>
        return {
          id: docSnap.id,
          ...data,
        }
      })
      saveCachedCustomers(rows, { storeId: activeStoreId }).catch(error => {
        console.warn('[customers] Failed to cache customers', error)
      })
      const sortedRows = [...rows].sort((a, b) =>
        getCustomerSortKey(a).localeCompare(getCustomerSortKey(b), undefined, {
          sensitivity: 'base',
        }),
      )
      setCustomers(sortedRows)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeStoreId])

  function normalizeSaleDate(value: unknown): Date | null {
    return normalizeDateLike(value)
  }

  function applySalesData(records: CachedSaleRecord[]) {
    const statsMap: Record<string, CustomerStats> = {}
    const historyMap: Record<string, SaleHistoryEntry[]> = {}
    const customerIdByName = new Map<string, string>()
    const customerIdByPhone = new Map<string, string>()

    customers.forEach(customer => {
      const displayName = getCustomerDisplayName(customer).trim().toLowerCase()
      if (displayName) {
        customerIdByName.set(displayName, customer.id)
      }
      if (customer.phone) {
        customerIdByPhone.set(normalizePhoneNumber(customer.phone), customer.id)
      }
    })

    records.forEach(record => {
      if (!record) return
      if (String(record.status ?? '').toLowerCase() === 'voided') return
      const customer =
        record.customer && typeof record.customer === 'object'
          ? (record.customer as { id?: string | null; name?: string | null; phone?: string | null })
          : null
      const fallbackCustomerId =
        (customer?.phone ? customerIdByPhone.get(normalizePhoneNumber(customer.phone)) : null) ??
        (customer?.name ? customerIdByName.get(customer.name.trim().toLowerCase()) : null) ??
        null
      const customerId = customer?.id ?? fallbackCustomerId
      if (!customerId) return

      const createdAt = normalizeSaleDate(record.createdAt)
      const total = Number(record.total ?? 0) || 0
      const paymentMethod =
        record.payment && typeof record.payment === 'object'
          ? (record.payment as { method?: string | null }).method ?? null
          : null
      const amountPaidRaw =
        record.payment && typeof record.payment === 'object'
          ? (record.payment as { amountPaid?: unknown }).amountPaid
          : null
      const amountPaid =
        typeof amountPaidRaw === 'number' && Number.isFinite(amountPaidRaw) ? amountPaidRaw : null
      const changeDueRaw =
        record.payment && typeof record.payment === 'object'
          ? (record.payment as { changeDue?: unknown }).changeDue
          : null
      const changeDue =
        typeof changeDueRaw === 'number' && Number.isFinite(changeDueRaw) ? changeDueRaw : null
      const itemsSource = Array.isArray(record.items) ? record.items : []
      const items = itemsSource.map(item =>
        item && typeof item === 'object'
          ? (item as { name?: string | null; qty?: number | null })
          : { name: null, qty: null },
      )

      if (!statsMap[customerId]) {
        statsMap[customerId] = { visits: 0, totalSpend: 0, lastVisit: null }
      }
      const stats = statsMap[customerId]
      stats.visits += 1
      stats.totalSpend += total
      if (!stats.lastVisit || (createdAt && stats.lastVisit < createdAt)) {
        stats.lastVisit = createdAt ?? stats.lastVisit
      }

      const entry: SaleHistoryEntry = {
        id: record.id,
        total,
        createdAt,
        paymentMethod,
        amountPaid,
        changeDue,
        items: items.map(item => ({
          name: item?.name ?? null,
          qty: item?.qty ?? null,
        })),
      }

      historyMap[customerId] = [...(historyMap[customerId] ?? []), entry]
    })

    Object.keys(historyMap).forEach(customerId => {
      historyMap[customerId] = historyMap[customerId].sort((a, b) => {
        const aTime = a.createdAt?.getTime?.() ?? 0
        const bTime = b.createdAt?.getTime?.() ?? 0
        return bTime - aTime
      })
    })

    setCustomerStats(statsMap)
    setSalesHistory(historyMap)
  }

  useEffect(() => {
    let cancelled = false

    if (!activeStoreId) {
      setCustomerStats({})
      setSalesHistory({})
      return () => {
        cancelled = true
      }
    }

    loadCachedSales<CachedSaleRecord>({ storeId: activeStoreId })
      .then(cached => {
        if (!cancelled && cached.length) {
          applySalesData(cached)
        }
      })
      .catch(error => {
        console.warn('[customers] Failed to load cached sales', error)
      })

    const q = query(
      collection(db, 'sales'),
      where('storeId', '==', activeStoreId),
      orderBy('createdAt', 'desc'),
      limit(SALES_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(q, snapshot => {
      const rows = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...(docSnap.data() as any) }))
      applySalesData(rows)
      saveCachedSales(rows, { storeId: activeStoreId }).catch(error => {
        console.warn('[customers] Failed to cache sales', error)
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeStoreId, customers])

  useEffect(() => {
    if (!selectedCustomerId) return
    const exists = customers.some(customer => customer.id === selectedCustomerId)
    if (!exists) {
      setSelectedCustomerId(null)
    }
  }, [customers, selectedCustomerId])

  useEffect(() => {
    if (!editingCustomerId) return
    const exists = customers.some(customer => customer.id === editingCustomerId)
    if (!exists) {
      setEditingCustomerId(null)
    }
  }, [customers, editingCustomerId])

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'GHS',
        minimumFractionDigits: 2,
      }),
    []
  )

  const logPaymentReminder = useMemo(() => httpsCallable(functions, 'logPaymentReminder'), [])

  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    customers.forEach(customer => {
      if (Array.isArray(customer.tags)) {
        customer.tags.forEach(tag => tagSet.add(tag))
      }
    })
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b))
  }, [customers])

  const filteredCustomers = useMemo(() => {
    const search = searchTerm.trim().toLowerCase()
    return customers.filter(customer => {
      const matchesSearch = search
        ? [
            getCustomerPrimaryName(customer),
            customer.email,
            customer.phone,
            customer.notes,
          ]
            .filter(value => typeof value === 'string' && value.trim().length > 0)
            .some(value => value!.toLowerCase().includes(search))
        : true

      const matchesTag = tagFilter ? customer.tags?.includes(tagFilter) : true
      const stats = customerStats[customer.id]
      const outstandingCents = getOutstandingCents(customer)

      let matchesQuick = true
      switch (quickFilter) {
        case 'recent': {
          if (!stats?.lastVisit) {
            matchesQuick = false
            break
          }
          const diffMs = Date.now() - stats.lastVisit.getTime()
          const diffDays = diffMs / (1000 * 60 * 60 * 24)
          matchesQuick = diffDays <= RECENT_VISIT_DAYS
          break
        }
        case 'noPurchases':
          matchesQuick = (stats?.visits ?? 0) === 0
          break
        case 'highValue':
          matchesQuick = (stats?.totalSpend ?? 0) >= HIGH_VALUE_THRESHOLD
          break
        case 'hasDebt':
          matchesQuick = outstandingCents > 0
          break
        case 'untagged':
          matchesQuick = !(customer.tags?.length)
          break
        default:
          matchesQuick = true
      }

      return matchesSearch && matchesTag && matchesQuick
    })
      .sort((a, b) => {
        if (quickFilter !== 'hasDebt') {
          return 0
        }
        const debtDiff = getOutstandingCents(b) - getOutstandingCents(a)
        if (debtDiff !== 0) return debtDiff
        const dueA = normalizeDateLike(a.debt?.dueDate)
        const dueB = normalizeDateLike(b.debt?.dueDate)
        if (dueA && dueB) return dueA.getTime() - dueB.getTime()
        if (dueA && !dueB) return -1
        if (!dueA && dueB) return 1
        return getCustomerSortKey(a).localeCompare(getCustomerSortKey(b), undefined, {
          sensitivity: 'base',
        })
      })
  }, [customers, searchTerm, tagFilter, quickFilter, customerStats])

  const selectedCustomer = selectedCustomerId
    ? customers.find(customer => customer.id === selectedCustomerId) ?? null
    : null

  const selectedCustomerName = selectedCustomer
    ? getCustomerDisplayName(selectedCustomer)
    : '—'

  const selectedCustomerHistory = selectedCustomerId
    ? salesHistory[selectedCustomerId] ?? []
    : []

  const selectedCustomerStats = selectedCustomerId
    ? customerStats[selectedCustomerId] ?? { visits: 0, totalSpend: 0, lastVisit: null }
    : { visits: 0, totalSpend: 0, lastVisit: null }

  const selectedBirthdate = normalizeBirthdate(selectedCustomer?.birthdate)
  const selectedOutstandingCents = selectedCustomer ? getOutstandingCents(selectedCustomer) : 0
  const selectedDueDate = normalizeDateLike(selectedCustomer?.debt?.dueDate)
  const selectedLastReminder = normalizeDateLike(selectedCustomer?.debt?.lastReminderAt)

  const formattedOutstandingAmount = useMemo(
    () =>
      selectedOutstandingCents > 0
        ? currencyFormatter.format(Math.abs(selectedOutstandingCents) / 100)
        : '',
    [currencyFormatter, selectedOutstandingCents],
  )

  const dueDateMessageLabel = useMemo(() => {
    if (!selectedDueDate) return ''
    return selectedDueDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }, [selectedDueDate])

  const normalizedSelectedPhone = selectedCustomer?.phone
    ? normalizePhoneNumber(selectedCustomer.phone)
    : ''
  const selectedCustomerPhoneForDisplay = normalizedSelectedPhone || selectedCustomer?.phone || ''
  const whatsappLink = normalizedSelectedPhone
    ? `https://wa.me/${normalizedSelectedPhone.replace(/^\+/, '')}`
    : ''
  const telegramLink = normalizedSelectedPhone
    ? `https://t.me/${normalizedSelectedPhone.startsWith('+') ? normalizedSelectedPhone : `+${normalizedSelectedPhone}`}`
    : ''
  const emailLink = selectedCustomer?.email?.trim()
    ? `mailto:${selectedCustomer.email.trim()}`
    : ''

  const messageTemplates = useMemo(() => {
    const baseTemplates = [
      {
        id: 'thank-you',
        title: 'Thank you for your visit',
        body: `Hi ${selectedCustomerName || 'there'}, thanks for stopping by today. Let me know if you have any questions about your purchase.`,
      },
      {
        id: 'new-arrivals',
        title: 'Share new arrivals',
        body: `Hi ${selectedCustomerName || 'there'}, we just stocked a few new items that match what you like. Want me to reserve something for you?`,
      },
      {
        id: 'feedback',
        title: 'Ask for feedback',
        body: `Hello ${selectedCustomerName || 'there'}, I hope you enjoyed your recent experience. I would love to hear any feedback so we can serve you even better.`,
      },
      {
        id: 'follow-up',
        title: 'Follow up on inquiry',
        body: `${selectedCustomerName || 'Hi there'}, I’m following up on your last inquiry. Do you want me to prepare a quote or send more details?`,
      },
    ]

    if (selectedOutstandingCents > 0) {
      const dueDateText = dueDateMessageLabel ? ` by ${dueDateMessageLabel}` : ''
      const reminderTemplates = [
        {
          id: 'payment-reminder',
          title: 'Payment reminder',
          body: `Hi ${selectedCustomerName || 'there'}, this is a friendly reminder about your ${formattedOutstandingAmount} balance due${dueDateText}. Can I help you settle it today?`,
        },
        {
          id: 'overdue-notice',
          title: 'Overdue notice',
          body: `Hello ${selectedCustomerName || 'there'}, your account shows an overdue balance of ${formattedOutstandingAmount}${dueDateText ? ` (due ${dueDateMessageLabel})` : ''}. Let me know if you need an updated invoice to complete payment.`,
        },
      ]

      return [...reminderTemplates, ...baseTemplates]
    }

    return baseTemplates
  }, [
    dueDateMessageLabel,
    formattedOutstandingAmount,
    selectedCustomerName,
    selectedOutstandingCents,
  ])

  function openExternal(link: string | null) {
    if (!link) return
    window.open(link, '_blank', 'noreferrer')
  }

  function handleStartSale() {
    if (!selectedCustomerId) return
    navigate(`/sell?customerId=${encodeURIComponent(selectedCustomerId)}`)
  }

  function openMessageComposer(channel: MessageChannel) {
    if (!selectedCustomerId) return
    setMessageChannel(channel)
    setMessageBody(messageTemplates[0]?.body ?? '')
    setSelectedTemplateId(messageTemplates[0]?.id ?? null)
  }

  function closeMessageComposer() {
    setMessageChannel(null)
    setMessageBody('')
    setSelectedTemplateId(null)
  }

  function getChannelLabel(channel: MessageChannel | null): string {
    switch (channel) {
      case 'whatsapp':
        return 'WhatsApp'
      case 'telegram':
        return 'Telegram'
      case 'email':
        return 'email'
      default:
        return 'message'
    }
  }

  function buildMessageLink(channel: MessageChannel, message: string): string | null {
    if (!message.trim()) return null
    const encodedMessage = encodeURIComponent(message.trim())

    switch (channel) {
      case 'whatsapp':
        return whatsappLink ? `${whatsappLink}?text=${encodedMessage}` : null
      case 'telegram': {
        if (normalizedSelectedPhone) {
          return `${telegramLink}?text=${encodedMessage}`
        }
        return `https://t.me/share/url?text=${encodedMessage}`
      }
      case 'email': {
        const subject = encodeURIComponent(`Message for ${selectedCustomerName || 'you'}`)
        return emailLink ? `${emailLink}?subject=${subject}&body=${encodedMessage}` : null
      }
      default:
        return null
    }
  }

  function handleSendMessage() {
    if (!messageChannel) return
    const link = buildMessageLink(messageChannel, messageBody)
    if (!link) return

    const isReminderTemplateSelected =
      selectedTemplateId !== null && REMINDER_TEMPLATE_IDS.has(selectedTemplateId)

    if (isReminderTemplateSelected && activeStoreId && selectedCustomerId && selectedOutstandingCents > 0) {
      void logPaymentReminder({
        storeId: activeStoreId,
        customerId: selectedCustomerId,
        customerName: selectedCustomerName ? selectedCustomerName : null,
        templateId: selectedTemplateId,
        channel: messageChannel,
        status: 'attempt',
        amountCents: selectedOutstandingCents,
        dueDate: selectedDueDate ? selectedDueDate.toISOString() : null,
      }).catch(error => {
        console.warn('[customers] Failed to log payment reminder', error)
      })
    }

    openExternal(link)
    closeMessageComposer()
  }

  function resetForm() {
    setName('')
    setPhone('')
    setEmail('')
    setNotes('')
    setTagsInput('')
    setBirthdateInput('')
    setDebtAmountInput('')
    setDebtDueDateInput('')
    setEditingCustomerId(null)
    setError(null)
  }

  async function addCustomer(event: React.FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Customer name is required to save a record.')
      return
    }
    if (!activeStoreId) {
      setError('Select a workspace before saving customers.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const parsedTags = normalizeTags(tagsInput)
      const normalizedPhone = normalizePhoneNumber(phone)
      const normalizedBirthdate = normalizeBirthdateInput(birthdateInput)
      const parsedDebtCents = parseAmountToCents(debtAmountInput)
      const parsedDueDate = parseDateInput(debtDueDateInput)
      if (editingCustomerId) {
        const updatePayload: Record<string, unknown> = {
          name: trimmedName,
          updatedAt: serverTimestamp(),
          storeId: activeStoreId,
        }
        updatePayload.phone = normalizedPhone ? normalizedPhone : null
        updatePayload.email = email.trim() ? email.trim() : null
        updatePayload.notes = notes.trim() ? notes.trim() : null
        updatePayload.tags = parsedTags
        updatePayload.birthdate = normalizedBirthdate ? normalizedBirthdate : null

        if (parsedDebtCents && parsedDebtCents > 0) {
          updatePayload['debt.outstandingCents'] = parsedDebtCents
          updatePayload['debt.dueDate'] = parsedDueDate ?? null
        } else {
          updatePayload.debt = null
        }
        await updateDoc(doc(db, 'customers', editingCustomerId), updatePayload)
        setSelectedCustomerId(editingCustomerId)
        showSuccess('Customer updated successfully.')
      } else {
        await addDoc(collection(db, 'customers'), {
          name: trimmedName,
          storeId: activeStoreId,
          ...(normalizedPhone ? { phone: normalizedPhone } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(parsedTags.length ? { tags: parsedTags } : {}),
          ...(normalizedBirthdate ? { birthdate: normalizedBirthdate } : {}),
          ...(parsedDebtCents && parsedDebtCents > 0
            ? { debt: { outstandingCents: parsedDebtCents, dueDate: parsedDueDate ?? null } }
            : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        showSuccess('Customer saved successfully.')
      }
      resetForm()
    } catch (err) {
      console.error('[customers] Unable to save customer', err)
      setError('We could not save this customer. Please try again.')
      setSuccess(null)
    } finally {
      setBusy(false)
    }
  }

  async function removeCustomer(id: string) {
    if (!id) return
    const confirmation = window.confirm('Remove this customer?')
    if (!confirmation) return
    setBusy(true)
    try {
      await deleteDoc(doc(db, 'customers', id))
      showSuccess('Customer removed.')
      if (selectedCustomerId === id) {
        setSelectedCustomerId(null)
      }
      if (editingCustomerId === id) {
        resetForm()
      }
    } catch (err) {
      console.error('[customers] Unable to delete customer', err)
      setError('Unable to delete this customer right now.')
      setSuccess(null)
    } finally {
      setBusy(false)
    }
  }

  async function handleCsvImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setIsImporting(true)
    setError(null)
    try {
      if (!activeStoreId) {
        throw new Error('Select a workspace before importing customers.')
      }

      const text = await file.text()
      const rows = parseCsv(text)
      if (!rows.length) {
        throw new Error('No rows detected in the file.')
      }

      const [header, ...dataRows] = rows
      const headers = header.map(cell => cell.toLowerCase())
      const nameIndex = headers.indexOf('name')
      if (nameIndex < 0) {
        throw new Error('A "name" column is required to import customers.')
      }

      const phoneIndex = headers.indexOf('phone')
      const emailIndex = headers.indexOf('email')
      const notesIndex = headers.indexOf('notes')
      const tagsIndex = headers.indexOf('tags')
      const birthdateIndex = headers.indexOf('birthdate')

      const existingByEmail = new Map<string, string>()
      const existingByPhone = new Map<string, string>()
      customers.forEach(customer => {
        if (customer.email) {
          existingByEmail.set(customer.email.toLowerCase(), customer.id)
        }
        if (customer.phone) {
          existingByPhone.set(buildPhoneKey(customer.phone), customer.id)
        }
      })

      let newCount = 0
      let updatedCount = 0

      for (const row of dataRows) {
        if (!row.length) continue
        const rawName = row[nameIndex]?.trim()
        if (!rawName) continue
        const rawPhone = phoneIndex >= 0 ? row[phoneIndex]?.trim() ?? '' : ''
        const rawEmail = emailIndex >= 0 ? row[emailIndex]?.trim() ?? '' : ''
        const rawNotes = notesIndex >= 0 ? row[notesIndex]?.trim() ?? '' : ''
        const rawTags = tagsIndex >= 0 ? row[tagsIndex] ?? '' : ''
        const parsedTags = tagsIndex >= 0 ? normalizeTags(rawTags) : undefined
        const rawBirthdate = birthdateIndex >= 0 ? row[birthdateIndex]?.trim() ?? '' : ''
        const parsedBirthdate = birthdateIndex >= 0 ? normalizeBirthdateInput(rawBirthdate) : null

        const normalizedPhone = normalizePhoneNumber(rawPhone)
        const emailKey = rawEmail.toLowerCase()
        const existingId = emailKey
          ? existingByEmail.get(emailKey)
          : normalizedPhone
          ? existingByPhone.get(buildPhoneKey(normalizedPhone))
          : undefined

        if (existingId) {
          const payload: Record<string, unknown> = {
            name: rawName,
            updatedAt: serverTimestamp(),
            storeId: activeStoreId,
          }
          if (phoneIndex >= 0) {
            payload.phone = normalizedPhone ? normalizedPhone : null
          }
          if (emailIndex >= 0) {
            payload.email = rawEmail ? rawEmail : null
          }
          if (notesIndex >= 0) {
            payload.notes = rawNotes ? rawNotes : null
          }
          if (birthdateIndex >= 0) {
            payload.birthdate = parsedBirthdate ? parsedBirthdate : null
          }
          if (parsedTags) {
            payload.tags = parsedTags
          }
          await updateDoc(doc(db, 'customers', existingId), payload)
          updatedCount += 1
        } else {
          const payload: Record<string, unknown> = {
            name: rawName,
            createdAt: serverTimestamp(),
            storeId: activeStoreId,
          }
          if (normalizedPhone) {
            payload.phone = normalizedPhone
          }
          if (rawEmail) {
            payload.email = rawEmail
          }
          if (rawNotes) {
            payload.notes = rawNotes
          }
          if (parsedBirthdate) {
            payload.birthdate = parsedBirthdate
          }
          if (parsedTags && parsedTags.length) {
            payload.tags = parsedTags
          }
          await addDoc(collection(db, 'customers'), payload)
          newCount += 1
        }
      }

      if (!newCount && !updatedCount) {
        throw new Error('No valid customer rows were found in this file.')
      }

      showSuccess(`Imported ${newCount + updatedCount} customers (${newCount} new, ${updatedCount} updated).`)
    } catch (err) {
      console.error('[customers] Unable to import CSV', err)
      const message = err instanceof Error ? err.message : 'We were unable to import this file.'
      setError(message)
      setSuccess(null)
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  function exportToCsv() {
    const headers = ['Name', 'Phone', 'Email', 'Birthdate', 'Notes', 'Tags', 'Visits', 'Last visit', 'Total spend']
    const lines = customers.map(customer => {
      const stats = customerStats[customer.id]
      const visitCount = stats?.visits ?? 0
      const lastVisit = stats?.lastVisit ? stats.lastVisit.toISOString() : ''
      const totalSpend = stats?.totalSpend ?? 0
      const tags = (customer.tags ?? []).join(', ')
      const birthdate = normalizeBirthdate(customer.birthdate)
      const cells = [
        getCustomerPrimaryName(customer) || '',
        customer.phone ?? '',
        customer.email ?? '',
        birthdate ? birthdate.toISOString().slice(0, 10) : '',
        customer.notes ?? '',
        tags,
        String(visitCount),
        lastVisit,
        totalSpend.toFixed(2),
      ]
      return cells.map(buildCsvValue).join(',')
    })

    const csvContent = [headers.map(buildCsvValue).join(','), ...lines].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    link.download = `customers-${timestamp}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  function beginEdit(customer: Customer) {
    setActiveTab('add')
    setEditingCustomerId(customer.id)
    setName(getCustomerPrimaryName(customer))
    setPhone(customer.phone ?? '')
    setEmail(customer.email ?? '')
    setNotes(customer.notes ?? '')
    setTagsInput((customer.tags ?? []).join(', '))
    const birthdate = normalizeBirthdate(customer.birthdate)
    setBirthdateInput(birthdate ? birthdate.toISOString().slice(0, 10) : '')
    const outstandingCents = getOutstandingCents(customer)
    setDebtAmountInput(outstandingCents > 0 ? (outstandingCents / 100).toFixed(2) : '')
    const dueDate = normalizeDateLike(customer.debt?.dueDate)
    setDebtDueDateInput(dueDate ? dueDate.toISOString().slice(0, 10) : '')
  }

  function beginView(customer: Customer) {
    setActiveTab('view')
    setSelectedCustomerId(customer.id)
  }

  async function copyInviteLink(target: 'form' | 'qr') {
    const activeInviteId = await ensureInviteId()
    if (!activeInviteId) return
    const baseLink =
      typeof window !== 'undefined'
        ? `${window.location.origin}/join-customers/${encodeURIComponent(activeInviteId)}`
        : null
    const value = target === 'qr' ? (baseLink ? `${baseLink}/qr` : null) : baseLink
    if (!value) {
      setError('No store selected yet. Please refresh and try again.')
      return
    }

    try {
      await navigator.clipboard.writeText(value)
      showSuccess(target === 'qr' ? 'QR page link copied.' : 'Customer intake link copied.')
      setError(null)
    } catch (copyError) {
      console.error('[customers] Failed to copy invite link', copyError)
      setError('Could not copy link. Please copy it manually from the field.')
    }
  }

  async function ensureInviteId() {
    if (!activeStoreId) {
      setError('No active store selected.')
      return null
    }
    if (inviteId && inviteStatus === 'active') {
      return inviteId
    }
    const nextInviteId = createInviteId()
    setSavingInviteSettings(true)
    try {
      await updateDoc(doc(db, 'stores', activeStoreId), {
        customerIntakeInviteId: nextInviteId,
        customerIntakeInviteStatus: 'active',
        customerIntakeHeadline: inviteHeadline.trim(),
        customerIntakeTagline: inviteTagline.trim(),
        customerIntakeCta: inviteCta.trim(),
        customerIntakeAccentColor: normalizeColorInput(inviteAccentColor),
        customerIntakeLogoUrl: inviteLogoUrl.trim() || null,
        customerIntakeUpdatedAt: serverTimestamp(),
      })
      setInviteId(nextInviteId)
      setInviteStatus('active')
      showSuccess('Public invite link is ready.')
      return nextInviteId
    } catch (inviteError) {
      console.error('[customers] Failed to initialize invite id', inviteError)
      setError('Could not create invite link right now.')
      return null
    } finally {
      setSavingInviteSettings(false)
    }
  }

  async function rotateInviteId() {
    if (!activeStoreId) {
      setError('No active store selected.')
      return
    }
    const confirmed = window.confirm(
      'Rotate invite URL? Printed QR posters with the current link will stop working immediately.',
    )
    if (!confirmed) {
      return
    }
    const nextInviteId = createInviteId()
    setSavingInviteSettings(true)
    setError(null)
    try {
      await updateDoc(doc(db, 'stores', activeStoreId), {
        customerIntakeInviteId: nextInviteId,
        customerIntakeInviteStatus: 'active',
        customerIntakeUpdatedAt: serverTimestamp(),
      })
      setInviteId(nextInviteId)
      setInviteStatus('active')
      showSuccess('Invite link rotated. Previous URL is now disabled.')
    } catch (rotateError) {
      console.error('[customers] Failed to rotate invite id', rotateError)
      setError('Could not rotate invite link.')
    } finally {
      setSavingInviteSettings(false)
    }
  }

  async function toggleInviteStatus(nextStatus: 'active' | 'revoked') {
    if (!activeStoreId) {
      setError('No active store selected.')
      return
    }
    setSavingInviteSettings(true)
    try {
      await updateDoc(doc(db, 'stores', activeStoreId), {
        customerIntakeInviteStatus: nextStatus,
        customerIntakeUpdatedAt: serverTimestamp(),
      })
      setInviteStatus(nextStatus)
      showSuccess(nextStatus === 'active' ? 'Invite link activated.' : 'Invite link revoked.')
    } catch (statusError) {
      console.error('[customers] Failed to update invite status', statusError)
      setError('Could not update invite status.')
    } finally {
      setSavingInviteSettings(false)
    }
  }

  async function saveInviteBranding() {
    if (!activeStoreId) {
      setError('No active store selected.')
      return
    }
    setSavingInviteSettings(true)
    setError(null)
    try {
      await updateDoc(doc(db, 'stores', activeStoreId), {
        customerIntakeHeadline: inviteHeadline.trim() || 'Hello, kindly scan to join our customer list.',
        customerIntakeTagline: inviteTagline.trim() || 'Share your details so we can serve you better.',
        customerIntakeCta: inviteCta.trim() || 'Join now for updates and priority support.',
        customerIntakeAccentColor: normalizeColorInput(inviteAccentColor),
        customerIntakeLogoUrl: inviteLogoUrl.trim() || null,
        customerIntakeUpdatedAt: serverTimestamp(),
      })
      showSuccess('Invite branding saved.')
    } catch (brandingError) {
      console.error('[customers] Failed to save invite branding', brandingError)
      setError('Could not save invite branding settings.')
    } finally {
      setSavingInviteSettings(false)
    }
  }

  const isFormDisabled = busy || isImporting

  const totalShown = filteredCustomers.length

  const quickFilters: { id: typeof quickFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'recent', label: 'Visited recently' },
    { id: 'noPurchases', label: 'No purchases yet' },
    { id: 'highValue', label: 'High spenders' },
    { id: 'hasDebt', label: 'Has debt' },
    { id: 'untagged', label: 'Untagged' },
  ]

  return (
    <div className="page customers-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Customers</h2>
          <p className="page__subtitle">
            Keep a tidy record of your regulars and speed up checkout on the sales floor.
          </p>
        </div>
        <span className="customers-page__badge" aria-live="polite">
          {customers.length} saved • {totalShown} shown
        </span>
      </header>

      <div className="customers-page__grid">
        <div className="customers-page__tabs" role="tablist" aria-label="Customer sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'view'}
            className={`button button--small ${activeTab === 'view' ? 'button--primary' : 'button--ghost'}`}
            onClick={() => setActiveTab('view')}
          >
            View all customers
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'add'}
            className={`button button--small ${activeTab === 'add' ? 'button--primary' : 'button--ghost'}`}
            onClick={() => setActiveTab('add')}
          >
            Add new customer
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'invite'}
            className={`button button--small ${activeTab === 'invite' ? 'button--primary' : 'button--ghost'}`}
            onClick={() => setActiveTab('invite')}
          >
            Invite link & QR
          </button>
        </div>

        {activeTab === 'invite' ? (
          <section className="card" aria-label="Customer invite link">
            <div className="customers-page__section-header">
              <h3 className="card__title">Public customer intake</h3>
              <p className="card__subtitle">
                Share this public link so customers can submit their details directly into your customer list.
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="customer-intake-link">Public form link</label>
              <input
                id="customer-intake-link"
                readOnly
                value={intakeLink ?? ''}
                placeholder="Select an active store to generate the link"
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="customer-intake-qr-link">Printable QR page</label>
              <input
                id="customer-intake-qr-link"
                readOnly
                value={intakeQrLink ?? ''}
                placeholder="Select an active store to generate the QR page"
              />
            </div>

            <div className="customers-page__form-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => copyInviteLink('form')}
                disabled={savingInviteSettings}
              >
                Copy form link
              </button>
              <button
                type="button"
                className="button button--outline"
                onClick={() => copyInviteLink('qr')}
                disabled={savingInviteSettings}
              >
                Copy QR link
              </button>
              <button
                type="button"
                className="button button--outline"
                onClick={rotateInviteId}
                disabled={!activeStoreId || savingInviteSettings}
              >
                Rotate invite URL
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => toggleInviteStatus(inviteStatus === 'active' ? 'revoked' : 'active')}
                disabled={!inviteId || savingInviteSettings}
              >
                {inviteStatus === 'active' ? 'Revoke link' : 'Reactivate link'}
              </button>
              <a
                className={`button button--ghost${!intakeQrLink ? ' button--disabled' : ''}`}
                href={intakeQrLink ?? '#'}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!intakeQrLink}
                onClick={event => {
                  if (!intakeQrLink) event.preventDefault()
                }}
              >
                Open QR page
              </a>
            </div>

            <p className="card__subtitle">
              Invite status: <strong>{inviteStatus === 'active' ? 'Active' : 'Revoked'}</strong>
            </p>
            <p className="card__subtitle">
              QR links do not expire automatically. They remain valid until you manually rotate or revoke them.
            </p>

            <div className="customers-page__form-row">
              <div className="field">
                <label className="field__label" htmlFor="customer-invite-headline">QR poster headline</label>
                <input
                  id="customer-invite-headline"
                  value={inviteHeadline}
                  onChange={event => setInviteHeadline(event.target.value)}
                  placeholder="Hello, kindly scan to join our customer list."
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="customer-invite-cta">CTA sentence</label>
                <input
                  id="customer-invite-cta"
                  value={inviteCta}
                  onChange={event => setInviteCta(event.target.value)}
                  placeholder="Join now for updates and priority support."
                />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="customer-invite-tagline">Public form tagline</label>
              <input
                id="customer-invite-tagline"
                value={inviteTagline}
                onChange={event => setInviteTagline(event.target.value)}
                placeholder="Share your details so we can serve you better."
              />
            </div>

            <div className="customers-page__form-row">
              <div className="field">
                <label className="field__label" htmlFor="customer-invite-logo-url">Logo URL</label>
                <input
                  id="customer-invite-logo-url"
                  value={inviteLogoUrl}
                  onChange={event => setInviteLogoUrl(event.target.value)}
                  placeholder="https://example.com/logo.png"
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="customer-invite-accent">Accent color (#RRGGBB)</label>
                <input
                  id="customer-invite-accent"
                  value={inviteAccentColor}
                  onChange={event => setInviteAccentColor(event.target.value)}
                  placeholder="#4f46e5"
                />
              </div>
            </div>

            <div className="customers-page__form-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={saveInviteBranding}
                disabled={!activeStoreId || savingInviteSettings}
              >
                Save branding settings
              </button>
            </div>

            {error && <p className="customers-page__message customers-page__message--error">{error}</p>}
            {success && !error ? (
              <p className="customers-page__message customers-page__message--success" role="status">{success}</p>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'add' ? (
          <section className="card" aria-label="Add a customer">
          <div className="customers-page__section-header">
            <h3 className="card__title">{editingCustomerId ? 'Update customer' : 'New customer'}</h3>
            <p className="card__subtitle">
              {editingCustomerId
                ? 'Edit the selected profile to keep records accurate.'
                : 'Capture contact details so you can reuse them during checkout.'}
            </p>
          </div>

          <form className="customers-page__form" onSubmit={addCustomer}>
            <div className="field">
              <label className="field__label" htmlFor="customer-name">Full name</label>
              <input
                id="customer-name"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="e.g. Ama Mensah"
                disabled={isFormDisabled}
                required
              />
            </div>

            <div className="customers-page__form-row">
              <div className="field">
                <label className="field__label" htmlFor="customer-phone">Phone</label>
                <input
                  id="customer-phone"
                  value={phone}
                  onChange={event => setPhone(event.target.value)}
                  placeholder="024 000 0000"
                  disabled={isFormDisabled}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="customer-email">Email</label>
                <input
                  id="customer-email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  placeholder="ama@example.com"
                  disabled={isFormDisabled}
                  type="email"
                />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="customer-notes">Notes</label>
              <textarea
                id="customer-notes"
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="Birthday reminders, delivery addresses, favourite products…"
                rows={3}
                disabled={isFormDisabled}
              />
            </div>

            <div className="customers-page__form-row">
              <div className="field">
                <label className="field__label" htmlFor="customer-tags">Segmentation tags</label>
                <input
                  id="customer-tags"
                  value={tagsInput}
                  onChange={event => setTagsInput(event.target.value)}
                  placeholder="e.g. VIP, Wholesale, Birthday Club"
                  disabled={isFormDisabled}
                />
                <p className="field__hint">Separate multiple tags with commas to power quick filters and campaigns.</p>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="customer-birthdate">Birthdate</label>
                <input
                  id="customer-birthdate"
                  type="date"
                  value={birthdateInput}
                  onChange={event => setBirthdateInput(event.target.value)}
                  disabled={isFormDisabled}
                />
                <p className="field__hint">Add a birthdate so the dashboard can surface upcoming birthdays.</p>
              </div>
            </div>

            <div className="customers-page__form-row">
              <div className="field">
                <label className="field__label" htmlFor="customer-debt">Outstanding balance (GHS)</label>
                <input
                  id="customer-debt"
                  type="number"
                  min="0"
                  step="0.01"
                  value={debtAmountInput}
                  onChange={event => setDebtAmountInput(event.target.value)}
                  placeholder="e.g. 120.50"
                  disabled={isFormDisabled}
                />
                <p className="field__hint">
                  Capture any money owed by this customer so it appears in finance and dashboard debt metrics.
                </p>
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="customer-debt-due">Debt due date (optional)</label>
              <input
                id="customer-debt-due"
                type="date"
                value={debtDueDateInput}
                onChange={event => setDebtDueDateInput(event.target.value)}
                disabled={isFormDisabled}
              />
              <p className="field__hint">Add a due date to highlight overdue balances in reminders and reports.</p>
            </div>

            {error && <p className="customers-page__message customers-page__message--error">{error}</p>}
            {success && !error && (
              <p className="customers-page__message customers-page__message--success" role="status">{success}</p>
            )}
            <div className="customers-page__form-actions">
              <button type="submit" className="button button--primary" disabled={isFormDisabled}>
                {editingCustomerId ? 'Save changes' : 'Save customer'}
              </button>
              {editingCustomerId && (
                <button
                  type="button"
                  className="button button--outline"
                  onClick={resetForm}
                  disabled={isFormDisabled}
                >
                  Cancel edit
                </button>
              )}
            </div>

            <p className="field__hint">
              Customers saved here appear in the checkout flow. Visit the <Link to="/sell">Sell page</Link> to try it out.
            </p>
          </form>
          </section>
        ) : null}

        {activeTab === 'view' ? (
          <>
            <section className="card" aria-label="Saved customers">
          <div className="customers-page__section-header">
            <h3 className="card__title">Customer list</h3>
            <p className="card__subtitle">
              Stay organised and keep sales staff informed with up-to-date contact information.
            </p>
          </div>

          <div className="customers-page__toolbar">
            <div className="field customers-page__search-field">
              <label className="field__label" htmlFor="customer-search">Search</label>
              <input
                id="customer-search"
                placeholder="Search by name, phone, email, or notes"
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
              />
            </div>
            <div className="customers-page__tool-buttons">
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={exportToCsv}
                disabled={!customers.length}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="button button--outline button--small"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
              >
                {isImporting ? 'Importing…' : 'Import CSV'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                style={{ display: 'none' }}
                onChange={handleCsvImport}
              />
            </div>
          </div>

          <div className="customers-page__filters" role="group" aria-label="Quick filters">
            <span className="customers-page__filters-label">Quick filters:</span>
            <div className="customers-page__quick-filters">
              {quickFilters.map(filter => (
                <button
                  key={filter.id}
                  type="button"
                  className={`button button--ghost button--small${quickFilter === filter.id ? ' customers-page__quick-filter--active' : ''}`}
                  onClick={() => setQuickFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {allTags.length > 0 && (
            <div className="customers-page__tag-filters" role="group" aria-label="Tag filters">
              <span className="customers-page__filters-label">Tags:</span>
              <div className="customers-page__tag-chip-group">
                <button
                  type="button"
                  className={`button button--ghost button--small${tagFilter === null ? ' customers-page__quick-filter--active' : ''}`}
                  onClick={() => setTagFilter(null)}
                >
                  All tags
                </button>
                {allTags.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    className={`button button--ghost button--small${tagFilter === tag ? ' customers-page__quick-filter--active' : ''}`}
                    onClick={() => setTagFilter(tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredCustomers.length ? (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Tags</th>
                    <th scope="col">Visits</th>
                    <th scope="col">Last visit</th>
                    <th scope="col">Total spend</th>
                    <th scope="col">Debt</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map(customer => {
                    const contactBits = [customer.phone, customer.email].filter(Boolean).join(' • ')
                    const stats = customerStats[customer.id]
                    const visitCount = stats?.visits ?? 0
                    const lastVisit = stats?.lastVisit ?? null
                    const totalSpend = stats?.totalSpend ?? 0
                    const outstandingCents = getOutstandingCents(customer)
                    const hasDebt = outstandingCents > 0
                    const dueDate = normalizeDateLike(customer.debt?.dueDate)
                    const isSelected = selectedCustomerId === customer.id
                    const customerName = getCustomerDisplayName(customer)
                    return (
                      <tr
                        key={customer.id}
                        className={`customers-page__row${isSelected ? ' customers-page__row--selected' : ''}${
                          hasDebt ? ' customers-page__row--debt' : ''
                        }`}
                        onClick={() => beginView(customer)}
                      >
                        <td>{customerName}</td>
                        <td>{contactBits || '—'}</td>
                        <td>
                          {customer.tags?.length ? (
                            <div className="customers-page__tag-list" aria-label={`Tags for ${customerName}`}>
                              {customer.tags.map(tag => (
                                <span key={tag} className="customers-page__tag-chip">#{tag}</span>
                              ))}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{visitCount}</td>
                        <td>{lastVisit ? lastVisit.toLocaleDateString() : '—'}</td>
                        <td>{visitCount ? currencyFormatter.format(totalSpend) : '—'}</td>
                        <td>
                          {hasDebt ? (
                            <div className="customers-page__debt-cell" aria-label={`Debt for ${customerName}`}>
                              <div className="customers-page__debt-amount">
                                {currencyFormatter.format(outstandingCents / 100)}
                              </div>
                              <div className="customers-page__debt-meta">
                                {dueDate ? `Due ${dueDate.toLocaleDateString()}` : 'No due date set'}
                              </div>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="customers-page__table-actions">
                          <button
                            type="button"
                            className="button button--ghost button--small"
                            onClick={event => {
                              event.stopPropagation()
                              beginView(customer)
                            }}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="button button--outline button--small"
                            onClick={event => {
                              event.stopPropagation()
                              beginEdit(customer)
                            }}
                            disabled={isFormDisabled && editingCustomerId !== customer.id}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="button button--danger button--small"
                            onClick={event => {
                              event.stopPropagation()
                              removeCustomer(customer.id)
                            }}
                            disabled={busy}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h3 className="empty-state__title">No customers match the current filters</h3>
              <p>Adjust your search or quick filters, or add customers using the form.</p>
            </div>
          )}
            </section>

            <section className="card customers-page__details" aria-label="Customer details">
          {selectedCustomer ? (
            <div className="customers-page__details-content">
              <div className="customers-page__section-header">
                <h3 className="card__title">{selectedCustomerName}</h3>
                <p className="card__subtitle">Deep dive into visits, spend, and notes.</p>
              </div>
              <dl className="customers-page__detail-list">
                <div>
                  <dt>Contact</dt>
                  <dd>
                    {selectedCustomerPhoneForDisplay ? <div>{selectedCustomerPhoneForDisplay}</div> : null}
                    {selectedCustomer.email ? <div>{selectedCustomer.email}</div> : null}
                    {!selectedCustomer.phone && !selectedCustomer.email ? '—' : null}
                  </dd>
                </div>
                <div>
                  <dt>Notes</dt>
                  <dd>{selectedCustomer.notes ? selectedCustomer.notes : '—'}</dd>
                </div>
                <div>
                  <dt>Birthdate</dt>
                  <dd>{selectedBirthdate ? selectedBirthdate.toLocaleDateString() : '—'}</dd>
                </div>
                <div>
                  <dt>Segmentation tags</dt>
                  <dd>
                    {selectedCustomer.tags?.length ? (
                      <div className="customers-page__tag-list">
                        {selectedCustomer.tags.map(tag => (
                          <span key={tag} className="customers-page__tag-chip">#{tag}</span>
                        ))}
                      </div>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Total visits</dt>
                  <dd>{selectedCustomerStats.visits}</dd>
                </div>
                <div>
                  <dt>Total spend</dt>
                  <dd>
                    {selectedCustomerStats.visits
                      ? currencyFormatter.format(selectedCustomerStats.totalSpend)
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Outstanding balance</dt>
                  <dd className={selectedOutstandingCents > 0 ? 'customers-page__debt-highlight' : ''}>
                    {selectedOutstandingCents > 0
                      ? currencyFormatter.format(selectedOutstandingCents / 100)
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Debt due date</dt>
                  <dd>{selectedDueDate ? selectedDueDate.toLocaleDateString() : '—'}</dd>
                </div>
                <div>
                  <dt>Last reminder sent</dt>
                  <dd>{selectedLastReminder ? formatDate(selectedLastReminder) : '—'}</dd>
                </div>
                <div>
                  <dt>Last visit</dt>
                  <dd>{formatDate(selectedCustomerStats.lastVisit)}</dd>
                </div>
              </dl>

              <div className="customers-page__action-grid">
                <div className="customers-page__action-card">
                  <h4 className="customers-page__action-title">Engage</h4>
                  <p className="customers-page__action-hint">Send a quick message right from this profile.</p>
                  <div className="customers-page__action-buttons">
                    <button
                      type="button"
                      className="button button--outline button--small"
                      disabled={!whatsappLink}
                      onClick={() => openMessageComposer('whatsapp')}
                    >
                      Send WhatsApp
                    </button>
                    <button
                      type="button"
                      className="button button--outline button--small"
                      disabled={!telegramLink}
                      onClick={() => openMessageComposer('telegram')}
                    >
                      Message on Telegram
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      disabled={!emailLink}
                      onClick={() => openMessageComposer('email')}
                    >
                      Send email
                    </button>
                  </div>
                  {!whatsappLink && !telegramLink && !emailLink ? (
                    <p className="customers-page__action-empty">Add contact info to reach out from here.</p>
                  ) : null}
                </div>

                <div className="customers-page__action-card">
                  <h4 className="customers-page__action-title">Shortcuts</h4>
                  <p className="customers-page__action-hint">Jump to related workflows for this customer.</p>
                  <div className="customers-page__action-buttons">
                    <button
                      type="button"
                      className="button button--primary button--small"
                      onClick={handleStartSale}
                      disabled={!selectedCustomerId}
                    >
                      Sell to customer
                    </button>
                  </div>
                </div>
              </div>

              <div className="customers-page__history">
                <h4>Recent transactions</h4>
                {selectedCustomerHistory.length ? (
                  <ul>
                    {selectedCustomerHistory.slice(0, 10).map(entry => (
                      <li key={entry.id}>
                        <div className="customers-page__history-row">
                          <span className="customers-page__history-primary">
                            {entry.createdAt ? entry.createdAt.toLocaleString() : 'Unknown date'}
                          </span>
                          <span className="customers-page__history-total">{currencyFormatter.format(entry.total)}</span>
                        </div>
                        <div className="customers-page__history-meta">
                          {entry.paymentMethod ? `Paid via ${entry.paymentMethod}` : 'Payment method not recorded'}
                        </div>
                        {(typeof entry.amountPaid === 'number' || typeof entry.changeDue === 'number') && (
                          <div className="customers-page__history-meta">
                            {typeof entry.amountPaid === 'number' ? `Amount paid: ${currencyFormatter.format(entry.amountPaid)}` : 'Amount paid: —'}
                            {typeof entry.changeDue === 'number' ? ` • Change: ${currencyFormatter.format(entry.changeDue)}` : ''}
                          </div>
                        )}
                        {entry.items?.length ? (
                          <div className="customers-page__history-items">
                            {entry.items.slice(0, 3).map((item, index) => (
                              <span key={`${entry.id}-${item?.name ?? index}`}>
                                {item?.qty ?? 0} × {item?.name ?? 'Item'}
                              </span>
                            ))}
                            {entry.items.length > 3 && <span>…</span>}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No sales recorded for this customer yet.</p>
                )}
              </div>

              <div className="customers-page__details-actions">
                <button
                  type="button"
                  className="button button--outline button--small"
                  onClick={() => beginEdit(selectedCustomer)}
                >
                  Edit details
                </button>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => setSelectedCustomerId(null)}
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="customers-page__details-empty">
              <h3>Select a customer to view CRM insights</h3>
              <p>
                Pick someone from the list to see their visit history, spending patterns, and notes. Use tags to
                segment audiences before launching campaigns.
              </p>
            </div>
          )}
            </section>
          </>
        ) : null}
      </div>

      {messageChannel ? (
        <div className="customers-page__dialog" role="dialog" aria-modal="true">
          <div className="customers-page__dialog-content">
            <div className="customers-page__dialog-head">
              <div>
                <p className="customers-page__dialog-subtitle">Quick templates</p>
                <h4 className="customers-page__dialog-title">
                  Send a {getChannelLabel(messageChannel)} to {selectedCustomerName}
                </h4>
              </div>
              <button type="button" className="customers-page__dialog-close" onClick={closeMessageComposer}>
                Close
              </button>
            </div>

            <div className="customers-page__template-list">
              {messageTemplates.map(template => (
                <div key={template.id} className="customers-page__template-card">
                  <div className="customers-page__template-header">
                    <h5>{template.title}</h5>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => {
                        setMessageBody(template.body)
                        setSelectedTemplateId(template.id)
                      }}
                    >
                      Use template
                    </button>
                  </div>
                  <p>{template.body}</p>
                </div>
              ))}
            </div>

            <label className="customers-page__composer-field">
              <span>Customize message</span>
              <textarea
                rows={4}
                value={messageBody}
                onChange={event => {
                  setMessageBody(event.target.value)
                  setSelectedTemplateId(null)
                }}
                placeholder="Type or tweak your message before sending"
              />
            </label>

            <div className="customers-page__dialog-actions">
              <button type="button" className="customers-page__cancel" onClick={closeMessageComposer}>
                Cancel
              </button>
              <button
                type="button"
                className="button button--primary"
                onClick={handleSendMessage}
                disabled={!messageBody.trim()}
              >
                Send via {getChannelLabel(messageChannel)}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
