import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, type DocumentData, type DocumentReference } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useToast } from '../components/ToastProvider'
import { playSound } from '../utils/sound'
import { deriveLastEventType, deriveOnlineOrderStatusFromBooking, deriveReportPaymentFields, normalizePaymentStatus as normalizeCanonicalPaymentStatus } from '../lib/bookingStatus'
import './BookingEditor.css'

type BookingFormState = {
  fullName: string
  phone: string
  email: string
  serviceName: string
  serviceId: string
  bookingDate: string
  bookingTime: string
  preferredBranch: string
  preferredContactMethod: string
  status: string
  quantity: string
  notes: string
  paymentAmount: string
  depositAmount: string
  paymentMethod: string
  paymentReference: string
  paymentStatus: string
}

type CustomerPortalRequestState = {
  bookingId: string
  id: string
  type: 'reschedule' | 'cancel'
  status: 'pending' | 'approved' | 'rejected'
  requestedDate: string
  requestedTime: string
  note: string
  previousDate: string
  previousTime: string
  submittedAt: string | null
  reviewedAt: string | null
  reviewedBy: string
  decisionNote: string
}

type PortalRequestDecisionResponse = {
  ok: boolean
  request: CustomerPortalRequestState
  bookingDate: string
  bookingTime: string
  bookingStatus: string
}

const DEFAULT_FORM: BookingFormState = {
  fullName: '',
  phone: '',
  email: '',
  serviceName: '',
  serviceId: '',
  bookingDate: '',
  bookingTime: '',
  preferredBranch: '',
  preferredContactMethod: '',
  status: 'confirmed',
  quantity: '1',
  notes: '',
  paymentAmount: '',
  depositAmount: '',
  paymentMethod: '',
  paymentReference: '',
  paymentStatus: 'pending',
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object' && typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate().toISOString()
  }
  return ''
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function firstStringValue(...values: unknown[]): string {
  for (const value of values) {
    const str = stringValue(value).trim()
    if (str) return str
  }
  return ''
}

function normalizeCustomerPortalRequest(value: unknown, bookingId: string): CustomerPortalRequestState | null {
  const request = recordValue(value)
  const id = firstStringValue(request.id)
  if (!id) return null
  const rawType = firstStringValue(request.type).toLowerCase()
  const rawStatus = firstStringValue(request.status).toLowerCase()
  return {
    bookingId,
    id,
    type: rawType === 'cancel' ? 'cancel' : 'reschedule',
    status: rawStatus === 'approved' ? 'approved' : rawStatus === 'rejected' ? 'rejected' : 'pending',
    requestedDate: firstStringValue(request.requestedDate),
    requestedTime: firstStringValue(request.requestedTime),
    note: firstStringValue(request.note),
    previousDate: firstStringValue(request.previousDate),
    previousTime: firstStringValue(request.previousTime),
    submittedAt: stringValue(request.submittedAt) || null,
    reviewedAt: stringValue(request.reviewedAt) || null,
    reviewedBy: firstStringValue(request.reviewedBy),
    decisionNote: firstStringValue(request.decisionNote),
  }
}

function normalizePaymentStatusValue(value: unknown, fallback = 'pending'): string {
  const safeFallback = ['pending', 'partial', 'paid', 'awaiting_verification'].includes(fallback) ? fallback : 'pending'
  return normalizeCanonicalPaymentStatus(value, safeFallback as 'pending' | 'partial' | 'paid' | 'awaiting_verification')
}

function normalizePaymentStatus(data: Record<string, unknown>, payment: Record<string, unknown>): string {
  const explicitStatus = firstStringValue(data.paymentStatus, data.payment_status, payment.paymentStatus, payment.payment_status, payment.status)
  if (explicitStatus) return normalizePaymentStatusValue(explicitStatus, 'pending')
  if (payment.confirmed === true) return 'paid'
  return 'pending'
}

function normalizeBookingStatusValue(value: unknown, fallback = 'pending'): string {
  const raw = stringValue(value).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!raw) return fallback
  if (['pending_approval', 'pending'].includes(raw)) return 'pending'
  if (['confirmed', 'completed', 'cancelled'].includes(raw)) return raw
  return raw
}

function normalizeBookingForm(data: Record<string, unknown>): BookingFormState {
  const customer = recordValue(data.customer)
  const booking = recordValue(data.booking)
  const payment = recordValue(data.payment)
  const status = normalizeBookingStatusValue(firstStringValue(data.bookingStatus, data.booking_status, data.status), 'confirmed')

  return {
    fullName: firstStringValue(data.fullName, data.name, data.customerName, customer.name),
    phone: firstStringValue(data.phone, data.customerPhone, customer.phone),
    email: firstStringValue(data.email, data.customerEmail, customer.email),
    serviceName: firstStringValue(data.serviceName, data.internalServiceName, booking.serviceName, data.itemName, data.productName),
    serviceId: firstStringValue(data.serviceId, booking.serviceId),
    bookingDate: normalizeDateInput(firstStringValue(data.bookingDate, data.date, booking.preferredDate, booking.date, booking.startAt)),
    bookingTime: normalizeTimeInput(firstStringValue(data.bookingTime, data.time, booking.preferredTime, booking.time, booking.startAt)),
    preferredBranch: firstStringValue(data.preferredBranch, data.branchName, data.branch, data.location),
    preferredContactMethod: firstStringValue(data.preferredContactMethod, data.contactMethod),
    status,
    quantity: String(typeof data.quantity === 'number' && Number.isFinite(data.quantity) ? data.quantity : 1),
    notes: firstStringValue(data.notes),
    paymentAmount: firstStringValue(data.paymentAmount, data.amount, data.total, data.price, payment.amount),
    depositAmount: firstStringValue(data.depositAmount, data.depositPaid, data.amountPaid, payment.depositAmount, payment.amountPaid),
    paymentMethod: firstStringValue(data.paymentMethod, payment.method),
    paymentReference: firstStringValue(data.paymentReference, data.reference, payment.reference),
    paymentStatus: normalizePaymentStatus(data, payment),
  }
}

function normalizeDateInput(value: unknown): string {
  const raw = stringValue(value).trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function normalizeTimeInput(value: unknown): string {
  const raw = stringValue(value).trim()
  if (!raw) return ''
  const compact = raw.replace(/\s+/g, '').toLowerCase()
  const ampm = compact.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/)
  if (ampm) {
    const hour12 = Number.parseInt(ampm[1], 10)
    const minute = Number.parseInt(ampm[2] ?? '0', 10)
    if (hour12 >= 1 && hour12 <= 12 && minute >= 0 && minute <= 59) {
      const hour24 = hour12 % 12 + (ampm[3] === 'pm' ? 12 : 0)
      return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    }
  }
  const hhmm = compact.match(/^(\d{1,2}):(\d{2})$/)
  if (hhmm) {
    const hour = Number.parseInt(hhmm[1], 10)
    const minute = Number.parseInt(hhmm[2], 10)
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    }
  }
  return ''
}

const bookingAppsScriptUrl = 'https://script.google.com/macros/s/AKfycbxl0IdT746Z_yL2LJbAOKi0wsn3iNct4H1omFYWaxq8nzzI7rc_cebfxXcMxMydtvO4Eg/exec'

type BookingSheetPayload = Record<string, string>

type BookingSheetSource = {
  id?: string
  bookingId?: string
  name?: string
  customerName?: string
  email?: string
  customerEmail?: string
  phone?: string
  customerPhone?: string
  service?: string
  serviceName?: string
  date?: string
  bookingDate?: string
  time?: string
  bookingTime?: string
}

async function syncBookingToSheet(payload: BookingSheetPayload) {
  const url = bookingAppsScriptUrl

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(payload),
  })

  return res.text()
}

function syncReasonForStatus(status: string, paymentStatus: string) {
  return deriveLastEventType(status, paymentStatus)
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function suggestPaymentStatus(paymentAmount: unknown, depositAmount: unknown): string | null {
  const total = numberValue(paymentAmount, 0)
  const received = numberValue(depositAmount, 0)
  if (total <= 0) return null
  if (received >= total) return 'paid'
  if (received > 0) return 'partial'
  return 'pending'
}

function paymentStatusLabel(status: string): string {
  if (status === 'paid') return 'Paid'
  if (status === 'partial') return 'Partially paid'
  if (status === 'awaiting_verification') return 'Awaiting verification'
  return 'Payment pending'
}

function bookingStatusLabel(status: string): string {
  if (status === 'confirmed') return 'Confirmed'
  if (status === 'rescheduled') return 'Rescheduled'
  if (status === 'completed') return 'Completed'
  if (status === 'cancelled') return 'Cancelled'
  return 'Pending approval'
}

function formatMoneyValue(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export default function BookingEditor() {
  const { storeId } = useActiveStore()
  const { bookingId = 'new' } = useParams()
  const navigate = useNavigate()
  const isCreateMode = bookingId === 'new'
  const [form, setForm] = useState<BookingFormState>(DEFAULT_FORM)
  const [loading, setLoading] = useState(!isCreateMode)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [existingPaymentConfirmedAt, setExistingPaymentConfirmedAt] = useState<unknown>(null)
  const [paymentStatusReviewed, setPaymentStatusReviewed] = useState(false)
  const [portalRequest, setPortalRequest] = useState<CustomerPortalRequestState | null>(null)
  const [portalDecisionNote, setPortalDecisionNote] = useState('')
  const [reviewingPortalRequest, setReviewingPortalRequest] = useState(false)
  const { publish } = useToast()

  useEffect(() => {
    if (!storeId || isCreateMode) {
      setExistingPaymentConfirmedAt(null)
      setPaymentStatusReviewed(false)
      setPortalRequest(null)
      setPortalDecisionNote('')
      setLoading(false)
      return
    }

    let cancelled = false
    async function loadBooking() {
      setLoading(true)
      setErrorMessage(null)
      try {
        const storeBookingRef = doc(db, 'stores', storeId, 'integrationBookings', bookingId)
        const storeSnap = await getDoc(storeBookingRef)
        let data: Record<string, unknown> | null = null

        if (storeSnap.exists()) {
          data = storeSnap.data() as Record<string, unknown>
        } else {
          const rootBookingRef = doc(db, 'integrationBookings', bookingId)
          const rootSnap = await getDoc(rootBookingRef)
          if (rootSnap.exists()) {
            data = rootSnap.data() as Record<string, unknown>
            await setDoc(storeBookingRef, { ...data, storeId }, { merge: true })
          }
        }

        if (!data) {
          if (!cancelled) {
            setErrorMessage('Booking not found.')
          }
          return
        }

        if (cancelled) return
        setForm(normalizeBookingForm(data))
        setExistingPaymentConfirmedAt(data.paymentConfirmedAt ?? data.payment_confirmed_at ?? null)
        setPaymentStatusReviewed(false)
        setPortalRequest(normalizeCustomerPortalRequest(data.customerPortalRequest, bookingId))
        setPortalDecisionNote('')
      } catch (error) {
        console.error('[booking-editor] Failed to load booking', error)
        if (!cancelled) {
          setErrorMessage('Unable to load this booking. Please retry.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadBooking()
    return () => {
      cancelled = true
    }
  }, [bookingId, isCreateMode, storeId])

  const quantityValue = useMemo(() => {
    const parsed = Number.parseInt(form.quantity, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
  }, [form.quantity])

  const normalizedFormStatus = normalizeBookingStatusValue(form.status, 'pending')
  const normalizedFormPaymentStatus = normalizePaymentStatusValue(form.paymentStatus, 'pending')
  const paymentReviewRequired = ['confirmed', 'completed'].includes(normalizedFormStatus)
  const pendingPaymentConflict = paymentReviewRequired && normalizedFormPaymentStatus === 'pending'
  const suggestedPaymentStatus = useMemo(
    () => suggestPaymentStatus(form.paymentAmount, form.depositAmount),
    [form.depositAmount, form.paymentAmount],
  )
  const paymentAmountValue = Math.max(numberValue(form.paymentAmount, 0), 0)
  const depositAmountValue = Math.max(numberValue(form.depositAmount, 0), 0)
  const summaryAmountReceived = normalizedFormPaymentStatus === 'paid'
    ? paymentAmountValue
    : Math.min(depositAmountValue, paymentAmountValue || depositAmountValue)
  const summaryBalance = Math.max(paymentAmountValue - summaryAmountReceived, 0)
  const suggestionDiffers = suggestedPaymentStatus !== null && suggestedPaymentStatus !== normalizedFormPaymentStatus

  function updatePaymentAmount(nextPaymentAmount: string) {
    setForm(prev => {
      const suggestion = suggestPaymentStatus(nextPaymentAmount, prev.depositAmount)
      return {
        ...prev,
        paymentAmount: nextPaymentAmount,
        ...(!paymentStatusReviewed && suggestion ? { paymentStatus: suggestion } : {}),
      }
    })
  }

  function updateDepositAmount(nextDepositAmount: string) {
    setForm(prev => {
      const suggestion = suggestPaymentStatus(prev.paymentAmount, nextDepositAmount)
      return {
        ...prev,
        depositAmount: nextDepositAmount,
        ...(!paymentStatusReviewed && suggestion ? { paymentStatus: suggestion } : {}),
      }
    })
  }

  async function handleSave() {
    if (!storeId) {
      setErrorMessage('Select a workspace before editing bookings.')
      return
    }
    if (!form.fullName.trim()) {
      setErrorMessage('Customer name is required.')
      return
    }

    const normalizedStatus = normalizeBookingStatusValue(form.status, 'pending')
    const normalizedPaymentStatus = normalizePaymentStatusValue(form.paymentStatus, 'pending')
    const requiresPaymentReview = ['confirmed', 'completed'].includes(normalizedStatus)

    if (requiresPaymentReview && normalizedPaymentStatus === 'pending') {
      const statusLabel = normalizedStatus === 'completed' ? 'Completed' : 'Confirmed'
      const continueWithPendingPayment = window.confirm(
        `${statusLabel} appointment with Payment pending. Are you sure you want to save it this way?`,
      )
      if (!continueWithPendingPayment) return
    }

    setSaving(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    const targetId = isCreateMode ? doc(db, 'stores', storeId, 'integrationBookings').id : bookingId

    try {
      const paymentAmount = numberValue(form.paymentAmount, 0)
      const rawDepositAmount = numberValue(form.depositAmount, 0)
      const isPaid = normalizedPaymentStatus === 'paid'
      const isPartial = normalizedPaymentStatus === 'partial'
      const isConfirmedPaid = normalizedStatus === 'confirmed' && isPaid
      const isConfirmedPartial = normalizedStatus === 'confirmed' && isPartial
      const depositAmount = isPaid ? paymentAmount : rawDepositAmount
      const amountReceived = isPaid ? paymentAmount : isPartial ? rawDepositAmount : rawDepositAmount
      const amountOutstanding = Math.max(paymentAmount - amountReceived, 0)
      const orderStatus = deriveOnlineOrderStatusFromBooking(normalizedStatus)
      const now = Timestamp.now()
      const paymentConfirmedAt = existingPaymentConfirmedAt || now
      const lastEventType = syncReasonForStatus(normalizedStatus, normalizedPaymentStatus)
      const statusTimestamps = {
        ...(normalizedStatus === 'confirmed' ? { confirmedAt: now, confirmedBy: 'staff_admin' } : {}),
        ...(normalizedStatus === 'completed' ? { completedAt: now } : {}),
        ...(normalizedStatus === 'cancelled' ? { cancelledAt: now } : {}),
        ...(isPaid ? {
          paymentConfirmedAt,
          payment_confirmed_at: paymentConfirmedAt,
          paymentVerifiedAt: now,
          paymentVerifiedBy: 'staff_admin',
        } : {}),
      }
      const normalizedFormPayload = {
        name: form.fullName.trim(),
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        serviceName: form.serviceName.trim(),
        serviceId: form.serviceId.trim(),
        date: normalizeDateInput(form.bookingDate),
        bookingDate: normalizeDateInput(form.bookingDate),
        time: normalizeTimeInput(form.bookingTime),
        bookingTime: normalizeTimeInput(form.bookingTime),
        preferredBranch: form.preferredBranch.trim(),
        preferredContactMethod: form.preferredContactMethod.trim(),
        quantity: quantityValue,
        notes: form.notes.trim(),
        paymentAmount: form.paymentAmount.trim(),
        depositAmount: String(depositAmount || ''),
        deposit_amount: depositAmount,
        amountReceived,
        amount_received: amountReceived,
        amountOutstanding,
        amount_outstanding: amountOutstanding,
        paymentMethod: form.paymentMethod.trim(),
        paymentReference: form.paymentReference.trim(),
        reference: form.paymentReference.trim(),
      }
      const payload = {
        ...normalizedFormPayload,
        bookingStatus: normalizedStatus,
        booking_status: normalizedStatus,
        status: normalizedStatus,
        paymentStatus: normalizedPaymentStatus,
        payment_status: normalizedPaymentStatus,
        orderStatus,
        order_status: orderStatus,
        lastEventType,
        last_event_type: lastEventType,
        payment: {
          amount: form.paymentAmount.trim(),
          depositAmount: String(depositAmount || ''),
          deposit_amount: depositAmount,
          amountReceived,
          amount_received: amountReceived,
          amountOutstanding,
          amount_outstanding: amountOutstanding,
          method: form.paymentMethod.trim(),
          reference: form.paymentReference.trim(),
          status: normalizedPaymentStatus,
          paymentStatus: normalizedPaymentStatus,
          payment_status: normalizedPaymentStatus,
          confirmed: isPaid,
        },
        booking: {
          serviceId: form.serviceId.trim(),
          serviceName: form.serviceName.trim(),
          preferredDate: normalizeDateInput(form.bookingDate),
          preferredTime: normalizeTimeInput(form.bookingTime),
          status: normalizedStatus,
          bookingStatus: normalizedStatus,
          booking_status: normalizedStatus,
        },
        customer: {
          name: form.fullName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
        },
        bookingId: targetId,
        booking_id: targetId,
        syncStatus: 'pending',
        syncReason: lastEventType,
        syncRequestedAt: now,
        syncConfigDetected: true,
        ...statusTimestamps,
        updatedAt: serverTimestamp(),
        ...(isCreateMode ? {
          createdAt: serverTimestamp(),
          source: 'manual_admin',
          sourceChannel: 'manual_admin',
          source_channel: 'manual_admin',
        } : {}),
      }
      const booking = payload as BookingSheetSource & Record<string, unknown>

      await withTimeout(
        Promise.all([
          setDoc(doc(db, 'stores', storeId, 'integrationBookings', targetId), payload, { merge: true }),
          setDoc(doc(db, 'integrationBookings', targetId), payload, { merge: true }),
        ]),
        15000,
        'Saving booking timed out. Please try again.',
      )

      const reportFields = deriveReportPaymentFields(payload)
      const orderPatch = {
        bookingId: targetId,
        booking_id: targetId,
        bookingStatus: normalizedStatus,
        booking_status: normalizedStatus,
        paymentStatus: normalizedPaymentStatus,
        payment_status: normalizedPaymentStatus,
        orderStatus,
        order_status: orderStatus,
        lastEventType,
        last_event_type: lastEventType,
        amountReceived: reportFields.amountReceived,
        amount_received: reportFields.amountReceived,
        amountOutstanding: reportFields.amountOutstanding,
        amount_outstanding: reportFields.amountOutstanding,
        depositAmount: reportFields.depositAmount,
        deposit_amount: reportFields.depositAmount,
        updatedAt: serverTimestamp(),
      }
      const paymentReference = form.paymentReference.trim()
      const orderQueries = [
        query(collection(db, 'integrationOrders'), where('booking_id', '==', targetId)),
        query(collection(db, 'integrationOrders'), where('bookingId', '==', targetId)),
        query(collection(db, 'stores', storeId, 'integrationOrders'), where('booking_id', '==', targetId)),
        query(collection(db, 'stores', storeId, 'integrationOrders'), where('bookingId', '==', targetId)),
        ...(paymentReference ? [
          query(collection(db, 'integrationOrders'), where('payment_reference', '==', paymentReference)),
          query(collection(db, 'integrationOrders'), where('paymentReference', '==', paymentReference)),
          query(collection(db, 'stores', storeId, 'integrationOrders'), where('payment_reference', '==', paymentReference)),
          query(collection(db, 'stores', storeId, 'integrationOrders'), where('paymentReference', '==', paymentReference)),
        ] : []),
      ]
      const [orderSnapshots, rootIdSnap, storeIdSnap] = await Promise.all([
        Promise.all(orderQueries.map(orderQuery => getDocs(orderQuery))),
        getDoc(doc(db, 'integrationOrders', targetId)),
        getDoc(doc(db, 'stores', storeId, 'integrationOrders', targetId)),
      ])
      const orderRefs = new Map<string, DocumentReference<DocumentData>>()
      orderSnapshots.forEach(snapshot => {
        snapshot.docs.forEach(orderDoc => orderRefs.set(orderDoc.ref.path, orderDoc.ref))
      })
      if (rootIdSnap.exists()) orderRefs.set(rootIdSnap.ref.path, rootIdSnap.ref)
      if (storeIdSnap.exists()) orderRefs.set(storeIdSnap.ref.path, storeIdSnap.ref)
      await Promise.all(Array.from(orderRefs.values()).map(orderRef => setDoc(orderRef, orderPatch, { merge: true })))

      await syncBookingToSheet({
        type: 'booking',
        bookingId: String(booking.id || booking.bookingId || targetId || `BOOK-${Date.now()}`),
        booking_id: String(booking.booking_id || booking.bookingId || targetId),
        customerName: String(booking.customerName || booking.name || ''),
        customerEmail: String(booking.customerEmail || booking.email || ''),
        customerPhone: String(booking.customerPhone || booking.phone || ''),
        serviceName: String(booking.serviceName || booking.service || ''),
        bookingDate: String(booking.bookingDate || booking.date || ''),
        bookingTime: String(booking.bookingTime || booking.time || ''),
        status: normalizedStatus,
        booking_status: normalizedStatus,
        bookingStatus: normalizedStatus,
        payment_status: normalizedPaymentStatus,
        paymentStatus: normalizedPaymentStatus,
        payment_confirmed_at: isPaid ? stringValue(paymentConfirmedAt) : '',
        last_event_type: lastEventType,
        lastEventType,
        source: isConfirmedPaid ? 'sedifex-booking-confirmed-paid' : isConfirmedPartial ? 'sedifex-booking-partial-payment' : 'sedifex-booking-update',
      })

      const saveMessage = isCreateMode
        ? 'Booking created successfully. Email will be sent to the customer.'
        : 'Booking changes saved successfully. Email will be sent to the customer.'
      setSuccessMessage(saveMessage)
      publish({ tone: 'success', message: saveMessage })
      void playSound('success')
      navigate('/bookings')
    } catch (error) {
      console.error('[booking-editor] Failed to save booking', error)
      const failureMessage = 'Unable to save booking right now.'
      setErrorMessage(failureMessage)
      publish({ tone: 'error', message: failureMessage })
      void playSound('error')
    } finally {
      setSaving(false)
    }
  }

  async function handlePortalRequestDecision(decision: 'approve' | 'reject') {
    if (!storeId || isCreateMode || !portalRequest || portalRequest.status !== 'pending') return
    setReviewingPortalRequest(true)
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const reviewRequest = httpsCallable<{
        storeId: string
        bookingId: string
        decision: 'approve' | 'reject'
        note: string
      }, PortalRequestDecisionResponse>(functions, 'reviewCustomerPortalBookingRequest')
      const response = await reviewRequest({ storeId, bookingId, decision, note: portalDecisionNote })
      setPortalRequest(response.data.request)
      if (decision === 'approve' && response.data.request.type === 'reschedule') {
        setForm(previous => ({
          ...previous,
          bookingDate: response.data.bookingDate || previous.bookingDate,
          bookingTime: response.data.bookingTime || previous.bookingTime,
        }))
      }
      if (decision === 'approve' && response.data.request.type === 'cancel') {
        setForm(previous => ({ ...previous, status: 'cancelled' }))
      }
      const message = decision === 'approve'
        ? 'Customer request approved. Sedifex updated the booking and will handle the customer notification.'
        : 'Customer request rejected. Sedifex has recorded the decision and notified the customer when email is available.'
      setSuccessMessage(message)
      publish({ tone: 'success', message })
      void playSound('success')
    } catch (error) {
      console.error('[booking-editor] Failed to review customer portal request', error)
      const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '').replace(/^FirebaseError:\s*/i, '')
        : 'Unable to review this customer request right now.'
      setErrorMessage(message || 'Unable to review this customer request right now.')
      publish({ tone: 'error', message: message || 'Unable to review this customer request right now.' })
      void playSound('error')
    } finally {
      setReviewingPortalRequest(false)
    }
  }

  async function handleDeleteBooking() {
    if (!storeId || isCreateMode) {
      setErrorMessage('Select an existing booking before deleting.')
      return
    }

    const confirmed = window.confirm('Delete this booking? This will remove it from Sedifex bookings.')
    if (!confirmed) return

    setDeleting(true)
    setErrorMessage(null)
    setSuccessMessage(null)

    try {
      await withTimeout(
        Promise.all([
          deleteDoc(doc(db, 'stores', storeId, 'integrationBookings', bookingId)),
          deleteDoc(doc(db, 'integrationBookings', bookingId)),
        ]),
        15000,
        'Deleting booking timed out. Please try again.',
      )

      const deleteMessage = 'Booking deleted successfully.'
      setSuccessMessage(deleteMessage)
      publish({ tone: 'success', message: deleteMessage })
      void playSound('success')
      navigate('/bookings')
    } catch (error) {
      console.error('[booking-editor] Failed to delete booking', error)
      const failureMessage = 'Unable to delete booking right now.'
      setErrorMessage(failureMessage)
      publish({ tone: 'error', message: failureMessage })
      void playSound('error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <main className="page booking-editor-page">
      <section className="card booking-editor-page__card stack gap-3">
        <header className="stack gap-1">
          <p className="form__hint">
            <Link to="/bookings">← Back to bookings</Link>
          </p>
          <h1>{isCreateMode ? 'Add booking' : 'Edit booking'}</h1>
          <p className="form__hint">
            Update the appointment and payment statuses in this form, then click <strong>Save changes</strong>. Sedifex will save the update and send the customer email when notifications are enabled.
          </p>
        </header>

        {loading && <p className="form__hint">Loading booking…</p>}
        {errorMessage && <p className="form__error">{errorMessage}</p>}
        {successMessage && <p className="form__success">{successMessage}</p>}

        {!loading && (
          <form
            className="booking-editor-page__form"
            onSubmit={event => {
              event.preventDefault()
              void handleSave()
            }}
          >
            {portalRequest ? (
              <section className={`booking-editor-page__portal-request booking-editor-page__portal-request--${portalRequest.status}`}>
                <div className="booking-editor-page__portal-request-heading">
                  <div>
                    <small>Customer portal request</small>
                    <strong>{portalRequest.type === 'cancel' ? 'Cancellation requested' : 'Reschedule requested'}</strong>
                  </div>
                  <span className={`booking-editor-page__status-badge booking-editor-page__status-badge--${portalRequest.status === 'pending' ? 'pending' : portalRequest.status === 'approved' ? 'confirmed' : 'cancelled'}`}>
                    {portalRequest.status === 'pending' ? 'Needs review' : portalRequest.status === 'approved' ? 'Approved' : 'Rejected'}
                  </span>
                </div>
                <div className="booking-editor-page__portal-request-details">
                  {portalRequest.type === 'reschedule' ? <span><strong>Requested:</strong> {portalRequest.requestedDate || '—'}{portalRequest.requestedTime ? ` · ${portalRequest.requestedTime}` : ''}</span> : <span><strong>Request:</strong> Cancel this booking</span>}
                  {portalRequest.previousDate ? <span><strong>Current:</strong> {portalRequest.previousDate}{portalRequest.previousTime ? ` · ${portalRequest.previousTime}` : ''}</span> : null}
                  {portalRequest.note ? <span><strong>Customer note:</strong> {portalRequest.note}</span> : null}
                  {portalRequest.decisionNote ? <span><strong>Business note:</strong> {portalRequest.decisionNote}</span> : null}
                </div>
                {portalRequest.status === 'pending' ? (
                  <div className="booking-editor-page__portal-request-review">
                    <label className="booking-editor-page__portal-request-note"><span>Reply / decision note (optional)</span><textarea rows={3} maxLength={1200} value={portalDecisionNote} onChange={event => setPortalDecisionNote(event.target.value)} placeholder="Add a short reason or alternative for the customer" /></label>
                    <div className="booking-editor-page__portal-request-actions">
                      <button type="button" className="button" disabled={reviewingPortalRequest} onClick={() => void handlePortalRequestDecision('reject')}>Reject request</button>
                      <button type="button" className="button button--primary" disabled={reviewingPortalRequest} onClick={() => void handlePortalRequestDecision('approve')}>{reviewingPortalRequest ? 'Saving decision…' : 'Approve request'}</button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <label><span>Customer name</span><input value={form.fullName} onChange={event => setForm(prev => ({ ...prev, fullName: event.target.value }))} required /></label>
            <label><span>Phone</span><input value={form.phone} onChange={event => setForm(prev => ({ ...prev, phone: event.target.value }))} /></label>
            <label><span>Email</span><input type="email" value={form.email} onChange={event => setForm(prev => ({ ...prev, email: event.target.value }))} /></label>
            <label><span>Service name</span><input value={form.serviceName} onChange={event => setForm(prev => ({ ...prev, serviceName: event.target.value }))} /></label>
            <label><span>Service ID</span><input value={form.serviceId} onChange={event => setForm(prev => ({ ...prev, serviceId: event.target.value }))} /></label>
            <label><span>Booking date</span><input type="date" value={form.bookingDate} onChange={event => setForm(prev => ({ ...prev, bookingDate: event.target.value }))} /></label>
            <label><span>Booking time</span><input type="time" value={form.bookingTime} onChange={event => setForm(prev => ({ ...prev, bookingTime: event.target.value }))} /></label>
            <label><span>Preferred branch</span><input value={form.preferredBranch} onChange={event => setForm(prev => ({ ...prev, preferredBranch: event.target.value }))} /></label>
            <label><span>Preferred contact method</span><input value={form.preferredContactMethod} onChange={event => setForm(prev => ({ ...prev, preferredContactMethod: event.target.value }))} /></label>

            <fieldset className="booking-editor-page__status-group">
              <legend>Booking status</legend>
              <p className="booking-editor-page__status-intro">Review both statuses before saving this booking.</p>
              <div className="booking-editor-page__status-grid">
                <label>
                  <span>Appointment status</span>
                  <select
                    className={`booking-editor-page__status-select booking-editor-page__status-select--${normalizedFormStatus}`}
                    size={5}
                    value={form.status}
                    onChange={event => setForm(prev => ({ ...prev, status: event.target.value }))}
                  >
                    <option value="pending">Pending approval</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="rescheduled">Rescheduled</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <label>
                  <span>Payment status</span>
                  <select
                    className={`booking-editor-page__status-select booking-editor-page__status-select--${normalizedFormPaymentStatus}`}
                    size={4}
                    value={form.paymentStatus}
                    onClick={() => setPaymentStatusReviewed(true)}
                    onChange={event => {
                      setForm(prev => ({ ...prev, paymentStatus: event.target.value }))
                      setPaymentStatusReviewed(true)
                    }}
                  >
                    <option value="pending">Payment pending</option>
                    <option value="paid">Paid</option>
                    <option value="partial">Partially paid</option>
                    <option value="awaiting_verification">Awaiting verification</option>
                  </select>
                </label>
              </div>
              {suggestedPaymentStatus && (
                <div className="booking-editor-page__payment-suggestion">
                  <span>
                    Amounts suggest <strong>{paymentStatusLabel(suggestedPaymentStatus)}</strong>
                    {suggestionDiffers ? `, but ${paymentStatusLabel(normalizedFormPaymentStatus)} is selected.` : '.'}
                  </span>
                  {suggestionDiffers && (
                    <button
                      type="button"
                      className="button button--outline booking-editor-page__suggestion-button"
                      onClick={() => {
                        setForm(prev => ({ ...prev, paymentStatus: suggestedPaymentStatus }))
                        setPaymentStatusReviewed(true)
                      }}
                    >
                      Use suggestion
                    </button>
                  )}
                </div>
              )}
              {pendingPaymentConflict && (
                <p className="booking-editor-page__status-warning">Payment is still pending. Sedifex will ask for confirmation before saving this appointment.</p>
              )}
            </fieldset>

            <label><span>Quantity</span><input type="number" min={1} value={form.quantity} onChange={event => setForm(prev => ({ ...prev, quantity: event.target.value }))} /></label>
            <label><span>Payment amount</span><input inputMode="decimal" value={form.paymentAmount} onChange={event => updatePaymentAmount(event.target.value)} /></label>
            <label><span>Deposit amount</span><input inputMode="decimal" value={form.depositAmount} onChange={event => updateDepositAmount(event.target.value)} /></label>
            <label><span>Payment method</span><input value={form.paymentMethod} onChange={event => setForm(prev => ({ ...prev, paymentMethod: event.target.value }))} /></label>
            <label><span>Payment reference</span><input value={form.paymentReference} onChange={event => setForm(prev => ({ ...prev, paymentReference: event.target.value }))} /></label>
            <label className="booking-editor-page__notes"><span>Notes</span><textarea value={form.notes} onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))} rows={4} /></label>

            <section className="booking-editor-page__save-summary" aria-label="Booking summary before save">
              <div className="booking-editor-page__save-summary-heading">
                <strong>Before you save</strong>
                <span>Check the appointment and payment details.</span>
              </div>
              <div className="booking-editor-page__summary-statuses">
                <span className={`booking-editor-page__status-badge booking-editor-page__status-badge--${normalizedFormStatus}`}>
                  Appointment: {bookingStatusLabel(normalizedFormStatus)}
                </span>
                <span className={`booking-editor-page__status-badge booking-editor-page__status-badge--${normalizedFormPaymentStatus}`}>
                  Payment: {paymentStatusLabel(normalizedFormPaymentStatus)}
                </span>
              </div>
              <div className="booking-editor-page__summary-amounts">
                <span>Total: <strong>{formatMoneyValue(paymentAmountValue)}</strong></span>
                <span>Received: <strong>{formatMoneyValue(summaryAmountReceived)}</strong></span>
                <span>Balance: <strong>{formatMoneyValue(summaryBalance)}</strong></span>
              </div>
            </section>

            <div className="booking-editor-page__actions">
              {!isCreateMode && (
                <button
                  type="button"
                  className="button button--outline booking-editor-page__delete"
                  disabled={saving || deleting}
                  onClick={() => {
                    void handleDeleteBooking()
                  }}
                >
                  {deleting ? 'Deleting…' : 'Delete booking'}
                </button>
              )}
              <Link to="/bookings" className="button button--outline">Back</Link>
              <button type="submit" className="button button--primary" disabled={saving || deleting}>
                {saving ? 'Saving…' : isCreateMode ? 'Create booking' : 'Save changes'}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}
