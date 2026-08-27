import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

export type PublicEventContractStatus = 'active' | 'changes_requested' | 'signed' | 'revoked'

export type PublicEventContract = {
  ok: boolean
  status: PublicEventContractStatus
  revision: number
  expiresAt: string | null
  event: {
    title?: string
    eventCode?: string
    eventDate?: string
    startTime?: string
    venue?: string
    clientName?: string
    clientEmail?: string
  }
  contract: {
    serviceAgreement?: string
    scopeOfWork?: string
    paymentTerms?: string
    cancellationPolicy?: string
    clientNotes?: string
  }
  brand: {
    storeName?: string
    email?: string
    phone?: string
    logoUrl?: string
    brandColor?: string
  }
  signer: null | {
    name?: string
    email?: string
    signatureText?: string
    signedAt?: string | null
  }
}

function callable<TInput, TOutput>(name: string) {
  return httpsCallable<TInput, TOutput>(functions, name)
}

export async function getPublicEventContract(token: string) {
  const response = await callable<{ token: string }, PublicEventContract>('getPublicEventContract')({ token })
  return response.data
}

export async function signPublicEventContract(input: {
  token: string
  signerName: string
  signatureText: string
  consent: boolean
}) {
  const response = await callable<typeof input, { ok: boolean; pdfUrl: string; reviewUrl: string }>('signPublicEventContract')(input)
  return response.data
}

export async function requestPublicEventContractChanges(input: { token: string; note: string }) {
  const response = await callable<typeof input, { ok: boolean; emailQueued?: boolean }>('requestPublicEventContractChanges')(input)
  return response.data
}

export async function getPublicEventContractPdf(token: string) {
  const response = await callable<{ token: string }, { ok: boolean; mimeType: string; fileName: string; base64: string }>('getPublicEventContractPdf')({ token })
  return response.data
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimeType || 'application/pdf' })
}

export async function downloadPublicEventContractPdf(token: string) {
  const result = await getPublicEventContractPdf(token)
  const blob = base64ToBlob(result.base64, result.mimeType)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = result.fileName || 'event-contract.pdf'
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  return result.fileName
}
