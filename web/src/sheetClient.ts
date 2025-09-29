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

const SHEET_ID = '1_oqRHePaZnpULD9zRUtxBIHQUaHccGAxSP3SPCJ0o7g'
const GID = '0' // change if your data is on a different tab
const RANGE = 'A1:I' // includes headers

export const GVIZ_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${GID}&range=${encodeURIComponent(
    RANGE,
  )}&tqx=out:json`

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')

const roleFix = (v?: string) => {
  if (!v) return v
  const s = v.toLowerCase()
  if (s.includes('owner')) return 'owner'
  if (s === 'staff') return 'staff'
  return v
}

// Map normalized header → canonical key we use in SheetRow
const HEADER_MAP: Record<string, keyof SheetRow | '__ignore__'> = {
  // email
  email: 'email',
  e_mail: 'email',
  useremail: 'email',
  mail: 'email',

  // name
  name: 'name',
  fullname: 'name',
  displayname: 'name',

  // storeId
  storeid: 'storeId',
  store: 'storeId',
  workspaceid: 'storeId',
  workspace: 'storeId',
  shopid: 'storeId',
  shop: 'storeId',

  // role
  role: 'role',
  userrole: 'role',
  accessrole: 'role',

  // dates (as strings)
  contractstart: 'contractStart',
  startdate: 'contractStart',
  start: 'contractStart',
  begin: 'contractStart',
  contractend: 'contractEnd',
  enddate: 'contractEnd',
  end: 'contractEnd',
  expiry: 'contractEnd',
  expires: 'contractEnd',

  // payment
  paymentstatus: 'paymentStatus',
  payment: 'paymentStatus',
  statuspayment: 'paymentStatus',
  amountpaid: 'amountPaid',
  amount: 'amountPaid',
  paid: 'amountPaid',

  // company
  company: 'company',
  companyname: 'company',

  // explicit ignores (add if needed): '__ignore__': '__ignore__'
}

// prefer formatted value (f) from GViz, then raw (v)
const cellVal = (c?: { v?: any; f?: any } | null) => (c && (c.f ?? c.v)) ?? ''

const defined = <T,>(v: T | null | undefined): T | undefined =>
  v == null || (typeof v === 'string' && v.trim() === '') ? undefined : v

// ─────────────────────────────────────────────────────────────────────────────
// Fetch + Parse
// ─────────────────────────────────────────────────────────────────────────────
export async function fetchSheetRows(): Promise<SheetRow[]> {
  const res = await fetch(GVIZ_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`)

  const txt = await res.text()

  // GViz wraps a JS object; we slice out the outermost {...}
  const start = txt.indexOf('{')
  const end = txt.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start)
    throw new Error('Sheet response did not contain valid JSON object')

  const json = txt.slice(start, end + 1).trim()
  if (!json.startsWith('{') || !json.endsWith('}'))
    throw new Error('Sheet response JSON is malformed')

  // NOTE: If your sheet has true DATE-typed cells, GViz sometimes embeds JS Date(…)
  // in "v". We avoid that by reading formatted "f" when present (string), above.
  const payload = JSON.parse(json)

  type GVizTable = {
    cols: { label: string }[]
    rows: { c: { v?: any; f?: any }[] | null }[]
  }

  const table: GVizTable = payload.table
  const headersNorm = (table.cols || []).map(c => norm(c.label || ''))

  const out: SheetRow[] = []

  for (const r of table.rows || []) {
    const cells = r?.c || []
    // Build a temp object using normalized header keys
    const tmp: Record<string, any> = {}
    headersNorm.forEach((h, i) => {
      tmp[h || `col${i}`] = cellVal(cells[i])
    })

    // Map known headers → SheetRow fields
    const rowObj: Partial<SheetRow> = {}
    for (const [kNorm, v] of Object.entries(tmp)) {
      const mapped = HEADER_MAP[kNorm]
      if (!mapped || mapped === '__ignore__') continue
      // Assign; keep raw stringy values (dates stay as strings)
      ;(rowObj as any)[mapped] = typeof v === 'string' ? v.trim() : v
    }

    // Normalize specific fields
    const email = String(rowObj.email ?? '').trim().toLowerCase()
    if (!email) continue

    const row: SheetRow = {
      email,
      name: defined(rowObj.name),
      storeId: defined(rowObj.storeId),
      role: roleFix(defined(rowObj.role)),
      contractStart: defined(rowObj.contractStart),
      contractEnd: defined(rowObj.contractEnd),
      paymentStatus: defined(rowObj.paymentStatus),
      amountPaid:
        rowObj.amountPaid != null ? String(rowObj.amountPaid) : undefined,
      company: defined(rowObj.company),
    }

    out.push(row)
  }

  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
export const findUserRow = (rows: SheetRow[], email: string) =>
  rows.find(r => r.email.trim().toLowerCase() === email.trim().toLowerCase()) ??
  null

export function isContractActive(row: SheetRow, now = new Date()): boolean {
  const s = row.contractStart ? Date.parse(row.contractStart) : NaN
  const e = row.contractEnd ? Date.parse(row.contractEnd) : NaN
  const t = now.getTime()
  const afterStart = isNaN(s) ? true : t >= s
  const beforeEnd = isNaN(e) ? true : t <= e
  return afterStart && beforeEnd
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
