import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'

type StoreClaims = {
  stores: string[]
  activeStoreId: string | null
  roleByStore: Record<string, string>
}

type InitializeStoreResponse = {
  ok: boolean
  claims: StoreClaims
}

type ManageStaffRequest = {
  storeId: string
  email: string
  role: string
  password?: string | null
}

type ManageStaffResponse = {
  ok: boolean
  storeId: string
  role: string
  email: string
  uid: string
  created: boolean
  claims: StoreClaims
}

const initializeStoreCallable = httpsCallable<unknown, InitializeStoreResponse>(functions, 'initializeStore')
const manageStaffCallable = httpsCallable<ManageStaffRequest, ManageStaffResponse>(functions, 'manageStaffAccount')

export async function initializeStoreAccess(): Promise<InitializeStoreResponse> {
  const { data } = await initializeStoreCallable({})
  return data
}

export async function manageStaffAccount(payload: ManageStaffRequest): Promise<ManageStaffResponse> {
  const normalizedPayload: ManageStaffRequest = {
    storeId: payload.storeId.trim(),
    email: payload.email.trim(),
    role: payload.role.trim(),
    ...(payload.password ? { password: payload.password } : {}),
  }

  const { data } = await manageStaffCallable(normalizedPayload)
  return data
}
