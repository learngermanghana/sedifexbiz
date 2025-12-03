import * as functions from 'firebase-functions/v1'
import { defineString } from 'firebase-functions/params'
import { defaultDb } from './firestore'

type StoreReportRow = [string, string, string, string]

const REPORTS_SHEET_ID = defineString('REPORTS_SHEET_ID')

function formatDateForSheet(date: Date) {
  return date.toISOString().split('T')[0]
}

async function getSheetsClient() {
  const { google } = await import('googleapis')
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  return google.sheets({ version: 'v4', auth: await auth.getClient() })
}

async function buildStoreRows(): Promise<StoreReportRow[]> {
  const today = formatDateForSheet(new Date())
  const snapshot = await defaultDb.collection('stores').get()

  return snapshot.docs.map(doc => {
    const data = doc.data() || {}
    const displayName = typeof data.displayName === 'string' ? data.displayName : ''
    const email = typeof data.email === 'string' ? data.email : ''

    return [today, doc.id, displayName, email]
  })
}

export const exportDailyStoreReports = functions.pubsub
  .schedule('0 7 * * *')
  .timeZone('Africa/Lagos')
  .onRun(async () => {
    const sheetId = REPORTS_SHEET_ID.value()

    if (!sheetId) {
      functions.logger.error('Missing REPORTS_SHEET_ID config; skipping export')
      return
    }

    const [sheets, rows] = await Promise.all([getSheetsClient(), buildStoreRows()])

    if (!rows.length) {
      functions.logger.info('No stores found to export')
      return
    }

    const header: StoreReportRow = ['Date', 'Store ID', 'Display Name', 'Email']
    const values: StoreReportRow[] = [header, ...rows]

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'DailyReports!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values,
      },
    })

    functions.logger.info(`Exported ${rows.length} stores to sheet ${sheetId}`)
  })
