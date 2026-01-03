// src/supabaseError.ts
// Minimal stub to satisfy existing SupabaseFunctionError imports.
// We match the constructor signature used in customClaims.ts.

export class SupabaseFunctionError extends Error {
  code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'SupabaseFunctionError'
    this.code = code

    // Optional: attach cause if provided
    if (options && 'cause' in options) {
      ;(this as any).cause = options.cause
    }
  }
}
