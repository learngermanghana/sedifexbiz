import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

export type AiAdvisorPayload = {
  question: string
  storeId?: string
  jsonContext?: unknown
}

export type AiAdvisorResponse = {
  advice: string
  storeId: string
  dataPreview: Record<string, unknown>
}

export async function requestAiAdvisor(
  payload: AiAdvisorPayload,
): Promise<AiAdvisorResponse> {
  const callable = httpsCallable(functions, 'generateAiAdvice')
  const response = await callable(payload)
  return (response.data ?? {}) as AiAdvisorResponse
}
