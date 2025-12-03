import * as functions from 'firebase-functions/v1'
import { defineString } from 'firebase-functions/params'
import { Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { defaultDb } from './firestore'

const OPENAI_API_KEY = defineString('OPENAI_API_KEY')
const MODEL_NAME = 'gpt-4o-mini'
const MAX_CONTEXT_CHARS = 12000

type AdvisorRequest = {
  storeId?: unknown
  question?: unknown
  jsonContext?: unknown
}

type AdvisorResponse = {
  advice: string
  storeId: string
  dataPreview: Record<string, unknown>
}

type SalesSummary = {
  window: { start: string | unknown; end: string | unknown }
  totalSales: number
  totalTax: number
  receiptCount: number
  averageSaleValue: number
  paymentBreakdown: Record<string, number>
  topProducts: Array<{ name: string; qty: number; revenue: number }>
}

type CloseoutPreview = {
  id: string
  businessDay: unknown
  salesTotal: number
  expectedCash: number
  countedCash: number
  variance: number
  cardAndDigital: number
  cashRemoved: number
  cashAdded: number
  closedAt: unknown
  closedByName: string
}

function coerceStoreId(data: AdvisorRequest, context: functions.https.CallableContext) {
  const explicitStoreId =
    typeof data.storeId === 'string' && data.storeId.trim() ? data.storeId.trim() : null

  if (explicitStoreId) return explicitStoreId

  const tokenStoreId =
    typeof context.auth?.token?.storeId === 'string' && context.auth.token.storeId.trim()
      ? (context.auth.token.storeId as string)
      : null

  if (!tokenStoreId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'storeId is required either in the request or as a custom claim.',
    )
  }

  return tokenStoreId
}

function normalizeJsonContext(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function normalizeTimestamp(value: unknown) {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  return value
}

function normalizeNumber(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function pickWorkspaceData(raw: DocumentData | undefined | null) {
  if (!raw) return null
  const fields = [
    'company',
    'storeId',
    'status',
    'contractStart',
    'contractEnd',
    'paymentStatus',
    'amountPaid',
    'billingCycle',
    'plan',
    'contactEmail',
    'notes',
  ] as const

  const result: Record<string, unknown> = {}
  for (const key of fields) {
    result[key] = normalizeTimestamp(raw[key])
  }
  return result
}

function pickStoreData(raw: DocumentData | undefined | null) {
  if (!raw) return null
  const billing = raw.billing ?? {}
  return {
    storeName: raw.name ?? raw.company ?? null,
    location: raw.location ?? null,
    paymentStatus: raw.paymentStatus ?? null,
    billing: {
      status: billing.status ?? null,
      planKey: billing.planKey ?? null,
      trialEndsAt: normalizeTimestamp(billing.trialEndsAt),
    },
    metrics: raw.metrics ?? null,
  }
}

function truncateJson(data: unknown, maxChars: number) {
  const json = JSON.stringify(data, null, 2)
  if (json.length <= maxChars) return json
  return `${json.slice(0, maxChars)}\n…truncated…`
}

function getTodayRange() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return {
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
  }
}

async function buildSalesSummary(storeId: string): Promise<SalesSummary> {
  const { start, end } = getTodayRange()
  const snapshot = await defaultDb
    .collection('sales')
    .where('storeId', '==', storeId)
    .where('createdAt', '>=', start)
    .where('createdAt', '<', end)
    .orderBy('createdAt', 'desc')
    .get()

  let totalSales = 0
  let totalTax = 0
  let receiptCount = 0
  const paymentBreakdown: Record<string, number> = {}
  const productMap = new Map<string, { name: string; qty: number; revenue: number }>()

  snapshot.forEach(docSnap => {
    const data = docSnap.data() as any
    const saleTotal = normalizeNumber(data.total)
    const saleTax = normalizeNumber(data.taxTotal)

    totalSales += saleTotal
    totalTax += saleTax
    receiptCount += 1

    const tenders = Array.isArray(data.payment?.tenders) ? data.payment?.tenders : []
    for (const tender of tenders) {
      const method = typeof tender?.method === 'string' ? tender.method.toLowerCase() : 'unknown'
      const amount = normalizeNumber(tender?.amount)
      paymentBreakdown[method] = (paymentBreakdown[method] ?? 0) + amount
    }

    const items = Array.isArray(data.items) ? data.items : []
    for (const item of items) {
      const qty = normalizeNumber((item as any)?.qty)
      const price = normalizeNumber((item as any)?.price)
      const nameCandidate =
        typeof (item as any)?.name === 'string' ? (item as any).name.trim() : 'Unknown product'
      const name = nameCandidate || 'Unknown product'
      const idCandidate = typeof (item as any)?.productId === 'string' ? (item as any).productId : name
      const key = idCandidate || name
      const existing = productMap.get(key) ?? { name, qty: 0, revenue: 0 }

      existing.qty += qty
      existing.revenue += qty * price
      productMap.set(key, existing)
    }
  })

  const averageSaleValue = receiptCount > 0 ? totalSales / receiptCount : 0
  const topProducts = Array.from(productMap.values())
    .sort((a, b) => {
      if (b.qty !== a.qty) return b.qty - a.qty
      return b.revenue - a.revenue
    })
    .slice(0, 5)

  return {
    window: {
      start: normalizeTimestamp(start),
      end: normalizeTimestamp(end),
    },
    totalSales,
    totalTax,
    receiptCount,
    averageSaleValue,
    paymentBreakdown,
    topProducts,
  }
}

async function fetchRecentCloseouts(storeId: string): Promise<CloseoutPreview[]> {
  const closeouts = await defaultDb
    .collection('closeouts')
    .where('storeId', '==', storeId)
    .orderBy('businessDay', 'desc')
    .limit(5)
    .get()

  return closeouts.docs.map(docSnap => {
    const data = docSnap.data() as any
    return {
      id: docSnap.id,
      businessDay: normalizeTimestamp(data.businessDay),
      salesTotal: normalizeNumber(data.salesTotal),
      expectedCash: normalizeNumber(data.expectedCash),
      countedCash: normalizeNumber(data.countedCash),
      variance: normalizeNumber(data.variance),
      cardAndDigital: normalizeNumber(data.cardAndDigital),
      cashRemoved: normalizeNumber(data.cashRemoved),
      cashAdded: normalizeNumber(data.cashAdded),
      closedAt: normalizeTimestamp(data.closedAt),
      closedByName:
        typeof data.closedBy?.displayName === 'string'
          ? data.closedBy.displayName
          : typeof data.closedBy?.email === 'string'
            ? data.closedBy.email
            : 'Unknown',
    }
  })
}

async function buildContext(storeId: string, userContext: Record<string, unknown> | null) {
  const [workspaceSnap, storeSnap, salesSummary, closeouts] = await Promise.all([
    defaultDb.collection('workspaces').doc(storeId).get(),
    defaultDb.collection('stores').doc(storeId).get(),
    buildSalesSummary(storeId).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
    fetchRecentCloseouts(storeId).catch(error => ({ error: error instanceof Error ? error.message : String(error) })),
  ])

  const workspace = pickWorkspaceData(workspaceSnap.exists ? workspaceSnap.data() : null)
  const store = pickStoreData(storeSnap.exists ? storeSnap.data() : null)

  return {
    storeId,
    workspace,
    store,
    userContext,
    salesSummary,
    recentCloseouts: Array.isArray(closeouts) ? closeouts : closeouts?.error,
  }
}

async function callOpenAI(question: string, contextJson: string) {
  const apiKey = OPENAI_API_KEY.value()
  if (!apiKey) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'OPENAI_API_KEY is not configured for this project.',
    )
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are Sedifex AI. Read the provided information, explain what it contains in 50 words essay, actionable suggestions. Always make it personal so the clients can understand. Dont overuse technial terms and arrange it well',
        },
        {
          role: 'user',
          content: `Firebase JSON (truncated to ${MAX_CONTEXT_CHARS} chars):\n${contextJson}\n\nQuestion: ${question}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new functions.https.HttpsError(
      'internal',
      `OpenAI error ${response.status}: ${errorText.substring(0, 400)}`,
    )
  }

  const json = (await response.json()) as any
  const advice = (json?.choices?.[0]?.message?.content as string | undefined)?.trim()

  if (!advice) {
    throw new functions.https.HttpsError(
      'internal',
      'OpenAI returned an empty response.',
    )
  }

  return advice
}

export const generateAiAdvice = functions.https.onCall(
  async (rawData: unknown, context): Promise<AdvisorResponse> => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Login required')
    }

    const data = (rawData ?? {}) as AdvisorRequest
    const storeId = coerceStoreId(data, context)
    const question =
      typeof data.question === 'string' && data.question.trim()
        ? data.question.trim()
        : 'Give me quick advice for this workspace.'
    const userContext = normalizeJsonContext(data.jsonContext)

    const contextData = await buildContext(storeId, userContext)
    const contextJson = truncateJson(contextData, MAX_CONTEXT_CHARS)

    const advice = await callOpenAI(question, contextJson)

    return {
      advice,
      storeId,
      dataPreview: contextData,
    }
  },
)
