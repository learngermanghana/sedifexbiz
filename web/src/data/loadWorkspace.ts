import {
  collection,
  db,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  rosterDb,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from '../lib/db'
import { FirebaseError } from 'firebase/app'

export type WorkspaceRecord = Record<string, unknown> & { id: string }

export type WorkspaceAccountProfile = {
  id: string
  slug: string | null
  storeId: string | null
  company: string | null
  name: string | null
  displayName: string | null
  email: string | null
  phone: string | null
  status: string | null
  plan: string | null
  paymentStatus: string | null
  contractStart: Date | null
  contractEnd: Date | null
  amountPaid: number | null
  currency: string | null
  timezone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
  createdAt: Date | null
  updatedAt: Date | null
}

export async function getActiveStoreId(uid: string | null | undefined): Promise<string | null> {
  const normalizedUid = normalizeString(uid)
  if (!normalizedUid) return null

  const memberRef = doc(rosterDb, 'teamMembers', normalizedUid)
  try {
    const snapshot = await getDoc(memberRef)
    if (!snapshot.exists()) return null

    const data = snapshot.data()
    return normalizeString(data?.storeId)
  } catch (error) {
    if (isOfflineError(error)) {
      return null
    }

    throw error
  }
}

export async function loadWorkspaceProfile({
  slug,
  storeId,
}: {
  slug?: string | null
  storeId?: string | null
}): Promise<WorkspaceRecord | null> {
  const normalizedSlug = normalizeString(slug)
  if (normalizedSlug) {
    try {
      const workspaceRef = doc(db, 'workspaces', normalizedSlug)
      const workspaceSnapshot = await getDoc(workspaceRef)
      if (workspaceSnapshot.exists()) {
        return snapshotToRecord(workspaceSnapshot)
      }
    } catch (error) {
      if (!isOfflineError(error)) {
        throw error
      }
    }
  }

  const normalizedStoreId = normalizeString(storeId)
  if (normalizedStoreId) {
    try {
      const workspacesRef = collection(db, 'workspaces')
      const workspaceQuery = query(workspacesRef, where('storeId', '==', normalizedStoreId), limit(1))
      const matches = await getDocs(workspaceQuery)
      const first = matches.docs[0] ?? null
      return first ? snapshotToRecord(first) : null
    } catch (error) {
      if (isOfflineError(error)) {
        return null
      }
      throw error
    }
  }

  return null
}

export function mapAccount(workspace: WorkspaceRecord): WorkspaceAccountProfile {
  const status = pickString([
    workspace.contractStatus,
    workspace.status,
    getNested(workspace, ['contract', 'status']),
  ])

  const plan = pickString([
    getNested(workspace, ['billing', 'plan']),
    getNested(workspace, ['subscription', 'plan']),
    workspace.plan,
  ])

  const paymentStatus = pickString([
    getNested(workspace, ['billing', 'paymentStatus']),
    getNested(workspace, ['subscription', 'status']),
    workspace.paymentStatus,
  ])

  const contractStart = pickDate([
    workspace.contractStart,
    getNested(workspace, ['contract', 'start']),
  ])

  const contractEnd = pickDate([
    workspace.contractEnd,
    getNested(workspace, ['contract', 'end']),
  ])

  const majorAmount = pickNumber([
    getNested(workspace, ['billing', 'amountPaid']),
    getNested(workspace, ['subscription', 'amountPaid']),
    workspace.amountPaid,
  ])

  const minorAmount = pickNumber([
    getNested(workspace, ['billing', 'amountPaidMinor']),
    getNested(workspace, ['subscription', 'amountPaidMinor']),
    workspace.amountPaidMinor,
  ])

  const amountPaid =
    majorAmount != null ? majorAmount : minorAmount != null ? minorAmount / 100 : null

  const slug = pickString([
    workspace.slug,
    workspace.workspaceSlug,
    workspace.storeSlug,
    workspace.id,
  ])

  const company = pickString([
    workspace.company,
    workspace.displayName,
    workspace.name,
  ])

  return {
    id: workspace.id,
    slug,
    storeId: pickString([workspace.storeId]),
    company,
    name: pickString([workspace.name, workspace.storeId, workspace.id]),
    displayName: pickString([workspace.displayName, workspace.company, workspace.name]),
    email: pickString([workspace.email, workspace.contactEmail]),
    phone: pickString([workspace.phone]),
    status,
    plan,
    paymentStatus,
    contractStart,
    contractEnd,
    amountPaid,
    currency: pickString([
      workspace.currency,
      getNested(workspace, ['billing', 'currency']),
      getNested(workspace, ['subscription', 'currency']),
    ]),
    timezone: pickString([workspace.timezone]),
    addressLine1: pickString([workspace.addressLine1]),
    addressLine2: pickString([workspace.addressLine2]),
    city: pickString([workspace.city]),
    region: pickString([workspace.region]),
    postalCode: pickString([workspace.postalCode]),
    country: pickString([workspace.country]),
    createdAt: pickDate([
      workspace.contractStart,
      getNested(workspace, ['contract', 'start']),
      workspace.createdAt,
    ]),
    updatedAt: pickDate([
      workspace.contractEnd,
      getNested(workspace, ['contract', 'end']),
      workspace.updatedAt,
    ]),
  }
}

function snapshotToRecord(
  snapshot: DocumentSnapshot<DocumentData> | QueryDocumentSnapshot<DocumentData>,
): WorkspaceRecord {
  const data = snapshot.data() ?? {}
  return { id: snapshot.id, ...(data as Record<string, unknown>) }
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function getNested(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source
  for (const key of path) {
    if (!current || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function pickString(candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    const normalized = normalizeString(candidate)
    if (normalized) {
      return normalized
    }
  }
  return null
}

function pickNumber(candidates: Array<unknown>): number | null {
  for (const candidate of candidates) {
    const numeric = toNumber(candidate)
    if (numeric != null) {
      return numeric
    }
  }
  return null
}

function pickDate(candidates: Array<unknown>): Date | null {
  for (const candidate of candidates) {
    const date = toDate(candidate)
    if (date) {
      return date
    }
  }
  return null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }

  return null
}

function toDate(value: unknown): Date | null {
  if (!value) return null

  if (value instanceof Date) {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value)
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  if (typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      const result = (value as { toDate: () => Date }).toDate()
      return result instanceof Date && !Number.isNaN(result.getTime()) ? result : null
    } catch {
      return null
    }
  }

  return null
}

function isOfflineError(error: unknown): boolean {
  if (!(error instanceof FirebaseError)) {
    return false
  }

  if (error.code === 'unavailable') {
    return true
  }

  if (/offline/i.test(error.message)) {
    return true
  }

  return false
}
