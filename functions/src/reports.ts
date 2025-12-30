import * as functions from 'firebase-functions/v1'
import { defineString } from 'firebase-functions/params'
import { Timestamp } from 'firebase-admin/firestore'
import { defaultDb } from './firestore'

/**
 * Params (Cloud Functions params):
 * - REPORTS_SHEET_ID: spreadsheet id
 * - GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON: JSON string with { client_email, private_key }
 * - REPORTS_SHEET_TAB: optional tab name (default "DailyReports")
 */
const REPORTS_SHEET_ID = defineString('REPORTS_SHEET_ID')
const GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = defineString('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON')
const REPORTS_SHEET_TAB = defineString('REPORTS_SHEET_TAB')

type ReportRow = [
  string, // Date
  string, // StoreId
  string, // StoreName
  string, // ManagerEmail
  number, // SalesCount
  number, // SalesTotal
  number, // AvgSale
  number, // NewCustomers
  number, // LowStockCount
  number // InventoryAdjustments
]

const HEADER: (string | number)[] = [
  'Date',
  'StoreId',
  'StoreName',
  'ManagerEmail',
  'SalesCount',
  'SalesTotal',
  'AvgSale',
  'NewCustomers',
  'LowStockCount',
  'InventoryAdjustments',
]

function ymd(date: Date) {
  return date.toISOString().slice(0, 10)
}

// Ghana is UTC, so midnight boundaries are fine with UTC dates.
function dayRange(date: Date) {
  const start = new Date(date)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return {
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
  }
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function pickStoreName(data: any): string {
  return (
    str(data?.displayName) ||
    str(data?.name) ||
    str(data?.company) ||
    str(data?.businessName) ||
    ''
  )
}

function pickStoreEmail(data: any): string {
  return (
    str(data?.ownerEmail) ||
    str(data?.email) ||
    str(data?.managerEmail) ||
    ''
  )
}

/**
 * IMPORTANT: lazy import googleapis to avoid deploy discovery timeouts.
 * Also uses GoogleAuth because your repo's googleapis types don’t expose google.auth.JWT.
 */
async function getSheetsClient() {
  const { google } = await import('googleapis')

  const raw = GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON.value()
  if (!raw) throw new Error('Missing GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON')

  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not valid JSON')
  }

  const clientEmail = parsed?.client_email
  const privateKey = parsed?.private_key
  if (typeof clientEmail !== 'string' || typeof privateKey !== 'string') {
    throw new Error('Service account JSON must include client_email and private_key')
  }

  const fixedKey = privateKey.replace(/\\n/g, '\n')

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: clientEmail, private_key: fixedKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  const client = await auth.getClient()
  return google.sheets({ version: 'v4', auth: client })
}

/**
 * Helpers that try a couple common collection layouts.
 * If your app uses different names/paths, tell me your actual paths and I’ll adapt this.
 */

async function salesMetrics(storeId: string, start: Timestamp, end: Timestamp) {
  // 1) Preferred: stores/{storeId}/sales
  const candidates = [
    defaultDb.collection('stores').doc(storeId).collection('sales'),
    // 2) fallback: top-level sales with storeId
    defaultDb.collection('sales').where('storeId', '==', storeId),
  ]

  for (const base of candidates) {
    try {
      const q = base
        .where('createdAt', '>=', start)
        .where('createdAt', '<', end)
        .orderBy('createdAt', 'desc')

      const snap = await q.get()
      if (snap.empty) continue

      let total = 0
      snap.forEach((doc) => {
        const d: any = doc.data() || {}
        // try common fields
        total += num(d.total ?? d.salesTotal ?? d.amount ?? d.grandTotal ?? d.subtotal)
      })

      const count = snap.size
      return { salesCount: count, salesTotal: total, avgSale: count > 0 ? total / count : 0 }
    } catch (e) {
      // keep trying other layouts
      functions.logger.warn(`[reports] sales query failed for store ${storeId}`, e as any)
    }
  }

  return { salesCount: 0, salesTotal: 0, avgSale: 0 }
}

async function newCustomersCount(storeId: string, start: Timestamp, end: Timestamp) {
  const candidates = [
    defaultDb.collection('stores').doc(storeId).collection('customers'),
    defaultDb.collection('customers').where('storeId', '==', storeId),
  ]

  for (const base of candidates) {
    try {
      const q = base.where('createdAt', '>=', start).where('createdAt', '<', end).orderBy('createdAt', 'desc')
      const snap = await q.get()
      if (!snap.empty) return snap.size
    } catch (e) {
      functions.logger.warn(`[reports] customers query failed for store ${storeId}`, e as any)
    }
  }
  return 0
}

async function lowStockCount(storeId: string) {
  // Common layout: stores/{storeId}/products
  try {
    const snap = await defaultDb.collection('stores').doc(storeId).collection('products').get()
    if (snap.empty) return 0

    let count = 0
    snap.forEach((doc) => {
      const p: any = doc.data() || {}
      const stock = num(p.stockCount ?? p.qty ?? p.quantity ?? p.onHand)
      const threshold =
        typeof p.lowStockThreshold === 'number'
          ? p.lowStockThreshold
          : typeof p.reorderLevel === 'number'
            ? p.reorderLevel
            : 0

      // If threshold is 0, we only treat <=0 as low-stock.
      // If threshold >0, use that.
      const isLow = threshold > 0 ? stock <= threshold : stock <= 0
      if (isLow) count += 1
    })

    return count
  } catch (e) {
    functions.logger.warn(`[reports] lowStockCount failed for store ${storeId}`, e as any)
    return 0
  }
}

async function inventoryAdjustmentsCount(storeId: string, start: Timestamp, end: Timestamp) {
  // Try a few likely collections; first one with data wins
  const paths = [
    defaultDb.collection('stores').doc(storeId).collection('inventoryAdjustments'),
    defaultDb.collection('stores').doc(storeId).collection('stockAdjustments'),
    defaultDb.collection('stores').doc(storeId).collection('inventoryLogs'),
    defaultDb.collection('stores').doc(storeId).collection('stockMovements'),
    defaultDb.collection('inventoryAdjustments').where('storeId', '==', storeId),
    defaultDb.collection('stockAdjustments').where('storeId', '==', storeId),
  ]

  for (const base of paths) {
    try {
      const q = base.where('createdAt', '>=', start).where('createdAt', '<', end).orderBy('createdAt', 'desc')
      const snap = await q.get()
      if (!snap.empty) return snap.size
    } catch (e) {
      // keep trying other names
      functions.logger.warn(`[reports] inventory adjustments query failed for store ${storeId}`, e as any)
    }
  }
  return 0
}

async function ensureHeader(sheets: any, spreadsheetId: string, tab: string) {
  const range = `${tab}!A1:J1`
  const read = await sheets.spreadsheets.values.get({ spreadsheetId, range }).catch(() => null)
  const firstRow = (read?.data?.values?.[0] ?? []) as any[]
  const headerMatches = HEADER.every((h, i) => String(firstRow[i] ?? '') === String(h))

  if (!headerMatches) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER] },
    })
  }
}

async function appendRows(sheets: any, spreadsheetId: string, tab: string, rows: any[][]) {
  const range = `${tab}!A:J`
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  })
}

export const exportDailyStoreReports = functions.pubsub
  .schedule('every day 06:00')
  .timeZone('Africa/Accra')
  .onRun(async () => {
    const spreadsheetId = REPORTS_SHEET_ID.value()
    if (!spreadsheetId) {
      functions.logger.error('[reports] Missing REPORTS_SHEET_ID; skipping.')
      return null
    }

    const tab = REPORTS_SHEET_TAB.value() || 'DailyReports'
    const today = new Date()
    const dateStr = ymd(today)
    const { start, end } = dayRange(today)

    const storesSnap = await defaultDb.collection('stores').get()
    if (storesSnap.empty) {
      functions.logger.info('[reports] No stores found.')
      return null
    }

    const sheets = await getSheetsClient()
    await ensureHeader(sheets, spreadsheetId, tab)

    const rows: ReportRow[] = []

    for (const doc of storesSnap.docs) {
      const storeId = doc.id
      const data: any = doc.data() || {}

      const storeName = pickStoreName(data)
      const email = pickStoreEmail(data)

      // Skip totally empty records (prevents blank rows like your qvsCy... row)
      if (!storeName && !email) continue

      const sales = await salesMetrics(storeId, start, end)
      const newCustomers = await newCustomersCount(storeId, start, end)
      const lowStock = await lowStockCount(storeId)
      const adjustments = await inventoryAdjustmentsCount(storeId, start, end)

      rows.push([
        dateStr,
        storeId,
        storeName,
        email,
        sales.salesCount,
        Number(sales.salesTotal.toFixed(2)),
        sales.salesCount > 0 ? Number((sales.salesTotal / sales.salesCount).toFixed(2)) : 0,
        newCustomers,
        lowStock,
        adjustments,
      ])
    }

    await appendRows(sheets, spreadsheetId, tab, rows as any[][])

    functions.logger.info(`[reports] Appended ${rows.length} rows for ${dateStr} into ${tab}.`)
    return null
  })
