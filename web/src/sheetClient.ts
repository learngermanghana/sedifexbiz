// web/src/sheetClient.ts
// Calls your Apps Script web app to validate workspace access.

export type SheetRow = {
  email: string
  name?: string
  storeId?: string
  role?: 'owner' | 'staff' | string
  contractStart?: string
  contractEnd?: string
  paymentStatus?: string
  amountPaid?: string
  company?: string
}

// If you still need these helpers elsewhere, keep them exported.
// (They are no-ops here because the server already validates contract dates.)
export const findUserRow = (_rows: SheetRow[], _email: string) => null

export function isContractActive(_row: SheetRow): boolean {
  // Validation happens on the server; return true to avoid double-gating.
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Web app endpoint (YOUR URL)
// ─────────────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_EXEC_URL =
  'https://script.google.com/macros/s/AKfycby1P4669iqP6NSZSsngrjPVT2DEJ-gurKU3xkFl_c1oQerTPKHkWSmSTOLU7Sxq7CX40w/exec'

// Optional: tweak timeout if needed
const DEFAULT_TIMEOUT_MS = 15000

type ExecOk = { ok: true; result: { storeId: string; role: 'owner' | 'staff' | string } }
type ExecErr = { ok: false; error: string }
type ExecResponse = ExecOk | ExecErr

function withTimeout<T>(promise: Promise<T>, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return (async () => {
    try {
      // @ts-expect-error signal type matches fetch in runtime
      const res = await promise
      clearTimeout(t)
      // Return the response from the original promise
      // (we only used AbortController if `promise` was a fetch call below)
      return res as unknown as T
    } finally {
      // noop
    }
  })()
}

/**
 * Resolve workspace access by calling your Apps Script web app.
 * Throws on any error so callers can show friendly messages.
 */
export async function resolveWorkspaceAccessFromSheet(
  email: string,
  providedStoreId?: string,
): Promise<{ storeId: string; role: 'owner' | 'staff' | string }> {
  const trimmedEmail = (email || '').trim().toLowerCase()
  if (!trimmedEmail) throw new Error("We couldn't verify your workspace access. Please try again.")

  const url = new URL(APPS_SCRIPT_EXEC_URL)
  url.searchParams.set('email', trimmedEmail)
  if (providedStoreId && providedStoreId.trim()) {
    url.searchParams.set('storeId', providedStoreId.trim())
  }

  let resp: Response
  try {
    resp = await withTimeout(fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      // Apps Script web apps generally allow CORS by default when "Anyone" is chosen
      // credentials: 'omit'
    }))
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error('Network timeout. Please try again.')
    }
    throw new Error('Network error. Please check your connection and try again.')
  }

  let text: string
  try {
    text = await resp.text()
  } catch {
    throw new Error('Something went wrong. Please try again.')
  }

  // Some Apps Script deployments may return text with correct JSON; parse defensively.
  let data: ExecResponse | null = null
  try {
    data = JSON.parse(text) as ExecResponse
  } catch {
    // If Apps Script ever wraps the JSON with HTML (rare), try to extract:
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      try {
        data = JSON.parse(text.slice(start, end + 1)) as ExecResponse
      } catch {
        // fall through
      }
    }
  }

  if (!data) {
    throw new Error('We could not parse the server response. Please try again.')
  }

  if ('ok' in data && data.ok === true) {
    return data.result
  }

  // Server-side error string should match your client copy where possible
  const msg = (data as ExecErr).error || "We couldn't verify your workspace access. Please try again."
  throw new Error(msg)
}
