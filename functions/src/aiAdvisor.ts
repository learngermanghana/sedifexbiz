import * as functions from 'firebase-functions/v1'
import { defineString } from 'firebase-functions/params'
import { Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { defaultDb } from './firestore'

const OPENAI_API_KEY = defineString('OPENAI_API_KEY')
const MODEL_NAME = 'gpt-4o-mini'
const MAX_CONTEXT_CHARS = 12000

// ---------- Request / response types ----------

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

// ---------- Data shapes used in context ----------

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

type ProductCounts = {
  total: number
  products: number
  services: number
}

type ActivityEntry = {
  id: string
  createdAt: unknown
  type: string
  summary: string
  detail: string
  actor: string
}

type TrendSummary = {
  window: { start: string | unknown; end: string | unknown }
  totalSales: number
  avgDailySales: number
  receiptCount: number
}

type GoalProgress = {
  target: number | null
  period: string | null
  monthToDateSales: number
  progressPct: number | null
  projectedEndPct: number | null
}

type ExpenseSummary = {
  window: { start: string | unknown; end: string | unknown }
  totalExpenses: number
}

// ---------- Helpers: coercion / formatting ----------

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

function truncateJson(data: unknown, maxChars: number) {
  const json = JSON.stringify(data, null, 2)
  if (json.length <= maxChars) return json
  return `${json.slice(0, maxChars)}\n…truncated…`
}

// ---------- Time range helpers ----------

function getDayRange(date: Date) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return {
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
  }
}

function getTodayRange() {
  return getDayRange(new Date())
}

function getLastNDaysRange(days: number) {
  const end = new Date()
  end.setHours(0, 0, 0, 0) // today 00:00
  const start = new Date(end)
  start.setDate(start.getDate() - days)

  return {
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
  }
}

// ---------- Pick workspace/store fields ----------

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

// ---------- Sales & expenses aggregation ----------

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

async function buildTrendSummary(storeId: string, days: number): Promise<TrendSummary> {
  const { start, end } = getLastNDaysRange(days)
  const snapshot = await defaultDb
    .collection('sales')
    .where('storeId', '==', storeId)
    .where('createdAt', '>=', start)
    .where('createdAt', '<', end)
    .get()

  let totalSales = 0
  let receiptCount = 0

  snapshot.forEach(docSnap => {
    const data = docSnap.data() as any
    totalSales += normalizeNumber(data.total)
    receiptCount += 1
  })

  const avgDailySales = days > 0 ? totalSales / days : 0

  return {
    window: {
      start: normalizeTimestamp(start),
      end: normalizeTimestamp(end),
    },
    totalSales,
    avgDailySales,
    receiptCount,
  }
}

async function buildExpenseSummary(storeId: string, days: number): Promise<ExpenseSummary> {
  const { start, end } = getLastNDaysRange(days)
  const snapshot = await defaultDb
    .collection('expenses')
    .where('storeId', '==', storeId)
    .where('createdAt', '>=', start)
    .where('createdAt', '<', end)
    .get()

  let totalExpenses = 0

  snapshot.forEach(docSnap => {
    const data = docSnap.data() as any
    totalExpenses += normalizeNumber(data.amount ?? data.total ?? data.value)
  })

  return {
    window: {
      start: normalizeTimestamp(start),
      end: normalizeTimestamp(end),
    },
    totalExpenses,
  }
}

// ---------- Closeouts, products, activity, goals ----------

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

async function fetchProductCounts(storeId: string): Promise<ProductCounts> {
  const baseQuery = defaultDb.collection('products').where('storeId', '==', storeId)

  const [allSnapshot, servicesSnapshot] = await Promise.all([
    baseQuery.count().get(),
    baseQuery.where('itemType', '==', 'service').count().get(),
  ])

  const total = allSnapshot.data().count
  const services = servicesSnapshot.data().count

  return {
    total,
    services,
    products: Math.max(total - services, 0),
  }
}

async function fetchRecentActivity(storeId: string): Promise<ActivityEntry[]> {
  const snapshot = await defaultDb
    .collection('activity')
    .where('storeId', '==', storeId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get()

  return snapshot.docs.map(docSnap => {
    const data = docSnap.data() as any

    // You can mask emails here if you like:
    const actorRaw = typeof data.actor === 'string' ? data.actor : ''
    const actor = actorRaw

    return {
      id: docSnap.id,
      createdAt: normalizeTimestamp(data.createdAt),
      type: typeof data.type === 'string' ? data.type : 'unknown',
      summary: typeof data.summary === 'string' ? data.summary : '',
      detail: typeof data.detail === 'string' ? data.detail : '',
      actor,
    }
  })
}

async function fetchGoalProgress(storeId: string, monthSales: number): Promise<GoalProgress> {
  // Assumes a document in storeGoals with id == storeId
  const goalSnap = await defaultDb.collection('storeGoals').doc(storeId).get()
  if (!goalSnap.exists) {
    return {
      target: null,
      period: null,
      monthToDateSales: monthSales,
      progressPct: null,
      projectedEndPct: null,
    }
  }

  const data = goalSnap.data() as any
  const target = normalizeNumber(data.target ?? data.salesTarget)
  const period =
    typeof data.period === 'string'
      ? data.period
      : typeof data.type === 'string'
        ? data.type
        : 'monthly'

  // monthSales passed in is month-to-date sales
  const progressPct = target > 0 ? (monthSales / target) * 100 : null

  // rough projection: scale current pace to whole month length
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const projectedEnd = dayOfMonth > 0 ? (monthSales / dayOfMonth) * daysInMonth : monthSales
  const projectedEndPct = target > 0 ? (projectedEnd / target) * 100 : null

  return {
    target,
    period,
    monthToDateSales: monthSales,
    progressPct,
    projectedEndPct,
  }
}

// ---------- Build overall context ----------

async function buildContext(storeId: string, userContext: Record<string, unknown> | null) {
  const todayRange = getTodayRange()
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthStartTs = Timestamp.fromDate(monthStart)

  const [
    workspaceSnap,
    storeSnap,
    salesToday,
    sales7d,
    salesPrev7d,
    expenses7d,
    closeouts,
    productCounts,
    activity,
    monthSalesSnap,
  ] = await Promise.all([
    defaultDb.collection('workspaces').doc(storeId).get(),
    defaultDb.collection('stores').doc(storeId).get(),
    buildSalesSummary(storeId).catch(error => ({
      error: error instanceof Error ? error.message : String(error),
    })),
    buildTrendSummary(storeId, 7).catch(error => ({
      error: error instanceof Error ? error.message : String(error),
    })),
    buildTrendSummary(storeId, 14).catch(error => ({
      error: error instanceof Error ? error.message : String(error),
    })), // use 7 vs previous 7 out of 14 days
    buildExpenseSummary(storeId, 7).catch(error => ({
      error: error instanceof Error ? error.message : String(error),
    })),
    fetchRecentCloseouts(storeId).catch(error => ({
      error: error instanceof Error ? error.message : String(error),
    })),
    fetchProductCounts(storeId).catch(error => ({
      error: error instanceof Error ? error.message : String(error),
    })),
    fetchRecentActivity(storeId).catch(error => ({
      error: error instanceof Error ? error.message : String(error),
    })),
    defaultDb
      .collection('sales')
      .where('storeId', '==', storeId)
      .where('createdAt', '>=', monthStartTs)
      .where('createdAt', '<', todayRange.start) // up to start of today
      .get()
      .catch(error => ({
        error: error instanceof Error ? error.message : String(error),
      })),
  ])

  const workspace = pickWorkspaceData(workspaceSnap.exists ? workspaceSnap.data() : null)
  const store = pickStoreData(storeSnap.exists ? storeSnap.data() : null)

  // Month-to-date sales calculation
  let monthToDateSales = 0
  if ('docs' in monthSalesSnap && Array.isArray((monthSalesSnap as any).docs)) {
    ;(monthSalesSnap as any).docs.forEach((docSnap: any) => {
      const data = docSnap.data()
      monthToDateSales += normalizeNumber(data.total)
    })
  }

  const goalProgress = await fetchGoalProgress(storeId, monthToDateSales).catch(error => ({
    error: error instanceof Error ? error.message : String(error),
  }))

  // Build a simpler "kpi" block for managers
  const kpis = {
    today: salesToday,
    trend7d: sales7d,
    trendPrev7d: salesPrev7d,
    expenses7d,
    goalProgress,
  }

  return {
    storeId,
    workspace,
    store,
    userContext,
    kpis,
    salesSummary: salesToday,
    recentCloseouts: Array.isArray(closeouts) ? closeouts : (closeouts as any)?.error,
    productCounts,
    recentActivity: Array.isArray(activity) ? activity : (activity as any)?.error,
  }
}

// ---------- OpenAI call ----------

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
            [
              'You are "Sedifex AI", an assistant for busy shop managers.',
              'They only have 30 seconds to read your answer.',
              '',
              'When you answer:',
              '1) Start with 3–5 bullet points of the most important insights: big changes, risks, or opportunities.',
              '2) Then show a section called "Actions for today" with 3–7 short bullet points.',
              '   Each action must start with a verb, e.g. "Check…", "Increase…", "Talk to…".',
              '3) Use simple business language. Avoid technical jargon or talking about JSON.',
              '4) If the user asks a specific question, answer it first, then add any extra insights from the data.',
            ].join('\n'),
        },
        {
          role: 'user',
          content: `Store context (truncated to ${MAX_CONTEXT_CHARS} chars):\n${contextJson}\n\nQuestion from manager: ${question}`,
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
    throw new functions.https.HttpsError('internal', 'OpenAI returned an empty response.')
  }

  return advice
}

// ---------- Cloud Function entrypoint ----------

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
        : 'Give me a daily manager briefing: key numbers, risks, and 3–7 concrete actions for today.'

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
