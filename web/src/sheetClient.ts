// sheetClient.ts

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
const GID = '0'          // change if your data is on a different tab
const RANGE = 'A1:I'     // includes headers

export const GVIZ_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${GID}&range=${encodeURIComponent(RANGE)}&tqx=out:json`

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
  email: 'email', e_mail: 'email', useremail: 'email', mail: 'email',

  // name
  name: 'name', fullname: 'name', displayname: 'name',

  // storeId
  storeid: 'storeId', store: 'storeId', workspaceid: 'storeId', workspace: 'storeId', shopid: 'storeId', shop: 'storeId',

  // role
  role: 'role', userrole: 'role', accessrole: 'role',

  // dates (as strings)
  contractstart: 'contractStart', startdate: 'contractStart', start: 'contractStart', begin: 'contractStart',
  contractend: 'contractEnd', enddate: 'contractEnd', end: 'contractEnd', expiry: 'contractEnd', expires: 'contractEnd',

  // payment
  paymentstatus: 'paymentStatus', payment: 'paymentStatus', statuspayment: 'paymentStatus',
  amountpaid: 'amountPaid', amount: 'amountPaid', paid: 'amountPaid',

  // company
  company: 'company', companyname: 'company',

  // explicit ignores (add if needed): '__ignore__': '__ignore__'
}

// prefer formatted value (f) from GViz, then raw (v)
const cellVal = (c?: { v?: any; f?: any } | null) =>
  (c && (c.f ?? c.v)) ?? ''

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
      amountPaid: (rowObj.amountPaid != null ? String(rowObj.amountPaid) : undefined),
      company: defined(rowObj.company),
    }

    out.push(row)
  }

  return out
}

const defined = <T,>(v: T | null | undefined): T | undefined =>
  v == null || (typeof v === 'string' && v.trim() === '') ? undefined : v

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
export const findUserRow = (rows: SheetRow[], email: string) =>
  rows.find(r => r.email.trim().toLowerCase() === email.trim().toLowerCase()) ?? null

export function isContractActive(row: SheetRow, now = new Date()): boolean {
  const s = row.contractStart ? Date.parse(row.contractStart) : NaN
  const e = row.contractEnd ? Date.parse(row.contractEnd) : NaN
  const t = now.getTime()
  const afterStart = isNaN(s) ? true : t >= s
  const beforeEnd = isNaN(e) ? true : t <= e
  return afterStart && beforeEnd
}
