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
const GID = '0'            // change if your data is on a different tab
const RANGE = 'A1:I'       // includes headers

export const GVIZ_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${GID}&range=${encodeURIComponent(RANGE)}&tqx=out:json`

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
const roleFix = (v?: string) => (v?.toLowerCase().includes('owner') ? 'owner' : v?.toLowerCase() === 'staff' ? 'staff' : v)

export async function fetchSheetRows(): Promise<SheetRow[]> {
  const res = await fetch(GVIZ_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`)
  const txt = await res.text()
  const json = txt.replace(/^[^{]+/, '').replace(/;?\s*$/, '')
  const payload = JSON.parse(json)
  const table = payload.table as { cols: { label: string }[]; rows: { c: { v: any }[] }[] }
  const headers = table.cols.map(c => norm(c.label || ''))
  const out: SheetRow[] = []
  for (const r of table.rows) {
    const obj: Record<string, any> = {}
    r.c.forEach((cell, i) => { obj[headers[i] || `col${i}`] = cell?.v ?? '' })
    const row: SheetRow = {
      email: String((obj['email'] ?? '')).toLowerCase(),
      name: obj['name'] || undefined,
      storeId: obj['storeid'] || obj['store'] || undefined,
      role: roleFix(obj['role']),
      contractStart: obj['contractstart'] || undefined,
      contractEnd: obj['contractend'] || undefined,
      paymentStatus: obj['paymentstatus'] || undefined,
      amountPaid: obj['amountpaid'] || undefined,
      company: obj['company'] || undefined,
    }
    if (row.email) out.push(row)
  }
  return out
}

export const findUserRow = (rows: SheetRow[], email: string) =>
  rows.find(r => r.email === email.trim().toLowerCase()) ?? null

export function isContractActive(row: SheetRow, now = new Date()): boolean {
  const s = row.contractStart ? Date.parse(row.contractStart) : NaN
  const e = row.contractEnd ? Date.parse(row.contractEnd) : NaN
  const afterStart = isNaN(s) ? true : now.getTime() >= s
  const beforeEnd = isNaN(e) ? true : now.getTime() <= e
  return afterStart && beforeEnd
}
