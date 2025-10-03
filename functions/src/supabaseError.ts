export type SupabaseErrorStatus =
  | 'bad-request'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'failed-precondition'
  | 'internal'

export type SupabaseErrorDetails = {
  cause?: unknown
  hint?: string
}

export class SupabaseFunctionError extends Error {
  readonly status: SupabaseErrorStatus
  readonly details?: SupabaseErrorDetails

  constructor(status: SupabaseErrorStatus, message: string, details?: SupabaseErrorDetails) {
    super(message)
    this.name = 'SupabaseFunctionError'
    this.status = status
    this.details = details
  }
}
