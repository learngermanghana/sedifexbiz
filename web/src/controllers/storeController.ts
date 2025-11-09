// web/src/controllers/storeController.ts
import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase'
import { FirebaseError } from 'firebase/app'

export type StaffRole = 'owner' | 'staff'

export type ManageStaffAccountPayload = {
  storeId: string
  email: string
  role: StaffRole
  /** Only used when creating a new staff user (server decides). */
  password?: string
}

export type ManageStaffAccountResult = {
  ok: boolean
  storeId: string
  role: StaffRole
  email: string
  uid: string
  created: boolean
  claims?: unknown
}

function normalizePayload(input: ManageStaffAccountPayload): ManageStaffAccountPayload {
  return {
    storeId: input.storeId.trim(),
    email: input.email.trim().toLowerCase(),
    role: (input.role === 'owner' ? 'owner' : 'staff') as StaffRole,
    password: typeof input.password === 'string' && input.password.trim()
      ? input.password.trim()
      : undefined,
  }
}

function friendlyError(err: unknown): Error {
  if (err instanceof FirebaseError) {
    // Common callable errors → friendlier messages
    switch (err.code) {
      case 'functions/permission-denied':
        return new Error('You do not have permission to manage staff for this store.')
      case 'functions/invalid-argument':
        return new Error('The staff details you entered are invalid. Please check and try again.')
      case 'functions/not-found':
        return new Error('The target store was not found.')
      case 'functions/resource-exhausted':
        return new Error('Rate limit reached. Please wait a moment and try again.')
      default:
        // Strip the "Firebase:" prefix if present
        const msg = (err.message || '').replace(/^Firebase:\s*/i, '')
        return new Error(msg || 'Something went wrong while managing the staff account.')
    }
  }
  if (err instanceof Error) return err
  return new Error('Unexpected error while managing the staff account.')
}

export async function manageStaffAccount(payload: ManageStaffAccountPayload): Promise<ManageStaffAccountResult> {
  const clean = normalizePayload(payload)

  try {
    const callable = httpsCallable<ManageStaffAccountPayload, ManageStaffAccountResult>(
      functions,
      'manageStaffAccount',
    )
    const { data } = await callable(clean)

    // Provide a stable shape even if the server omits optional fields
    return {
      ok: data?.ok === true,
      storeId: data?.storeId ?? clean.storeId,
      role: (data?.role === 'owner' ? 'owner' : 'staff') as StaffRole,
      email: (data?.email ?? clean.email).toLowerCase(),
      uid: data?.uid ?? '',
      created: data?.created === true,
      claims: data?.claims,
    }
  } catch (err) {
    throw friendlyError(err)
  }
}
