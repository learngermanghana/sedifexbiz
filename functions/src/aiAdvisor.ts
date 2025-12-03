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

async function buildContext(storeId: string, userContext: Record<string, unknown> | null) {
  const [workspaceSnap, storeSnap] = await Promise.all([
    defaultDb.collection('workspaces').doc(storeId).get(),
    defaultDb.collection('stores').doc(storeId).get(),
  ])

  const workspace = pickWorkspaceData(workspaceSnap.exists ? workspaceSnap.data() : null)
  const store = pickStoreData(storeSnap.exists ? storeSnap.data() : null)

  return {
    storeId,
    workspace,
    store,
    userContext,
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
            'You are Sedifex AI. Read the JSON data, explain what it contains, and give 3-5 short, actionable suggestions. Prefer bullet points. Be concise and avoid hallucinating numbers that are not in the JSON.',
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
