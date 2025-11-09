// web/src/controllers/signupUnlockController.ts
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

type RawCheckSignupUnlockResponse = {
  ok?: unknown
  email?: unknown
  status?: unknown
  planCode?: unknown
  planId?: unknown
  reference?: unknown
  amount?: unknown
  currency?: unknown
  paidAt?: unknown
  unlockedAt?: unknown
}

type CheckSignupUnlockPayload = {
  email: string
}

export type SignupUnlockResult = {
  eligible: boolean
  email: string
  status: string
  planCode: string | null
  planId: string | null
  reference: string | null
  amount: number | null
  currency: string | null
  paidAt: number | null
  unlockedAt: number | null
}

const checkSignupUnlockCallable = (() => {
  return httpsCallable<CheckSignupUnlockPayload, RawCheckSignupUnlockResponse>(
    functions,
    'checkSignupUnlock',
  )
})()

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }
  return null
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  return null
}

export async function checkSignupUnlock(email: string): Promise<SignupUnlockResult> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
    throw new Error('Enter the email you used during checkout.')
  }

  const response = await checkSignupUnlockCallable({ email: normalizedEmail })
  const data = response.data as RawCheckSignupUnlockResponse | null

  const status = normalizeString(data?.status) ?? 'unknown'
  const eligible = data?.ok === true && status === 'paid'

  return {
    eligible,
    email: normalizeString(data?.email) ?? normalizedEmail,
    status,
    planCode: normalizeString(data?.planCode),
    planId: normalizeString(data?.planId),
    reference: normalizeString(data?.reference),
    amount: normalizeNumber(data?.amount),
    currency: normalizeString(data?.currency),
    paidAt: normalizeNumber(data?.paidAt),
    unlockedAt: normalizeNumber(data?.unlockedAt),
  }
}
