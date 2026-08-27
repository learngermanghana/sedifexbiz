import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { db } from '../firebase'
import { useAuthUser } from '../hooks/useAuthUser'
import './EventModuleIntegrations.css'

export type EventIntegrationTab = 'vendors' | 'staff' | 'finance' | 'documents' | 'messages'

export type EventIntegrationContext = {
  id: string
  eventCode: string
  title: string
  clientName: string
  clientPhone: string
  clientEmail: string
  estimatedBudget: number | null
}

type CustomerRecord = {
  id: string
  name: string
  phone: string
  email: string
  notes: string
}

type StaffRecord = {
  id: string
  uid: string
  email: string
  role: 'owner' | 'staff'
  status: string
}

type VendorStatus = 'planned' | 'quoted' | 'confirmed' | 'completed' | 'cancelled'

type VendorAssignment = {
  customerId: string
  category: string
  quotedAmount: number
  depositPaid: number
  status: VendorStatus
  notes: string
}

type StaffAssignment = {
  memberId: string
  eventRole: string
  callTime: string
  notes: string
}

type EventIntegrations = {
  clientCustomerId: string
  vendors: VendorAssignment[]
  staff: StaffAssignment[]
  contractValue: number | null
}

type InvoiceRecord = {
  id: string
  number: string
  total: number
  status: string
  date: string
  eventId: string
  customerName: string
  customerPhone: string
  customerEmail: string
}

type ReceiptRecord = {
  id: string
  number: string
  amountPaid: number
  date: string
  paymentMethod: string
  eventId: string
  customerName: string
  customerPhone: string
  customerEmail: string
}

type ExpenseRecord = {
  id: string
  title: string
  category: string
  amount: number
  expenseDate: string
  paymentSource: string
  eventId: string
}

type ExpenseForm = {
  title: string
  category: string
  amount: string
  expenseDate: string
  paymentSource: string
}

const EMPTY_INTEGRATIONS: EventIntegrations = {
  clientCustomerId: '',
  vendors: [],
  staff: [],
  contractValue: null,
}

const VENDOR_STATUS_LABELS: Record<VendorStatus, string> = {
  planned: 'Planned',
  quoted: 'Quote received',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const PAYMENT_SOURCES = [
  ['bank', 'Bank account'],
  ['mobile_money', 'Mobile Money'],
  ['store_cash', 'Store cash'],
  ['petty_cash', 'Petty cash'],
  ['owner_staff_personal', 'Owner/staff paid personally'],
  ['fund_ledger', 'Donor/Fund Ledger'],
  ['other', 'Other source'],
] as const

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function amount(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value: number | null) {
  if (value === null) return 'Not set'
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    maximumFractionDigits: 2,
  }).format(value)
}

function phoneKey(value: string) {
  return value.replace(/\D/g, '')
}

function mapCustomer(id: string, data: Record<string, unknown>): CustomerRecord {
  return {
    id,
    name: clean(data.displayName) || clean(data.name) || clean(data.email) || clean(data.phone) || 'Unnamed contact',
    phone: clean(data.phone),
    email: clean(data.email).toLowerCase(),
    notes: clean(data.notes),
  }
}

function mapStaff(id: string, data: Record<string, unknown>): StaffRecord {
  return {
    id,
    uid: clean(data.uid) || id,
    email: clean(data.email) || 'Email not available',
    role: data.role === 'owner' ? 'owner' : 'staff',
    status: clean(data.status) || 'active',
  }
}

function mapVendor(value: unknown): VendorAssignment | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const customerId = clean(record.customerId)
  if (!customerId) return null
  const rawStatus = clean(record.status)
  const status: VendorStatus = ['planned', 'quoted', 'confirmed', 'completed', 'cancelled'].includes(rawStatus)
    ? rawStatus as VendorStatus
    : 'planned'
  return {
    customerId,
    category: clean(record.category) || 'Vendor',
    quotedAmount: Math.max(0, amount(record.quotedAmount)),
    depositPaid: Math.max(0, amount(record.depositPaid)),
    status,
    notes: clean(record.notes),
  }
}

function mapStaffAssignment(value: unknown): StaffAssignment | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const memberId = clean(record.memberId)
  if (!memberId) return null
  return {
    memberId,
    eventRole: clean(record.eventRole) || 'Event support',
    callTime: clean(record.callTime),
    notes: clean(record.notes),
  }
}

function mapIntegrations(value: unknown): EventIntegrations {
  if (!value || typeof value !== 'object') return { ...EMPTY_INTEGRATIONS }
  const record = value as Record<string, unknown>
  const finance = record.finance && typeof record.finance === 'object'
    ? record.finance as Record<string, unknown>
    : {}
  return {
    clientCustomerId: clean(record.clientCustomerId),
    vendors: Array.isArray(record.vendors)
      ? record.vendors.map(mapVendor).filter((entry): entry is VendorAssignment => Boolean(entry))
      : [],
    staff: Array.isArray(record.staff)
      ? record.staff.map(mapStaffAssignment).filter((entry): entry is StaffAssignment => Boolean(entry))
      : [],
    contractValue: typeof finance.contractValue === 'number' && Number.isFinite(finance.contractValue)
      ? Math.max(0, finance.contractValue)
      : null,
  }
}

function documentCustomer(data: Record<string, unknown>) {
  const customer = data.customer && typeof data.customer === 'object'
    ? data.customer as Record<string, unknown>
    : {}
  return {
    name: clean(customer.name),
    phone: clean(customer.phone),
    email: clean(customer.email).toLowerCase(),
  }
}

function mapInvoice(id: string, data: Record<string, unknown>): InvoiceRecord {
  const customer = documentCustomer(data)
  return {
    id,
    number: clean(data.invoiceNumber) || id,
    total: Math.max(0, amount(data.total)),
    status: clean(data.status) || 'draft',
    date: clean(data.invoiceDate),
    eventId: clean(data.eventId),
    customerName: customer.name,
    customerPhone: customer.phone,
    customerEmail: customer.email,
  }
}

function mapReceipt(id: string, data: Record<string, unknown>): ReceiptRecord {
  const customer = documentCustomer(data)
  return {
    id,
    number: clean(data.receiptNumber) || id,
    amountPaid: Math.max(0, amount(data.amountPaid)),
    date: clean(data.receiptDate),
    paymentMethod: clean(data.paymentMethod) || 'Payment',
    eventId: clean(data.eventId),
    customerName: customer.name,
    customerPhone: customer.phone,
    customerEmail: customer.email,
  }
}

function mapExpense(id: string, data: Record<string, unknown>): ExpenseRecord {
  return {
    id,
    title: clean(data.title) || 'Expense',
    category: clean(data.category) || 'Other',
    amount: Math.max(0, amount(data.amount)),
    expenseDate: clean(data.expenseDate),
    paymentSource: clean(data.paymentSource) || 'other',
    eventId: clean(data.eventId),
  }
}

function matchesEventClient(document: Pick<InvoiceRecord, 'customerName' | 'customerPhone' | 'customerEmail'>, event: EventIntegrationContext) {
  const eventEmail = event.clientEmail.trim().toLowerCase()
  const eventPhone = phoneKey(event.clientPhone)
  const eventName = event.clientName.trim().toLowerCase()
  const documentPhone = phoneKey(document.customerPhone)
  return Boolean(
    (eventEmail && document.customerEmail === eventEmail)
    || (eventPhone && documentPhone && documentPhone === eventPhone)
    || (eventName && document.customerName.trim().toLowerCase() === eventName),
  )
}

function queryString(event: EventIntegrationContext) {
  const params = new URLSearchParams({
    eventId: event.id,
    eventCode: event.eventCode,
    eventTitle: event.title,
    clientName: event.clientName,
  })
  if (event.clientPhone) params.set('clientPhone', event.clientPhone)
  if (event.clientEmail) params.set('clientEmail', event.clientEmail)
  return params.toString()
}

export default function EventModuleIntegrations({
  tab,
  storeId,
  event,
}: {
  tab: EventIntegrationTab
  storeId: string
  event: EventIntegrationContext
}) {
  const user = useAuthUser()
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [staffMembers, setStaffMembers] = useState<StaffRecord[]>([])
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([])
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([])
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [integrations, setIntegrations] = useState<EventIntegrations>({ ...EMPTY_INTEGRATIONS })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [clientCustomerId, setClientCustomerId] = useState('')
  const [newVendorCustomerId, setNewVendorCustomerId] = useState('')
  const [newVendorCategory, setNewVendorCategory] = useState('Vendor')
  const [newStaffMemberId, setNewStaffMemberId] = useState('')
  const [newStaffRole, setNewStaffRole] = useState('Event support')
  const [newStaffCallTime, setNewStaffCallTime] = useState('')
  const [contractValueInput, setContractValueInput] = useState('')
  const [expenseForm, setExpenseForm] = useState<ExpenseForm>({
    title: '',
    category: 'Event operations',
    amount: '',
    expenseDate: new Date().toISOString().slice(0, 10),
    paymentSource: 'petty_cash',
  })

  const eventRef = useMemo(() => doc(db, 'stores', storeId, 'events', event.id), [event.id, storeId])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [eventSnapshot, customerSnapshot, staffSnapshot, invoiceSnapshot, receiptSnapshot, expenseSnapshot] = await Promise.all([
        getDoc(eventRef),
        getDocs(query(collection(db, 'customers'), where('storeId', '==', storeId))),
        getDocs(query(collection(db, 'teamMembers'), where('storeId', '==', storeId))),
        getDocs(collection(db, 'stores', storeId, 'invoices')),
        getDocs(collection(db, 'stores', storeId, 'receipts')),
        getDocs(query(collection(db, 'expenses'), where('storeId', '==', storeId))),
      ])

      const eventData = eventSnapshot.exists() ? eventSnapshot.data() as Record<string, unknown> : {}
      const nextIntegrations = mapIntegrations(eventData.integrations)
      setIntegrations(nextIntegrations)
      setClientCustomerId(nextIntegrations.clientCustomerId)
      setContractValueInput(nextIntegrations.contractValue === null ? '' : String(nextIntegrations.contractValue))
      setCustomers(customerSnapshot.docs.map(item => mapCustomer(item.id, item.data())).sort((a, b) => a.name.localeCompare(b.name)))
      setStaffMembers(staffSnapshot.docs.map(item => mapStaff(item.id, item.data())).sort((a, b) => a.email.localeCompare(b.email)))
      setInvoices(invoiceSnapshot.docs.map(item => mapInvoice(item.id, item.data())))
      setReceipts(receiptSnapshot.docs.map(item => mapReceipt(item.id, item.data())))
      setExpenses(expenseSnapshot.docs.map(item => mapExpense(item.id, item.data())))
    } catch (loadError) {
      console.error('[event-integrations] Unable to load module data', loadError)
      setError('Sedifex could not load the connected customer, finance or staff records for this event.')
    } finally {
      setLoading(false)
    }
  }, [eventRef, storeId])

  useEffect(() => { void loadData() }, [loadData])

  const customerById = useMemo(() => new Map(customers.map(customer => [customer.id, customer])), [customers])
  const staffById = useMemo(() => new Map(staffMembers.map(member => [member.id, member])), [staffMembers])
  const linkedInvoices = useMemo(() => invoices.filter(invoice => invoice.eventId === event.id), [event.id, invoices])
  const linkedReceipts = useMemo(() => receipts.filter(receipt => receipt.eventId === event.id), [event.id, receipts])
  const linkedExpenses = useMemo(() => expenses.filter(expense => expense.eventId === event.id), [event.id, expenses])
  const invoiceCandidates = useMemo(() => invoices.filter(invoice => !invoice.eventId && matchesEventClient(invoice, event)).slice(0, 12), [event, invoices])
  const receiptCandidates = useMemo(() => receipts.filter(receipt => !receipt.eventId && matchesEventClient(receipt, event)).slice(0, 12), [event, receipts])
  const expenseCandidates = useMemo(() => expenses.filter(expense => !expense.eventId).slice(0, 12), [expenses])

  const vendorTotals = useMemo(() => integrations.vendors.reduce((totals, vendor) => {
    if (vendor.status === 'cancelled') return totals
    const quoted = Math.max(0, vendor.quotedAmount)
    const paid = Math.max(0, Math.min(vendor.depositPaid, quoted || vendor.depositPaid))
    return {
      quoted: totals.quoted + quoted,
      paid: totals.paid + paid,
      outstanding: totals.outstanding + Math.max(quoted - paid, 0),
    }
  }, { quoted: 0, paid: 0, outstanding: 0 }), [integrations.vendors])

  const finance = useMemo(() => {
    const invoiced = linkedInvoices.reduce((sum, invoice) => sum + invoice.total, 0)
    const received = linkedReceipts.reduce((sum, receipt) => sum + receipt.amountPaid, 0)
    const expensesTotal = linkedExpenses.reduce((sum, expense) => sum + expense.amount, 0)
    const contractValue = integrations.contractValue
    const balance = contractValue === null ? null : Math.max(contractValue - received, 0)
    const expectedProfit = contractValue === null
      ? null
      : contractValue - expensesTotal - vendorTotals.outstanding
    return { invoiced, received, expensesTotal, contractValue, balance, expectedProfit }
  }, [integrations.contractValue, linkedExpenses, linkedInvoices, linkedReceipts, vendorTotals.outstanding])

  const linkedClient = integrations.clientCustomerId ? customerById.get(integrations.clientCustomerId) ?? null : null
  const eventQuery = useMemo(() => queryString(event), [event])
  const quickPayUrl = `https://pay.sedifex.com/s/${encodeURIComponent(storeId)}?mode=store`

  async function persistField(path: string, value: unknown, successMessage: string) {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await updateDoc(eventRef, {
        [`integrations.${path}`]: value,
        updatedAt: serverTimestamp(),
      })
      setMessage(successMessage)
    } catch (saveError) {
      console.error('[event-integrations] Unable to save integration', saveError)
      setError('The event integration could not be saved. Please try again.')
      throw saveError
    } finally {
      setSaving(false)
    }
  }

  async function saveClientLink() {
    await persistField('clientCustomerId', clientCustomerId || null, clientCustomerId ? 'Client linked to the Sedifex customer record.' : 'Client customer link removed.')
    setIntegrations(previous => ({ ...previous, clientCustomerId }))
  }

  async function addVendor() {
    if (!newVendorCustomerId) {
      setError('Choose a customer/vendor contact first.')
      return
    }
    if (integrations.vendors.some(vendor => vendor.customerId === newVendorCustomerId)) {
      setError('That vendor is already assigned to this event.')
      return
    }
    const next = [...integrations.vendors, {
      customerId: newVendorCustomerId,
      category: newVendorCategory.trim() || 'Vendor',
      quotedAmount: 0,
      depositPaid: 0,
      status: 'planned' as VendorStatus,
      notes: '',
    }]
    await persistField('vendors', next, 'Vendor assigned to this event.')
    setIntegrations(previous => ({ ...previous, vendors: next }))
    setNewVendorCustomerId('')
    setNewVendorCategory('Vendor')
  }

  function patchVendor(customerId: string, patch: Partial<VendorAssignment>) {
    setIntegrations(previous => ({
      ...previous,
      vendors: previous.vendors.map(vendor => vendor.customerId === customerId ? { ...vendor, ...patch } : vendor),
    }))
  }

  async function saveVendors() {
    const normalized = integrations.vendors.map(vendor => ({
      ...vendor,
      category: vendor.category.trim() || 'Vendor',
      quotedAmount: Math.max(0, Number(vendor.quotedAmount) || 0),
      depositPaid: Math.max(0, Number(vendor.depositPaid) || 0),
      notes: vendor.notes.trim(),
    }))
    await persistField('vendors', normalized, 'Vendor commitments saved.')
    setIntegrations(previous => ({ ...previous, vendors: normalized }))
  }

  async function removeVendor(customerId: string) {
    const next = integrations.vendors.filter(vendor => vendor.customerId !== customerId)
    await persistField('vendors', next, 'Vendor removed from this event.')
    setIntegrations(previous => ({ ...previous, vendors: next }))
  }

  async function addStaff() {
    if (!newStaffMemberId) {
      setError('Choose a Sedifex staff member first.')
      return
    }
    if (integrations.staff.some(assignment => assignment.memberId === newStaffMemberId)) {
      setError('That staff member is already assigned to this event.')
      return
    }
    const next = [...integrations.staff, {
      memberId: newStaffMemberId,
      eventRole: newStaffRole.trim() || 'Event support',
      callTime: newStaffCallTime,
      notes: '',
    }]
    await persistField('staff', next, 'Staff member assigned to this event.')
    setIntegrations(previous => ({ ...previous, staff: next }))
    setNewStaffMemberId('')
    setNewStaffRole('Event support')
    setNewStaffCallTime('')
  }

  function patchStaff(memberId: string, patch: Partial<StaffAssignment>) {
    setIntegrations(previous => ({
      ...previous,
      staff: previous.staff.map(assignment => assignment.memberId === memberId ? { ...assignment, ...patch } : assignment),
    }))
  }

  async function saveStaff() {
    const normalized = integrations.staff.map(assignment => ({
      ...assignment,
      eventRole: assignment.eventRole.trim() || 'Event support',
      callTime: assignment.callTime.trim(),
      notes: assignment.notes.trim(),
    }))
    await persistField('staff', normalized, 'Event staff assignments saved.')
    setIntegrations(previous => ({ ...previous, staff: normalized }))
  }

  async function removeStaff(memberId: string) {
    const next = integrations.staff.filter(assignment => assignment.memberId !== memberId)
    await persistField('staff', next, 'Staff member removed from this event.')
    setIntegrations(previous => ({ ...previous, staff: next }))
  }

  async function saveContractValue() {
    const raw = contractValueInput.trim()
    const next = raw ? Number(raw) : null
    if (next !== null && (!Number.isFinite(next) || next < 0)) {
      setError('Enter a valid contract value.')
      return
    }
    await persistField('finance.contractValue', next, 'Contract value saved.')
    setIntegrations(previous => ({ ...previous, contractValue: next }))
  }

  async function recordExpense(eventSubmit: React.FormEvent) {
    eventSubmit.preventDefault()
    const expenseAmount = Number(expenseForm.amount)
    if (!expenseForm.title.trim() || !expenseForm.category.trim()) {
      setError('Enter the expense title and category.')
      return
    }
    if (!Number.isFinite(expenseAmount) || expenseAmount <= 0) {
      setError('Enter a valid expense amount.')
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await addDoc(collection(db, 'expenses'), {
        storeId,
        eventId: event.id,
        eventCode: event.eventCode,
        eventTitle: event.title,
        title: expenseForm.title.trim(),
        category: expenseForm.category.trim(),
        amount: expenseAmount,
        expenseDate: expenseForm.expenseDate || new Date().toISOString().slice(0, 10),
        paymentSource: expenseForm.paymentSource,
        paymentSourceLabel: PAYMENT_SOURCES.find(([value]) => value === expenseForm.paymentSource)?.[1] ?? 'Other source',
        payerName: null,
        reimbursementStatus: 'not_applicable',
        reimbursedAmount: 0,
        reimbursementDue: 0,
        notes: `Linked to ${event.eventCode} · ${event.title}`,
        receiptUrl: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user?.uid ?? null,
        updatedBy: user?.uid ?? null,
      })
      setExpenseForm({
        title: '',
        category: 'Event operations',
        amount: '',
        expenseDate: new Date().toISOString().slice(0, 10),
        paymentSource: 'petty_cash',
      })
      setMessage('Expense added to the main Sedifex Expenses ledger and linked to this event.')
      await loadData()
    } catch (saveError) {
      console.error('[event-integrations] Unable to record expense', saveError)
      setError('The event expense could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function linkInvoice(invoiceId: string) {
    setSaving(true)
    setError(null)
    try {
      await updateDoc(doc(db, 'stores', storeId, 'invoices', invoiceId), {
        eventId: event.id,
        eventCode: event.eventCode,
        eventTitle: event.title,
        updatedAt: serverTimestamp(),
      })
      setMessage('Invoice linked to this event.')
      await loadData()
    } catch (linkError) {
      console.error('[event-integrations] Unable to link invoice', linkError)
      setError('The invoice could not be linked to this event.')
    } finally {
      setSaving(false)
    }
  }

  async function linkReceipt(receiptId: string) {
    setSaving(true)
    setError(null)
    try {
      await updateDoc(doc(db, 'stores', storeId, 'receipts', receiptId), {
        eventId: event.id,
        eventCode: event.eventCode,
        eventTitle: event.title,
        updatedAt: serverTimestamp(),
      })
      setMessage('Receipt linked to this event.')
      await loadData()
    } catch (linkError) {
      console.error('[event-integrations] Unable to link receipt', linkError)
      setError('The receipt could not be linked to this event.')
    } finally {
      setSaving(false)
    }
  }

  async function linkExpense(expenseId: string) {
    setSaving(true)
    setError(null)
    try {
      await updateDoc(doc(db, 'expenses', expenseId), {
        eventId: event.id,
        eventCode: event.eventCode,
        eventTitle: event.title,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      })
      setMessage('Expense linked to this event.')
      await loadData()
    } catch (linkError) {
      console.error('[event-integrations] Unable to link expense', linkError)
      setError('The expense could not be linked to this event.')
    } finally {
      setSaving(false)
    }
  }

  async function copyEventContext() {
    const lines = [
      `${event.eventCode} · ${event.title}`,
      `Client: ${event.clientName}`,
      event.clientPhone ? `Phone: ${event.clientPhone}` : '',
      event.clientEmail ? `Email: ${event.clientEmail}` : '',
    ].filter(Boolean)
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setMessage('Event contact details copied.')
    } catch {
      setError('Copy failed. Please copy the event details manually.')
    }
  }

  if (loading) {
    return <section className="workspace-card event-integrations event-integrations__loading"><span className="event-integrations__spinner" /><p>Connecting Sedifex modules…</p></section>
  }

  const connectionBar = (
    <section className="workspace-card event-integrations__connection-card">
      <div>
        <p className="event-workspace__eyebrow">Connected records</p>
        <h2>Use existing Sedifex data</h2>
        <p>Contacts, staff, invoices, receipts and expenses stay in their main Sedifex modules. This event stores only the links and event-specific assignments.</p>
      </div>
      <div className="event-integrations__client-link">
        <label>
          Client customer record
          <select value={clientCustomerId} onChange={e => setClientCustomerId(e.target.value)}>
            <option value="">Not linked</option>
            {customers.map(customer => <option value={customer.id} key={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</option>)}
          </select>
        </label>
        <button type="button" className="button button--ghost" disabled={saving} onClick={() => void saveClientLink()}>Save client link</button>
        <Link className="button button--ghost" to="/customers">Open Customers</Link>
      </div>
      {linkedClient ? <p className="event-integrations__linked-note">Linked client: <strong>{linkedClient.name}</strong>{linkedClient.phone ? ` · ${linkedClient.phone}` : ''}{linkedClient.email ? ` · ${linkedClient.email}` : ''}</p> : null}
    </section>
  )

  return (
    <div className="event-integrations">
      {error ? <p className="event-integrations__alert event-integrations__alert--error">{error}</p> : null}
      {message ? <p className="event-integrations__alert event-integrations__alert--success">{message}<button type="button" onClick={() => setMessage(null)} aria-label="Dismiss">×</button></p> : null}
      {connectionBar}

      {tab === 'vendors' ? (
        <>
          <section className="event-integrations__metrics" aria-label="Vendor commitment summary">
            <article><span>Assigned vendors</span><strong>{integrations.vendors.length}</strong></article>
            <article><span>Quoted commitments</span><strong>{money(vendorTotals.quoted)}</strong></article>
            <article><span>Deposits / paid</span><strong>{money(vendorTotals.paid)}</strong></article>
            <article><span>Outstanding commitments</span><strong>{money(vendorTotals.outstanding)}</strong></article>
          </section>
          <section className="workspace-card event-integrations__panel">
            <header className="event-integrations__panel-heading">
              <div><p className="event-workspace__eyebrow">Vendors</p><h2>Assign existing customer/vendor contacts</h2><p>A vendor stays a normal Sedifex contact. Only the category, quote, deposit and event status are stored on this event.</p></div>
              <Link className="button button--ghost" to="/customers">Manage contacts</Link>
            </header>
            <div className="event-integrations__add-row">
              <label>Vendor contact<select value={newVendorCustomerId} onChange={e => setNewVendorCustomerId(e.target.value)}><option value="">Choose contact</option>{customers.filter(customer => !integrations.vendors.some(vendor => vendor.customerId === customer.id)).map(customer => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</option>)}</select></label>
              <label>Vendor category<input value={newVendorCategory} onChange={e => setNewVendorCategory(e.target.value)} placeholder="Catering, Decor, DJ…" /></label>
              <button type="button" className="button button--primary" disabled={saving} onClick={() => void addVendor()}>Assign vendor</button>
            </div>
            {integrations.vendors.length === 0 ? <div className="event-integrations__empty"><strong>No vendors assigned</strong><p>Add the vendor to Customers once, then assign that existing contact here.</p></div> : (
              <div className="event-integrations__cards">
                {integrations.vendors.map(vendor => {
                  const contact = customerById.get(vendor.customerId)
                  return <article className="event-integrations__assignment" key={vendor.customerId}>
                    <header><div><strong>{contact?.name || 'Contact no longer available'}</strong><span>{contact?.phone || contact?.email || vendor.customerId}</span></div><button type="button" className="event-integrations__remove" onClick={() => void removeVendor(vendor.customerId)}>Remove</button></header>
                    <div className="event-integrations__assignment-grid">
                      <label>Category<input value={vendor.category} onChange={e => patchVendor(vendor.customerId, { category: e.target.value })} /></label>
                      <label>Status<select value={vendor.status} onChange={e => patchVendor(vendor.customerId, { status: e.target.value as VendorStatus })}>{Object.entries(VENDOR_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <label>Quoted amount (GHS)<input type="number" min="0" step="0.01" value={vendor.quotedAmount || ''} onChange={e => patchVendor(vendor.customerId, { quotedAmount: Number(e.target.value) || 0 })} /></label>
                      <label>Deposit / amount paid (GHS)<input type="number" min="0" step="0.01" value={vendor.depositPaid || ''} onChange={e => patchVendor(vendor.customerId, { depositPaid: Number(e.target.value) || 0 })} /></label>
                      <label className="event-integrations__wide">Event notes<input value={vendor.notes} onChange={e => patchVendor(vendor.customerId, { notes: e.target.value })} placeholder="Delivery, balance due, contact instructions…" /></label>
                    </div>
                  </article>
                })}
              </div>
            )}
            {integrations.vendors.length ? <footer className="event-integrations__panel-actions"><button type="button" className="button button--primary" disabled={saving} onClick={() => void saveVendors()}>{saving ? 'Saving…' : 'Save vendor commitments'}</button></footer> : null}
          </section>
        </>
      ) : null}

      {tab === 'staff' ? (
        <section className="workspace-card event-integrations__panel">
          <header className="event-integrations__panel-heading">
            <div><p className="event-workspace__eyebrow">Staff</p><h2>Assign Sedifex team members</h2><p>Keep account access in Staff Management and store only the event role, call time and handover notes here.</p></div>
            <Link className="button button--ghost" to="/staff">Open Staff Management</Link>
          </header>
          <div className="event-integrations__add-row event-integrations__add-row--staff">
            <label>Team member<select value={newStaffMemberId} onChange={e => setNewStaffMemberId(e.target.value)}><option value="">Choose staff</option>{staffMembers.filter(member => !integrations.staff.some(assignment => assignment.memberId === member.id)).map(member => <option value={member.id} key={member.id}>{member.email} · {member.role}</option>)}</select></label>
            <label>Event role<input value={newStaffRole} onChange={e => setNewStaffRole(e.target.value)} placeholder="Lead coordinator" /></label>
            <label>Call time<input type="time" value={newStaffCallTime} onChange={e => setNewStaffCallTime(e.target.value)} /></label>
            <button type="button" className="button button--primary" disabled={saving} onClick={() => void addStaff()}>Assign staff</button>
          </div>
          {integrations.staff.length === 0 ? <div className="event-integrations__empty"><strong>No staff assigned</strong><p>Add staff in Sedifex Staff Management, then assign them to this event.</p></div> : (
            <div className="event-integrations__cards">
              {integrations.staff.map(assignment => {
                const member = staffById.get(assignment.memberId)
                return <article className="event-integrations__assignment" key={assignment.memberId}>
                  <header><div><strong>{member?.email || 'Team member no longer available'}</strong><span>{member ? `${member.role} · ${member.status}` : assignment.memberId}</span></div><button type="button" className="event-integrations__remove" onClick={() => void removeStaff(assignment.memberId)}>Remove</button></header>
                  <div className="event-integrations__assignment-grid">
                    <label>Event role<input value={assignment.eventRole} onChange={e => patchStaff(assignment.memberId, { eventRole: e.target.value })} /></label>
                    <label>Call time<input type="time" value={assignment.callTime} onChange={e => patchStaff(assignment.memberId, { callTime: e.target.value })} /></label>
                    <label className="event-integrations__wide">Responsibility / handover notes<input value={assignment.notes} onChange={e => patchStaff(assignment.memberId, { notes: e.target.value })} /></label>
                  </div>
                </article>
              })}
            </div>
          )}
          {integrations.staff.length ? <footer className="event-integrations__panel-actions"><button type="button" className="button button--primary" disabled={saving} onClick={() => void saveStaff()}>{saving ? 'Saving…' : 'Save staff assignments'}</button></footer> : null}
        </section>
      ) : null}

      {tab === 'finance' ? (
        <>
          <section className="event-integrations__metrics event-integrations__metrics--finance" aria-label="Event finance summary">
            <article><span>Client budget</span><strong>{money(event.estimatedBudget)}</strong></article>
            <article><span>Contract value</span><strong>{money(finance.contractValue)}</strong></article>
            <article><span>Amount received</span><strong>{money(finance.received)}</strong></article>
            <article><span>Client balance</span><strong>{money(finance.balance)}</strong></article>
            <article><span>Vendor commitments due</span><strong>{money(vendorTotals.outstanding)}</strong></article>
            <article><span>Recorded expenses</span><strong>{money(finance.expensesTotal)}</strong></article>
            <article><span>Expected profit</span><strong className={finance.expectedProfit !== null && finance.expectedProfit < 0 ? 'is-negative' : ''}>{money(finance.expectedProfit)}</strong></article>
            <article><span>Invoices issued</span><strong>{money(finance.invoiced)}</strong></article>
          </section>
          <section className="workspace-card event-integrations__panel">
            <header className="event-integrations__panel-heading"><div><p className="event-workspace__eyebrow">Finance</p><h2>Event financial control</h2><p>Invoices and receipts stay in Documents. Costs stay in Expenses. Vendor balances come from the vendor assignments above.</p></div></header>
            <div className="event-integrations__contract-row">
              <label>Contract value (GHS)<input type="number" min="0" step="0.01" value={contractValueInput} onChange={e => setContractValueInput(e.target.value)} placeholder="Agreed client contract total" /></label>
              <button type="button" className="button button--primary" disabled={saving} onClick={() => void saveContractValue()}>Save contract value</button>
            </div>
            <div className="event-integrations__module-actions">
              <Link className="button button--ghost" to={`/invoices?${eventQuery}`}>Create / manage invoices</Link>
              <Link className="button button--ghost" to={`/receipts?${eventQuery}`}>Create / manage receipts</Link>
              <Link className="button button--ghost" to="/expenses">Open full Expenses</Link>
              <Link className="button button--ghost" to="/quick-pay">Open Quick Pay</Link>
            </div>
            <p className="event-integrations__finance-note">Expected profit = contract value − recorded event expenses − outstanding vendor commitments. Record vendor deposits as expenses so the figure does not overstate profit.</p>
          </section>
          <section className="workspace-card event-integrations__panel">
            <header className="event-integrations__panel-heading"><div><p className="event-workspace__eyebrow">Expenses ledger</p><h2>Record an event expense</h2><p>This writes directly into the existing Sedifex Expenses collection with the event reference attached.</p></div><Link className="button button--ghost" to="/expenses">View all expenses</Link></header>
            <form className="event-integrations__expense-form" onSubmit={recordExpense}>
              <label>Expense title<input value={expenseForm.title} onChange={e => setExpenseForm({ ...expenseForm, title: e.target.value })} placeholder="Decorator deposit" /></label>
              <label>Category<input value={expenseForm.category} onChange={e => setExpenseForm({ ...expenseForm, category: e.target.value })} /></label>
              <label>Amount (GHS)<input type="number" min="0.01" step="0.01" value={expenseForm.amount} onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })} /></label>
              <label>Date<input type="date" value={expenseForm.expenseDate} onChange={e => setExpenseForm({ ...expenseForm, expenseDate: e.target.value })} /></label>
              <label>Payment source<select value={expenseForm.paymentSource} onChange={e => setExpenseForm({ ...expenseForm, paymentSource: e.target.value })}>{PAYMENT_SOURCES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Saving…' : 'Save event expense'}</button>
            </form>
            <div className="event-integrations__records">
              <h3>Linked expenses</h3>
              {linkedExpenses.length === 0 ? <p>No expenses are linked to this event yet.</p> : linkedExpenses.map(expense => <div className="event-integrations__record-row" key={expense.id}><div><strong>{expense.title}</strong><span>{expense.expenseDate || 'No date'} · {expense.category}</span></div><strong>{money(expense.amount)}</strong></div>)}
            </div>
            {expenseCandidates.length ? <details className="event-integrations__candidates"><summary>Link an existing expense</summary>{expenseCandidates.map(expense => <div className="event-integrations__record-row" key={expense.id}><div><strong>{expense.title}</strong><span>{expense.expenseDate || 'No date'} · {expense.category} · {money(expense.amount)}</span></div><button type="button" className="button button--ghost" disabled={saving} onClick={() => void linkExpense(expense.id)}>Link</button></div>)}</details> : null}
          </section>
        </>
      ) : null}

      {tab === 'documents' ? (
        <section className="workspace-card event-integrations__panel">
          <header className="event-integrations__panel-heading"><div><p className="event-workspace__eyebrow">Documents</p><h2>Invoices & receipts for this event</h2><p>Sedifex documents remain in the standard Invoices and Receipts modules. Link existing client documents here when needed.</p></div><div className="event-integrations__module-actions"><Link className="button button--primary" to={`/invoices?${eventQuery}`}>Create invoice</Link><Link className="button button--ghost" to={`/receipts?${eventQuery}`}>Create receipt</Link></div></header>
          <div className="event-integrations__document-grid">
            <div className="event-integrations__records"><h3>Linked invoices · {linkedInvoices.length}</h3>{linkedInvoices.length === 0 ? <p>No invoices linked yet.</p> : linkedInvoices.map(invoice => <div className="event-integrations__record-row" key={invoice.id}><div><strong>{invoice.number}</strong><span>{invoice.date || 'No date'} · {invoice.status}</span></div><strong>{money(invoice.total)}</strong></div>)}</div>
            <div className="event-integrations__records"><h3>Linked receipts · {linkedReceipts.length}</h3>{linkedReceipts.length === 0 ? <p>No receipts linked yet.</p> : linkedReceipts.map(receipt => <div className="event-integrations__record-row" key={receipt.id}><div><strong>{receipt.number}</strong><span>{receipt.date || 'No date'} · {receipt.paymentMethod}</span></div><strong>{money(receipt.amountPaid)}</strong></div>)}</div>
          </div>
          {invoiceCandidates.length || receiptCandidates.length ? <div className="event-integrations__candidate-grid">
            {invoiceCandidates.length ? <details className="event-integrations__candidates" open><summary>Unlinked invoices matching this client</summary>{invoiceCandidates.map(invoice => <div className="event-integrations__record-row" key={invoice.id}><div><strong>{invoice.number}</strong><span>{invoice.customerName} · {money(invoice.total)}</span></div><button type="button" className="button button--ghost" disabled={saving} onClick={() => void linkInvoice(invoice.id)}>Link</button></div>)}</details> : null}
            {receiptCandidates.length ? <details className="event-integrations__candidates" open><summary>Unlinked receipts matching this client</summary>{receiptCandidates.map(receipt => <div className="event-integrations__record-row" key={receipt.id}><div><strong>{receipt.number}</strong><span>{receipt.customerName} · {money(receipt.amountPaid)}</span></div><button type="button" className="button button--ghost" disabled={saving} onClick={() => void linkReceipt(receipt.id)}>Link</button></div>)}</details> : null}
          </div> : null}
        </section>
      ) : null}

      {tab === 'messages' ? (
        <section className="workspace-card event-integrations__panel">
          <header className="event-integrations__panel-heading"><div><p className="event-workspace__eyebrow">Messages</p><h2>Use Sedifex communication tools</h2><p>Open the existing SMS/WhatsApp and Bulk Email tools instead of maintaining a second messaging system inside Event Planning.</p></div><button type="button" className="button button--ghost" onClick={() => void copyEventContext()}>Copy event details</button></header>
          <div className="event-integrations__contact-card"><span>Client</span><strong>{event.clientName}</strong><p>{event.clientPhone || 'No phone'}{event.clientEmail ? ` · ${event.clientEmail}` : ''}</p></div>
          <div className="event-integrations__module-grid">
            <Link to={`/bulk-messaging?${eventQuery}`}><strong>SMS / messaging</strong><span>Open Bulk Messaging with this event context.</span></Link>
            <Link to={`/bulk-email?${eventQuery}`}><strong>Bulk Email</strong><span>Send client, vendor or event notices from the existing email module.</span></Link>
            <Link to="/quick-pay"><strong>Quick Pay</strong><span>Open the store payment link for client payments.</span></Link>
            <a href={quickPayUrl} target="_blank" rel="noreferrer"><strong>Customer payment page</strong><span>Open the public Sedifex Quick Pay page in a new tab.</span></a>
          </div>
        </section>
      ) : null}
    </div>
  )
}
