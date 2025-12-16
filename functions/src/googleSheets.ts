import * as functions from 'firebase-functions/v1'
import { defineString } from 'firebase-functions/params'
import type { sheets_v4 } from 'googleapis'

const DEFAULT_SPREADSHEET_ID = '1_oqRHePaZnpULD9zRUtxBIHQUaHccGAxSP3SPCJ0o7g'
const DEFAULT_RANGE = 'Clients!A:ZZ'
const EMAIL_HEADER_MATCHERS = new Set([
  'email',
  'user_email',
  'login_email',
  'primary_email',
  'member_email',
])

const SHEETS_SERVICE_ACCOUNT = defineString('SHEETS_SERVICE_ACCOUNT', { default: '' })
const SHEETS_SPREADSHEET_ID = defineString('SHEETS_SPREADSHEET_ID', { default: '' })
const SHEETS_RANGE = defineString('SHEETS_RANGE', { default: '' })

type SheetsClient = sheets_v4.Sheets

type SheetConfig = {
  serviceAccount: string | null
  spreadsheetId: string | null
  range: string | null
}

let sheetsClientPromise: Promise<SheetsClient> | null = null

async function loadSheetsClientFactory() {
  // googleapis is large; load it lazily to keep function module import fast.
  const { google } = await import('googleapis')
  return google
}

export function normalizeHeader(header: unknown) {
  if (typeof header !== 'string') return ''

  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function decodeServiceAccount(raw: unknown) {
  if (!raw) {
    throw new Error('Missing Sheets service account credentials')
  }

  let parsed: { client_email?: unknown; private_key?: unknown } | null = null

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) {
      throw new Error('Sheets service account credentials are empty')
    }

    try {
      parsed = JSON.parse(trimmed)
    } catch (error) {
      throw new Error('Sheets service account credentials must be valid JSON')
    }
  } else if (typeof raw === 'object') {
    parsed = raw as { client_email?: unknown; private_key?: unknown }
  }

  if (!parsed || typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error('Sheets service account credentials are incomplete')
  }

  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
  }
}

function readConfig(): SheetConfig {
  const paramServiceAccount = SHEETS_SERVICE_ACCOUNT.value()
  const serviceAccount = paramServiceAccount || process.env.SHEETS_SERVICE_ACCOUNT || null
  const spreadsheetIdParam = SHEETS_SPREADSHEET_ID.value()
  const spreadsheetId = spreadsheetIdParam || null
  const rangeParam = SHEETS_RANGE.value()
  const range = rangeParam || null

  return { serviceAccount, spreadsheetId, range }
}

async function getSheetsClient() {
  if (!sheetsClientPromise) {
    const config = readConfig()
    const credentials = decodeServiceAccount(config.serviceAccount)

    const google = await loadSheetsClientFactory()

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })

    const authClientPromise = auth.getClient()
    sheetsClientPromise = (async () => {
      const authClient = await authClientPromise
      return google.sheets({ version: 'v4', auth: authClient })
    })()
  }

  return sheetsClientPromise
}

function buildRecord(headers: string[], row: unknown[]) {
  const record: Record<string, string> = {}

  headers.forEach((header, index) => {
    if (!header) return

    const value = row[index]

    if (typeof value === 'string') {
      record[header] = value.trim()
    } else if (value === undefined || value === null) {
      record[header] = ''
    } else {
      record[header] = String(value).trim()
    }
  })

  return record
}

function resolveRange(config: SheetConfig) {
  const configuredRange = typeof config.range === 'string' ? config.range.trim() : ''
  if (configuredRange) return configuredRange
  return DEFAULT_RANGE
}

function resolveSpreadsheetId(config: SheetConfig, sheetId: unknown) {
  const explicit = typeof sheetId === 'string' ? sheetId.trim() : ''
  if (explicit) return explicit

  const configured = typeof config.spreadsheetId === 'string' ? config.spreadsheetId.trim() : ''
  if (configured) return configured

  return DEFAULT_SPREADSHEET_ID
}

function isMatchingEmail(value: unknown, target: string) {
  if (typeof value !== 'string') return false
  return value.trim().toLowerCase() === target
}

function isEmailHeader(header: string) {
  if (!header) return false
  if (EMAIL_HEADER_MATCHERS.has(header)) return true

  return header.endsWith('_email') || header.includes('email')
}

export async function fetchClientRowByEmail(sheetId: unknown, email: unknown) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!normalizedEmail) {
    return null
  }

  const config = readConfig()
  const range = resolveRange(config)
  const spreadsheetId = resolveSpreadsheetId(config, sheetId)
  const sheets = await getSheetsClient()
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension: 'ROWS',
  })

  const rows = (response.data.values ?? []) as unknown[]
  if (!rows.length) return null

  const headerRow = (rows[0] ?? []) as unknown[]
  const headers = headerRow.map(cell =>
    typeof cell === 'string' ? cell : cell === undefined || cell === null ? '' : String(cell),
  )
  const normalizedHeaders = headers.map(normalizeHeader)

  const emailColumns = normalizedHeaders
    .map((header, index) => (isEmailHeader(header) ? index : -1))
    .filter(index => index >= 0)

  if (!emailColumns.length) {
    throw new Error('No email column found in Google Sheet')
  }

  for (let i = 1; i < rows.length; i += 1) {
    const rowValues = rows[i]
    if (!Array.isArray(rowValues)) continue

    const hasMatch = emailColumns.some(columnIndex => isMatchingEmail(rowValues[columnIndex], normalizedEmail))
    if (!hasMatch) continue

    const record = buildRecord(normalizedHeaders, rowValues)

    return {
      spreadsheetId,
      headers,
      normalizedHeaders,
      values: rowValues.map(value => (typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value))),
      record,
    }
  }

  return null
}

export function getDefaultSpreadsheetId() {
  const config = readConfig()
  return resolveSpreadsheetId(config, null)
}

export type FetchClientRowResult = Awaited<ReturnType<typeof fetchClientRowByEmail>>
