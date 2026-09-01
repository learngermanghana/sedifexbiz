import React, { useEffect, useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '../firebase'
import { useActiveStore } from '../hooks/useActiveStore'
import { useWorkspaceIdentity } from '../hooks/useWorkspaceIdentity'
import { CUSTOMER_CACHE_LIMIT, loadCachedCustomers, saveCachedCustomers } from '../utils/offlineCache'
import './BulkMessaging.css'

type Customer = {
  id: string
  name?: string
  displayName?: string
  phone?: string
  email?: string
  tags?: string[]
  updatedAt?: unknown
  createdAt?: unknown
}

type AudienceKind =
  | 'customers'
  | 'students'
  | 'donors'
  | 'volunteers'
  | 'website_registrations'
  | 'manual_registrations'

type AudienceContact = {
  id: string
  sourceId: string
  source: AudienceKind
  label: string
  name?: string
  phone?: string
  email?: string
  tags: string[]
  meta?: string
}

type StoreSmsStatus = {
  approved: boolean
  hubtelId: string | null
  businessName: string
  contactEmail: string
  contactPhone: string
}

type SmsApprovalForm = {
  businessName: string
  contactName: string
  contactEmail: string
  contactPhone: string
  certificateUrl: string
  notes: string
}

type BulkMessageChannel = 'sms'

type BulkMessageRecipient = {
  id?: string
  name?: string
  phone?: string
}

type BulkMessagePayload = {
  storeId: string
  channel: BulkMessageChannel
  message: string
  recipients: BulkMessageRecipient[]
}

type BulkMessageResult = {
  ok: boolean
  attempted: number
  sent: number
  failures: { phone: string; error: string }[]
}

type BulkCreditsCheckoutPayload = {
  storeId: string
  package: string
  redirectUrl?: string
}

type BulkCreditsCheckoutResult = {
  ok: boolean
  authorizationUrl?: string | null
  reference?: string | null
}

type StatusTone = 'success' | 'error' | 'info'

type StatusMessage = {
  tone: StatusTone
  message: string
}

type CreditsPackage = {
  id: string
  credits: number
  price: number
  label: string
}
type BulkMessagingTab = 'send' | 'buy'
type MessageTemplate = {
  id: string
  title: string
  content: string
}

type AudienceOption = {
  id: AudienceKind | 'all'
  label: string
  description: string
}

const MESSAGE_LIMIT = 1000
const SMS_SEGMENT_SIZE = 160
const CREDITS_PER_SMS = 12
const SEDIFEX_SMS_APPROVAL_EMAIL = 'sedifexbiz@gmail.com'
const BULK_CREDITS_PACKAGES: CreditsPackage[] = [
  { id: '10000', credits: 10000, price: 50, label: 'Starter' },
  { id: '50000', credits: 50000, price: 230, label: 'Growth' },
  { id: '100000', credits: 100000, price: 430, label: 'Scale' },
]
const SMS_PRICE_ESTIMATE_GHS =
  BULK_CREDITS_PACKAGES[0].price / (BULK_CREDITS_PACKAGES[0].credits / CREDITS_PER_SMS)
const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'promo',
    title: 'Promo offer',
    content:
      'Hi {{name}}, enjoy {{discount}} off selected items at {{store}} this week. Offer ends {{date}}.',
  },
  {
    id: 'arrival',
    title: 'New arrivals',
    content:
      'Hello {{name}}, new stock just arrived at {{store}}. Visit us today or reply for details.',
  },
  {
    id: 'class-reminder',
    title: 'Class reminder',
    content:
      'Hi {{name}}, reminder from {{store}}: your class/session is scheduled for {{date}}. Please arrive on time. Thank you.',
  },
  {
    id: 'payment-reminder',
    title: 'Payment reminder',
    content:
      'Hi {{name}}, this is a friendly reminder from {{store}} about your pending balance of {{amount}}. Thank you.',
  },
  {
    id: 'donor-thanks',
    title: 'Donor thank you',
    content:
      'Dear {{name}}, thank you for supporting {{store}}. Your contribution helps us continue our work.',
  },
  {
    id: 'volunteer-update',
    title: 'Volunteer update',
    content:
      'Hi {{name}}, {{store}} has a volunteer update for you. Please reply or check your email for details.',
  },
]
const AUDIENCE_OPTIONS: AudienceOption[] = [
  { id: 'all', label: 'All contacts', description: 'Everyone with a phone number' },
  { id: 'customers', label: 'Customers', description: 'General CRM customers' },
  { id: 'students', label: 'Students', description: 'Confirmed student records' },
  { id: 'website_registrations', label: 'Website registrations', description: 'Incoming course/application registrations' },
  { id: 'manual_registrations', label: 'Manual registrations', description: 'Students added by staff' },
  { id: 'donors', label: 'Donors', description: 'Donor profiles' },
  { id: 'volunteers', label: 'Volunteers', description: 'Volunteer applicants' },
]
const formatNumber = (value: number) => value.toLocaleString('en-GH')
const formatPrice = (value: number) =>
  value.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function nestedText(data: Record<string, unknown>, key: string) {
  const value = data[key]
  if (typeof value === 'string') return value
  return ''
}

function getCustomerPrimaryName(customer: Pick<Customer, 'displayName' | 'name'>): string {
  const displayName = customer.displayName?.trim()
  if (displayName) return displayName
  const legacyName = customer.name?.trim()
  if (legacyName) return legacyName
  return ''
}

function getCustomerDisplayName(customer: Pick<Customer, 'displayName' | 'name' | 'email' | 'phone'>): string {
  const primary = getCustomerPrimaryName(customer)
  if (primary) return primary
  const email = customer.email?.trim()
  if (email) return email
  const phone = customer.phone?.trim()
  if (phone) return phone
  return 'Unknown customer'
}

function normalizePhone(value?: string) {
  if (!value) return ''
  return value.replace(/[^0-9+]/g, '').replace(/^00/, '+')
}

function formatPhone(value?: string) {
  if (!value) return '—'
  return normalizePhone(value).replace(/^\+/, '+') || '—'
}

function normalizeSearchTerm(value: string) {
  return value.trim().toLowerCase()
}

function safeTags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(tag => tag.trim()).filter(Boolean)
    : []
}

function sourceLabel(source: AudienceKind) {
  return AUDIENCE_OPTIONS.find(option => option.id === source)?.label ?? source
}

function makeRecipientId(source: AudienceKind, id: string) {
  return `${source}:${id}`
}

function toAudienceContact(source: AudienceKind, sourceId: string, input: {
  name?: string
  displayName?: string
  email?: string
  phone?: string
  tags?: string[]
  meta?: string
}): AudienceContact {
  const name = firstText(input.displayName, input.name, input.email, input.phone, 'Unknown contact')
  const baseTags = input.tags ?? []
  const sourceTag = sourceLabel(source)
  return {
    id: makeRecipientId(source, sourceId),
    sourceId,
    source,
    label: sourceTag,
    name,
    email: firstText(input.email),
    phone: normalizePhone(firstText(input.phone)),
    tags: Array.from(new Set([sourceTag, ...baseTags].filter(Boolean))),
    meta: input.meta,
  }
}

function contactFromCustomer(customer: Customer): AudienceContact {
  return toAudienceContact('customers', customer.id, {
    name: customer.name,
    displayName: customer.displayName,
    email: customer.email,
    phone: customer.phone,
    tags: customer.tags,
    meta: customer.email,
  })
}

function contactFromStudent(id: string, data: Record<string, unknown>): AudienceContact {
  return toAudienceContact('students', id, {
    name: firstText(data.displayName, data.name, data.studentName),
    email: firstText(data.email, data.studentEmail),
    phone: firstText(data.phone, data.studentPhone),
    tags: ['Student', firstText(data.course), firstText(data.studentStatus)],
    meta: firstText(data.course, data.studentCode),
  })
}

function contactFromRegistration(id: string, data: Record<string, unknown>): AudienceContact {
  const customer = typeof data.customer === 'object' && data.customer !== null ? data.customer as Record<string, unknown> : {}
  const payload = typeof data.data === 'object' && data.data !== null ? data.data as Record<string, unknown> : {}
  const source = data.source === 'manual_dashboard' ? 'manual_registrations' : 'website_registrations'
  return toAudienceContact(source, id, {
    name: firstText(customer.name, payload.studentName, payload.fullName, payload.name, payload.customerName),
    email: firstText(customer.email, payload.email, payload.studentEmail, payload.customerEmail),
    phone: firstText(customer.phone, payload.phone, payload.studentPhone, payload.customerPhone),
    tags: [source === 'manual_registrations' ? 'Manual registration' : 'Website registration', firstText(payload.course), firstText(data.status)],
    meta: firstText(payload.course, data.status),
  })
}

function contactFromDonor(id: string, data: Record<string, unknown>): AudienceContact {
  return toAudienceContact('donors', id, {
    name: firstText(data.displayName, data.name, data.donorName),
    email: firstText(data.email, data.donorEmail),
    phone: firstText(data.phone, data.donorPhone),
    tags: ['Donor'],
    meta: 'Donor profile',
  })
}

function contactFromVolunteer(id: string, data: Record<string, unknown>): AudienceContact {
  const person = typeof data.person === 'object' && data.person !== null ? data.person as Record<string, unknown> : {}
  const payload = typeof data.data === 'object' && data.data !== null ? data.data as Record<string, unknown> : {}
  return toAudienceContact('volunteers', id, {
    name: firstText(person.name, data.name, payload.name),
    email: firstText(person.email, data.email, payload.email),
    phone: firstText(person.phone, data.phone, payload.phone),
    tags: ['Volunteer', firstText(data.status), firstText(payload.skill), firstText(payload.preferredProject)],
    meta: firstText(payload.skill, payload.preferredProject, data.status),
  })
}

function uniqueByPhoneOrId(contacts: AudienceContact[]) {
  const seen = new Set<string>()
  const unique: AudienceContact[] = []
  contacts.forEach(contact => {
    const phone = normalizePhone(contact.phone)
    const key = phone ? `phone:${phone}` : `id:${contact.id}`
    if (seen.has(key)) return
    seen.add(key)
    unique.push(contact)
  })
  return unique
}

function resolveHubtelId(data: Record<string, unknown>) {
  const hubtel = typeof data.hubtel === 'object' && data.hubtel !== null ? data.hubtel as Record<string, unknown> : {}
  const sms = typeof data.sms === 'object' && data.sms !== null ? data.sms as Record<string, unknown> : {}
  const hubtelSms = typeof data.hubtelSms === 'object' && data.hubtelSms !== null ? data.hubtelSms as Record<string, unknown> : {}
  return firstText(
    data.hubtelSenderId,
    data.hubtelSenderID,
    data.hubtelSenderName,
    data.hubtelSmsSenderId,
    data.hubtelClientId,
    data.hubtelAccountId,
    data.hubtelMerchantId,
    data.smsSenderId,
    data.smsSenderName,
    hubtel.senderId,
    hubtel.senderName,
    hubtel.clientId,
    sms.hubtelSenderId,
    sms.senderId,
    sms.senderName,
    hubtelSms.senderId,
    hubtelSms.senderName,
  )
}

export default function BulkMessaging() {
  const { storeId } = useActiveStore()
  const { name: workspaceName } = useWorkspaceIdentity()
  const [customers, setCustomers] = useState<AudienceContact[]>([])
  const [students, setStudents] = useState<AudienceContact[]>([])
  const [registrations, setRegistrations] = useState<AudienceContact[]>([])
  const [donors, setDonors] = useState<AudienceContact[]>([])
  const [volunteers, setVolunteers] = useState<AudienceContact[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const channel: BulkMessageChannel = 'sms'
  const [message, setMessage] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [audienceFilter, setAudienceFilter] = useState<AudienceKind | 'all'>('all')
  const [status, setStatus] = useState<StatusMessage | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [creditBalance, setCreditBalance] = useState<number>(0)
  const [creditLoading, setCreditLoading] = useState(true)
  const [storeSmsStatus, setStoreSmsStatus] = useState<StoreSmsStatus>({ approved: false, hubtelId: null, businessName: '', contactEmail: '', contactPhone: '' })
  const [buyingPackageId, setBuyingPackageId] = useState<string | null>(null)
  const [buyStatus, setBuyStatus] = useState<StatusMessage | null>(null)
  const [activeTab, setActiveTab] = useState<BulkMessagingTab>('send')
  const [approvalForm, setApprovalForm] = useState<SmsApprovalForm>({
    businessName: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    certificateUrl: '',
    notes: '',
  })
  const [approvalStatus, setApprovalStatus] = useState<StatusMessage | null>(null)
  const [submittingApproval, setSubmittingApproval] = useState(false)

  const sendBulkMessage = useMemo(
    () => httpsCallable<BulkMessagePayload, BulkMessageResult>(functions, 'sendBulkMessage'),
    [],
  )

  const createBulkCreditsCheckout = useMemo(
    () =>
      httpsCallable<BulkCreditsCheckoutPayload, BulkCreditsCheckoutResult>(
        functions,
        'createBulkCreditsCheckout',
      ),
    [],
  )

  useEffect(() => {
    let cancelled = false

    if (!storeId) {
      setCustomers([])
      setSelectedIds(new Set())
      setCreditBalance(0)
      setCreditLoading(false)
      return () => {
        cancelled = true
      }
    }

    loadCachedCustomers<Customer>({ storeId })
      .then(cached => {
        if (!cancelled && cached.length) {
          setCustomers(
            [...cached]
              .map(contactFromCustomer)
              .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })),
          )
        }
      })
      .catch(error => {
        console.warn('[bulk-messaging] Failed to load cached customers', error)
      })

    const customerQuery = query(
      collection(db, 'customers'),
      where('storeId', '==', storeId),
      orderBy('updatedAt', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(CUSTOMER_CACHE_LIMIT),
    )

    const unsubscribe = onSnapshot(customerQuery, snap => {
      const rows = snap.docs.map(docSnap => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<Customer, 'id'>),
      }))

      saveCachedCustomers(rows, { storeId }).catch(error => {
        console.warn('[bulk-messaging] Failed to cache customers', error)
      })

      setCustomers(
        [...rows]
          .map(contactFromCustomer)
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base' })),
      )
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [storeId])

  useEffect(() => {
    if (!storeId) {
      setStudents([])
      setRegistrations([])
      setDonors([])
      setVolunteers([])
      return undefined
    }

    const unsubscribers = [
      onSnapshot(query(collection(db, 'students'), where('storeId', '==', storeId), limit(500)), snapshot => {
        setStudents(snapshot.docs.map(item => contactFromStudent(item.id, item.data() as Record<string, unknown>)))
      }),
      onSnapshot(query(collection(db, 'student_registrations'), where('storeId', '==', storeId), limit(500)), snapshot => {
        setRegistrations(snapshot.docs.map(item => contactFromRegistration(item.id, item.data() as Record<string, unknown>)))
      }),
      onSnapshot(query(collection(db, 'donor_profiles'), where('storeId', '==', storeId), limit(500)), snapshot => {
        setDonors(snapshot.docs.map(item => contactFromDonor(item.id, item.data() as Record<string, unknown>)))
      }),
      onSnapshot(query(collection(db, 'volunteer_applications'), where('storeId', '==', storeId), limit(500)), snapshot => {
        setVolunteers(snapshot.docs.map(item => contactFromVolunteer(item.id, item.data() as Record<string, unknown>)))
      }),
    ]

    return () => unsubscribers.forEach(unsubscribe => unsubscribe())
  }, [storeId])

  useEffect(() => {
    if (!storeId) return undefined

    setCreditLoading(true)

    const unsubscribe = onSnapshot(
      doc(db, 'stores', storeId),
      snapshot => {
        const data = snapshot.data() ?? {}
        const rawCredits = data.bulkMessagingCredits
        const nextCredits =
          typeof rawCredits === 'number' && Number.isFinite(rawCredits) ? rawCredits : 0
        const hubtelId = resolveHubtelId(data)
        const businessName = firstText(data.displayName, data.storeName, data.name, workspaceName)
        const contactEmail = firstText(data.publicEmail, data.email, data.ownerEmail)
        const contactPhone = firstText(data.storePhone, data.phone, data.phoneNumber, data.whatsappNumber, data.waLink)
        setCreditBalance(nextCredits)
        setStoreSmsStatus({
          approved: Boolean(hubtelId),
          hubtelId: hubtelId || null,
          businessName,
          contactEmail,
          contactPhone,
        })
        setApprovalForm(current => ({
          ...current,
          businessName: current.businessName || businessName,
          contactEmail: current.contactEmail || contactEmail,
          contactPhone: current.contactPhone || contactPhone,
        }))
        setCreditLoading(false)
      },
      error => {
        console.error('[bulk-messaging] Failed to load bulk messaging credits', error)
        setCreditBalance(0)
        setCreditLoading(false)
      },
    )

    return () => unsubscribe()
  }, [storeId, workspaceName])

  const allContacts = useMemo(
    () => uniqueByPhoneOrId([...customers, ...students, ...registrations, ...donors, ...volunteers]),
    [customers, students, registrations, donors, volunteers],
  )

  const countsByAudience = useMemo(() => {
    const counts = new Map<AudienceKind | 'all', number>()
    AUDIENCE_OPTIONS.forEach(option => counts.set(option.id, 0))
    allContacts.forEach(contact => counts.set(contact.source, (counts.get(contact.source) ?? 0) + 1))
    counts.set('all', allContacts.length)
    return counts
  }, [allContacts])

  const tagOptions = useMemo(() => {
    const tags = new Set<string>()
    allContacts.forEach(contact => {
      contact.tags?.forEach(tag => {
        if (tag) tags.add(tag)
      })
    })
    return Array.from(tags).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [allContacts])

  const filteredCustomers = useMemo(() => {
    const normalizedSearch = normalizeSearchTerm(searchTerm)
    return allContacts.filter(contact => {
      if (audienceFilter !== 'all' && contact.source !== audienceFilter) return false
      if (tagFilter && !(contact.tags ?? []).includes(tagFilter)) return false
      if (!normalizedSearch) return true
      const haystack = [
        contact.name ?? '',
        contact.phone ?? '',
        contact.email ?? '',
        contact.meta ?? '',
        contact.label,
        ...(contact.tags ?? []),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedSearch)
    })
  }, [allContacts, searchTerm, tagFilter, audienceFilter])

  const selectedCustomers = useMemo(
    () => allContacts.filter(customer => selectedIds.has(customer.id)),
    [allContacts, selectedIds],
  )

  const selectableCustomers = useMemo(
    () => selectedCustomers.filter(customer => Boolean(customer.phone?.trim())),
    [selectedCustomers],
  )

  const messageLength = message.length
  const messageSegments = Math.max(1, Math.ceil(messageLength / SMS_SEGMENT_SIZE))
  const messageCreditsPerRecipient = messageSegments * CREDITS_PER_SMS
  const messageCostEstimate = messageSegments * SMS_PRICE_ESTIMATE_GHS
  const creditsNeeded = selectableCustomers.length * messageSegments * CREDITS_PER_SMS
  const hasEnoughCredits = creditBalance >= creditsNeeded
  const estimatedSmsBalance = Math.floor(Math.max(creditBalance, 0) / CREDITS_PER_SMS)

  const allVisibleSelected =
    filteredCustomers.length > 0 && filteredCustomers.every(customer => selectedIds.has(customer.id))

  const canSend =
    Boolean(storeId) &&
    storeSmsStatus.approved &&
    message.trim().length > 0 &&
    message.trim().length <= MESSAGE_LIMIT &&
    selectableCustomers.length > 0 &&
    hasEnoughCredits &&
    !isSending

  const statusToneClass = status ? `bulk-messaging-page__status--${status.tone}` : ''
  const buyStatusToneClass = buyStatus
    ? `bulk-messaging-page__status--${buyStatus.tone}`
    : ''
  const approvalStatusToneClass = approvalStatus
    ? `bulk-messaging-page__status--${approvalStatus.tone}`
    : ''

  function handleToggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function handleSelectAllVisible() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        filteredCustomers.forEach(customer => next.delete(customer.id))
      } else {
        filteredCustomers.forEach(customer => next.add(customer.id))
      }
      return next
    })
  }

  function handleUseTemplate(template: MessageTemplate) {
    const storeName = workspaceName?.trim() || 'our store'
    const personalizedContent = template.content.replaceAll('{{store}}', storeName)

    setMessage(personalizedContent)
    setStatus({
      tone: 'info',
      message: `Template "${template.title}" inserted. Replace placeholders like {{name}} before sending.`,
    })
  }

  function updateApprovalForm(key: keyof SmsApprovalForm, value: string) {
    setApprovalForm(current => ({ ...current, [key]: value }))
  }

  async function handleApprovalRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setApprovalStatus(null)

    if (!storeId) {
      setApprovalStatus({ tone: 'error', message: 'Select a workspace before requesting SMS approval.' })
      return
    }

    if (!approvalForm.businessName.trim() || !approvalForm.contactPhone.trim()) {
      setApprovalStatus({ tone: 'error', message: 'Business name and contact phone are required.' })
      return
    }

    setSubmittingApproval(true)

    try {
      await addDoc(collection(db, 'sms_sender_requests'), {
        storeId,
        businessName: approvalForm.businessName.trim(),
        contactName: approvalForm.contactName.trim() || null,
        contactEmail: approvalForm.contactEmail.trim().toLowerCase() || null,
        contactPhone: approvalForm.contactPhone.trim(),
        certificateUrl: approvalForm.certificateUrl.trim() || null,
        notes: approvalForm.notes.trim() || null,
        status: 'submitted',
        requestedAt: serverTimestamp(),
      })
      setApprovalStatus({
        tone: 'success',
        message: `Request submitted. Please also email your business certificate to ${SEDIFEX_SMS_APPROVAL_EMAIL}.`,
      })
    } catch (error) {
      console.error('[bulk-messaging] SMS approval request failed', error)
      setApprovalStatus({
        tone: 'error',
        message: 'Could not submit the approval request. You can still email your certificate directly.',
      })
    } finally {
      setSubmittingApproval(false)
    }
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setStatus(null)

    if (!storeId) {
      setStatus({ tone: 'error', message: 'Select a workspace before sending messages.' })
      return
    }

    if (!storeSmsStatus.approved) {
      setStatus({ tone: 'error', message: 'SMS sending is locked until Sedifex approves your Hubtel sender profile.' })
      return
    }

    if (!message.trim()) {
      setStatus({ tone: 'error', message: 'Write a message to send before continuing.' })
      return
    }

    if (message.length > MESSAGE_LIMIT) {
      setStatus({ tone: 'error', message: `Message exceeds the ${MESSAGE_LIMIT} character limit.` })
      return
    }

    if (!selectableCustomers.length) {
      setStatus({
        tone: 'error',
        message: 'Select at least one contact with a phone number to continue.',
      })
      return
    }

    if (creditLoading) {
      setStatus({
        tone: 'info',
        message: 'Checking SMS credits. Please wait a moment and try again.',
      })
      return
    }

    if (!hasEnoughCredits) {
      setStatus({
        tone: 'error',
        message: 'You are out of SMS credits. Please buy more to continue.',
      })
      return
    }

    setIsSending(true)

    try {
      const payload: BulkMessagePayload = {
        storeId,
        channel,
        message: message.trim(),
        recipients: selectableCustomers.map(customer => ({
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
        })),
      }

      const response = await sendBulkMessage(payload)
      const data = response.data

      if (!data.ok) {
        throw new Error('Hubtel could not process the request.')
      }

      if (data.failures.length) {
        const failureSummary = data.failures
          .slice(0, 3)
          .map((failure: { phone: string; error: string }) => {
            const phone = failure.phone || 'Unknown number'
            const reason = failure.error || 'Unknown error'
            return `${phone}: ${reason}`
          })
          .join(' | ')
        const extraFailures =
          data.failures.length > 3 ? ` (+${data.failures.length - 3} more)` : ''
        setStatus({
          tone: 'info',
          message: `Sent ${data.sent} of ${data.attempted} messages. ${data.failures.length} failed to send. ${failureSummary}${extraFailures}`,
        })
      } else {
        setStatus({
          tone: 'success',
          message: `Sent ${data.sent} SMS messages successfully.`,
        })
      }
    } catch (error) {
      console.error('[bulk-messaging] Failed to send bulk message', error)
      if (error instanceof FirebaseError && error.code === 'failed-precondition') {
        setStatus({
          tone: 'error',
          message: error.message || 'You do not have enough SMS credits to send.',
        })
        return
      }
      setStatus({
        tone: 'error',
        message: 'We could not send the messages. Check Hubtel configuration and try again.',
      })
    } finally {
      setIsSending(false)
    }
  }

  async function handleBuyCredits(packageId: string) {
    setBuyStatus(null)

    if (!storeId) {
      setBuyStatus({ tone: 'error', message: 'Select a workspace before buying credits.' })
      return
    }

    if (!storeSmsStatus.approved) {
      setBuyStatus({ tone: 'error', message: 'Request SMS approval before buying credits for this store.' })
      setActiveTab('send')
      return
    }

    if (buyingPackageId) return

    setBuyingPackageId(packageId)

    try {
      const redirectUrl = `${window.location.origin}/bulk-messaging`
      const response = await createBulkCreditsCheckout({
        storeId,
        package: packageId,
        redirectUrl,
      })
      const data = response.data
      const authorizationUrl =
        typeof data?.authorizationUrl === 'string' ? data.authorizationUrl : null

      if (!authorizationUrl) {
        throw new Error('Paystack did not return a checkout URL.')
      }

      window.location.assign(authorizationUrl)
    } catch (error) {
      console.error('[bulk-messaging] Failed to start bulk credits checkout', error)
      setBuyStatus({
        tone: 'error',
        message: 'We could not start the Paystack checkout. Please try again.',
      })
    } finally {
      setBuyingPackageId(null)
    }
  }

  return (
    <div className="page bulk-messaging-page">
      <header className="page__header">
        <div>
          <h2 className="page__title">Bulk SMS</h2>
          <p className="page__subtitle">
            Broadcast promotions, reminders, or updates to customers, students, donors, volunteers,
            and website registrations using a Hubtel-powered messaging hub.
          </p>
        </div>
      </header>

      <div className="bulk-messaging-page__tabs" role="tablist" aria-label="SMS sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'send'}
          className={`button button--ghost bulk-messaging-page__tab${
            activeTab === 'send' ? ' is-active' : ''
          }`}
          onClick={() => setActiveTab('send')}
        >
          Send SMS
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'buy'}
          className={`button button--ghost bulk-messaging-page__tab${
            activeTab === 'buy' ? ' is-active' : ''
          }`}
          onClick={() => setActiveTab('buy')}
        >
          Buy credits
        </button>
      </div>

      <section
        className={`bulk-messaging-page__balance${!creditLoading && creditBalance <= 0 ? ' is-empty' : ''}`}
        aria-live="polite"
      >
        <div className="bulk-messaging-page__balance-copy">
          <span className="bulk-messaging-page__balance-label">SMS credit balance</span>
          <div className="bulk-messaging-page__balance-value">
            {creditLoading ? (
              <span className="bulk-messaging-page__balance-loading">Checking…</span>
            ) : (
              <>
                <strong>{formatNumber(Math.max(0, Math.floor(creditBalance)))}</strong>
                <span>credits</span>
              </>
            )}
          </div>
          <p className="bulk-messaging-page__balance-meta">
            {creditLoading
              ? 'Checking the credits available to this workspace.'
              : creditBalance > 0
                ? `About ${formatNumber(estimatedSmsBalance)} one-segment SMS available at 12 credits per SMS.`
                : 'No SMS credits available. Buy a package to start sending.'}
          </p>
        </div>
        <div className="bulk-messaging-page__balance-actions">
          <span className="bulk-messaging-page__balance-status">
            {storeSmsStatus.approved && storeSmsStatus.hubtelId
              ? `Sender: ${storeSmsStatus.hubtelId}`
              : 'SMS approval required'}
          </span>
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setActiveTab('buy')}
            disabled={!storeId}
          >
            {creditBalance > 0 ? 'Top up credits' : 'Buy credits'}
          </button>
        </div>
      </section>

      {activeTab === 'send' && !storeSmsStatus.approved ? (
        <section className="card bulk-messaging-page__approval" role="tabpanel">
          <div>
            <p className="bulk-messaging-page__approval-eyebrow">SMS approval required</p>
            <h3 className="card__title">Request Hubtel SMS approval</h3>
            <p className="card__subtitle">
              This store does not have a Hubtel sender ID saved yet, so SMS sending is locked. Submit your business details here, then email your business certificate to <strong>{SEDIFEX_SMS_APPROVAL_EMAIL}</strong>.
            </p>
          </div>

          <form className="bulk-messaging-page__approval-form" onSubmit={handleApprovalRequest}>
            <label className="field">
              <span className="field__label">Business name *</span>
              <input value={approvalForm.businessName} onChange={event => updateApprovalForm('businessName', event.target.value)} placeholder="Registered business name" />
            </label>
            <label className="field">
              <span className="field__label">Contact person</span>
              <input value={approvalForm.contactName} onChange={event => updateApprovalForm('contactName', event.target.value)} placeholder="Owner or manager name" />
            </label>
            <label className="field">
              <span className="field__label">Contact phone *</span>
              <input value={approvalForm.contactPhone} onChange={event => updateApprovalForm('contactPhone', event.target.value)} placeholder="+233..." />
            </label>
            <label className="field">
              <span className="field__label">Email</span>
              <input type="email" value={approvalForm.contactEmail} onChange={event => updateApprovalForm('contactEmail', event.target.value)} placeholder="business@example.com" />
            </label>
            <label className="field">
              <span className="field__label">Business certificate link</span>
              <input value={approvalForm.certificateUrl} onChange={event => updateApprovalForm('certificateUrl', event.target.value)} placeholder="Google Drive / website link, optional" />
            </label>
            <label className="field bulk-messaging-page__approval-notes">
              <span className="field__label">Notes</span>
              <textarea value={approvalForm.notes} onChange={event => updateApprovalForm('notes', event.target.value)} placeholder="Preferred sender name, business type, or anything Sedifex should know." />
            </label>
            {approvalStatus ? (
              <div className={`bulk-messaging-page__status ${approvalStatusToneClass}`} role="status">
                {approvalStatus.message}
              </div>
            ) : null}
            <div className="bulk-messaging-page__approval-actions">
              <button type="submit" className="button button--primary" disabled={submittingApproval}>
                {submittingApproval ? 'Submitting…' : 'Submit request'}
              </button>
              <a
                className="button button--outline"
                href={`mailto:${SEDIFEX_SMS_APPROVAL_EMAIL}?subject=${encodeURIComponent(`SMS approval request - ${approvalForm.businessName || workspaceName || storeId || 'Sedifex store'}`)}&body=${encodeURIComponent(`Hello Sedifex,%0A%0AI want to request Hubtel SMS approval for my store.%0A%0ABusiness name: ${approvalForm.businessName}%0AContact name: ${approvalForm.contactName}%0APhone: ${approvalForm.contactPhone}%0AEmail: ${approvalForm.contactEmail}%0A%0AI have attached or linked my business certificate.%0A`)}`}
              >
                Email business certificate
              </a>
            </div>
          </form>
        </section>
      ) : null}

      {activeTab === 'send' && storeSmsStatus.approved ? (
        <div className="bulk-messaging-page__grid" role="tabpanel">
          <section className="card">
          <div className="bulk-messaging-page__section-header">
            <div>
              <h3 className="card__title">Compose message</h3>
              <p className="card__subtitle">
                Craft your message and send to the selected audience. Sender ID: {storeSmsStatus.hubtelId}.
              </p>
            </div>
          </div>

          <div className="bulk-messaging-page__audience-cards" aria-label="Audience categories">
            {AUDIENCE_OPTIONS.map(option => {
              const isActive = audienceFilter === option.id
              const count = countsByAudience.get(option.id) ?? 0
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`bulk-messaging-page__audience-card${isActive ? ' is-active' : ''}`}
                  onClick={() => setAudienceFilter(option.id)}
                >
                  <span>{option.label}</span>
                  <strong>{formatNumber(count)}</strong>
                  <small>{option.description}</small>
                </button>
              )
            })}
          </div>

          <div className="bulk-messaging-page__templates">
            <p className="bulk-messaging-page__templates-title">Templates</p>
            <div className="bulk-messaging-page__templates-list">
              {MESSAGE_TEMPLATES.map(template => (
                <button
                  key={template.id}
                  type="button"
                  className="button button--outline button--small"
                  onClick={() => handleUseTemplate(template)}
                >
                  {template.title}
                </button>
              ))}
            </div>
          </div>

          <form className="bulk-messaging-page__form" onSubmit={handleSend}>
            <label className="field">
              <span className="field__label">Message</span>
              <textarea
                className="bulk-messaging-page__textarea"
                placeholder="Write your announcement, offer, or reminder..."
                value={message}
                maxLength={MESSAGE_LIMIT}
                onChange={event => setMessage(event.target.value)}
              />
              <span className="bulk-messaging-page__hint">
                {MESSAGE_LIMIT - messageLength} characters remaining
                {` · ${messageSegments} segment(s) · ${formatNumber(
                  messageCreditsPerRecipient,
                )} credits required · ~GHS ${formatPrice(messageCostEstimate)}`}
              </span>
            </label>

            {status ? (
              <div className={`bulk-messaging-page__status ${statusToneClass}`} role="status">
                {status.message}
              </div>
            ) : null}

            <div className="bulk-messaging-page__actions">
              <button type="submit" className="button button--primary" disabled={!canSend}>
                {isSending ? 'Sending...' : 'Send SMS'}
              </button>
              <div className="bulk-messaging-page__actions-meta">
                {hasEnoughCredits
                  ? 'Only selected contacts with phone numbers will receive this broadcast.'
                  : 'Purchase SMS credits to unlock sending.'}
              </div>
            </div>
          </form>
          </section>

          <section className="card">
          <div className="bulk-messaging-page__section-header">
            <div>
              <h3 className="card__title">Recipients</h3>
              <p className="card__subtitle">
                Select recipients by category, tag, name, phone, or source.
              </p>
            </div>
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={handleSelectAllVisible}
              disabled={!filteredCustomers.length}
            >
              {allVisibleSelected ? 'Clear shown' : 'Select shown'}
            </button>
          </div>

          <div className="bulk-messaging-page__filters">
            <label className="field">
              <span className="field__label">Audience</span>
              <select value={audienceFilter} onChange={event => setAudienceFilter(event.target.value as AudienceKind | 'all')}>
                {AUDIENCE_OPTIONS.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.label} ({formatNumber(countsByAudience.get(option.id) ?? 0)})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Search</span>
              <input
                type="search"
                placeholder="Search contacts"
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Tag</span>
              <select value={tagFilter ?? ''} onChange={event => setTagFilter(event.target.value || null)}>
                <option value="">All tags</option>
                {tagOptions.map(tag => (
                  <option key={tag} value={tag}>
                    #{tag}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="bulk-messaging-page__recipient-context">
            Showing {formatNumber(filteredCustomers.length)} of {formatNumber(allContacts.length)}{' '}
            contacts · {formatNumber(selectedCustomers.length)} selected · {formatNumber(selectableCustomers.length)} with phone
          </p>

          <div className="bulk-messaging-page__recipient-list" role="list">
            {filteredCustomers.length ? (
              filteredCustomers.map(customer => {
                const displayName = customer.name || 'Unknown contact'
                const hasPhone = Boolean(customer.phone?.trim())
                const isSelected = selectedIds.has(customer.id)

                return (
                  <label
                    key={customer.id}
                    className={`bulk-messaging-page__recipient-row${
                      isSelected ? ' is-selected' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSelect(customer.id)}
                    />
                    <span className="bulk-messaging-page__recipient-name">
                      {displayName}
                      <small className="bulk-messaging-page__recipient-source">{customer.label}{customer.meta ? ` · ${customer.meta}` : ''}</small>
                    </span>
                    <span className="bulk-messaging-page__recipient-meta">
                      {hasPhone ? formatPhone(customer.phone) : 'No phone on file'}
                    </span>
                  </label>
                )
              })
            ) : (
              <div className="bulk-messaging-page__empty">
                <h4>No contacts found</h4>
                <p>Update your filters or add contacts/students/donors/volunteers with phone numbers.</p>
              </div>
            )}
          </div>
          </section>
        </div>
      ) : null}

      {activeTab === 'buy' ? (
        <section className="card bulk-messaging-page__buy-credits" id="buy-credits" role="tabpanel">
        <div>
          <h3 className="card__title">Buy SMS credits</h3>
          <p className="card__subtitle">
            {storeSmsStatus.approved
              ? 'Top up your balance to keep broadcasting SMS campaigns.'
              : `SMS credits are available after Hubtel approval. Submit your certificate to ${SEDIFEX_SMS_APPROVAL_EMAIL} first.`}
          </p>
        </div>
        <div className="bulk-messaging-page__buy-credits-actions">
          <div className="bulk-messaging-page__buy-credits-grid">
            {BULK_CREDITS_PACKAGES.map(creditPackage => {
              const isBusy = buyingPackageId === creditPackage.id
              return (
                <button
                  key={creditPackage.id}
                  type="button"
                  className="button button--outline bulk-messaging-page__buy-credits-option"
                  onClick={() => handleBuyCredits(creditPackage.id)}
                  disabled={!storeId || !storeSmsStatus.approved || Boolean(buyingPackageId)}
                >
                  <span className="bulk-messaging-page__buy-credits-label">
                    {creditPackage.label}
                  </span>
                  <span className="bulk-messaging-page__buy-credits-amount">
                    <strong>{formatNumber(creditPackage.credits)}</strong>
                    <small>credits</small>
                  </span>
                  <span className="bulk-messaging-page__buy-credits-sms">
                    ≈ {formatNumber(Math.round(creditPackage.credits / CREDITS_PER_SMS))} one-segment SMS
                  </span>
                  <span className="bulk-messaging-page__buy-credits-footer">
                    <span className="bulk-messaging-page__buy-credits-price">
                      <strong>GHS {creditPackage.price}</strong>
                      <small>one-time top-up</small>
                    </span>
                    <span className="bulk-messaging-page__buy-credits-cta">
                      {isBusy ? 'Starting checkout…' : storeSmsStatus.approved ? 'Buy now' : 'Approval required'}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          {buyStatus ? (
            <div className={`bulk-messaging-page__status ${buyStatusToneClass}`} role="status">
              {buyStatus.message}
            </div>
          ) : (
            <p className="bulk-messaging-page__buy-credits-note">
              Choose a package to continue to Paystack checkout. Estimated SMS cost is about GHS{' '}
              {formatPrice(SMS_PRICE_ESTIMATE_GHS)} per SMS (12 credits per SMS).
            </p>
          )}
        </div>
        </section>
      ) : null}
    </div>
  )
}
