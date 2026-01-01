"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportDailyStoreReports = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
const firestore_2 = require("./firestore");
/**
 * Params (Cloud Functions params):
 * - REPORTS_SHEET_ID: spreadsheet id
 * - GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON: JSON string with { client_email, private_key }
 * - REPORTS_SHEET_TAB: optional tab name (default "DailyReports")
 */
const REPORTS_SHEET_ID = (0, params_1.defineString)('REPORTS_SHEET_ID');
const GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON = (0, params_1.defineString)('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON');
const REPORTS_SHEET_TAB = (0, params_1.defineString)('REPORTS_SHEET_TAB');
const HEADER = [
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
];
function ymd(date) {
    return date.toISOString().slice(0, 10);
}
// Ghana is UTC, so midnight boundaries are fine with UTC dates.
function dayRange(date) {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return {
        start: firestore_1.Timestamp.fromDate(start),
        end: firestore_1.Timestamp.fromDate(end),
    };
}
function num(v) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : 0;
}
function str(v) {
    return typeof v === 'string' ? v : '';
}
function pickStoreName(data) {
    return (str(data?.displayName) ||
        str(data?.name) ||
        str(data?.company) ||
        str(data?.businessName) ||
        '');
}
function pickStoreEmail(data) {
    return (str(data?.ownerEmail) ||
        str(data?.email) ||
        str(data?.managerEmail) ||
        '');
}
/**
 * IMPORTANT: lazy import googleapis to avoid deploy discovery timeouts.
 * Also uses GoogleAuth because your repo's googleapis types don’t expose google.auth.JWT.
 */
async function getSheetsClient() {
    const { google } = await Promise.resolve().then(() => __importStar(require('googleapis')));
    const raw = GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON.value();
    if (!raw)
        throw new Error('Missing GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
    const clientEmail = parsed?.client_email;
    const privateKey = parsed?.private_key;
    if (typeof clientEmail !== 'string' || typeof privateKey !== 'string') {
        throw new Error('Service account JSON must include client_email and private_key');
    }
    const fixedKey = privateKey.replace(/\\n/g, '\n');
    const auth = new google.auth.GoogleAuth({
        credentials: { client_email: clientEmail, private_key: fixedKey },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}
/**
 * Helpers that try a couple common collection layouts.
 * If your app uses different names/paths, tell me your actual paths and I’ll adapt this.
 */
async function salesMetrics(storeId, start, end) {
    // 1) Preferred: stores/{storeId}/sales
    const candidates = [
        firestore_2.defaultDb.collection('stores').doc(storeId).collection('sales'),
        // 2) fallback: top-level sales with storeId
        firestore_2.defaultDb.collection('sales').where('storeId', '==', storeId),
    ];
    for (const base of candidates) {
        try {
            const q = base
                .where('createdAt', '>=', start)
                .where('createdAt', '<', end)
                .orderBy('createdAt', 'desc');
            const snap = await q.get();
            if (snap.empty)
                continue;
            let total = 0;
            snap.forEach((doc) => {
                const d = doc.data() || {};
                // try common fields
                total += num(d.total ?? d.salesTotal ?? d.amount ?? d.grandTotal ?? d.subtotal);
            });
            const count = snap.size;
            return { salesCount: count, salesTotal: total, avgSale: count > 0 ? total / count : 0 };
        }
        catch (e) {
            // keep trying other layouts
            functions.logger.warn(`[reports] sales query failed for store ${storeId}`, e);
        }
    }
    return { salesCount: 0, salesTotal: 0, avgSale: 0 };
}
async function newCustomersCount(storeId, start, end) {
    const candidates = [
        firestore_2.defaultDb.collection('stores').doc(storeId).collection('customers'),
        firestore_2.defaultDb.collection('customers').where('storeId', '==', storeId),
    ];
    for (const base of candidates) {
        try {
            const q = base.where('createdAt', '>=', start).where('createdAt', '<', end).orderBy('createdAt', 'desc');
            const snap = await q.get();
            if (!snap.empty)
                return snap.size;
        }
        catch (e) {
            functions.logger.warn(`[reports] customers query failed for store ${storeId}`, e);
        }
    }
    return 0;
}
async function lowStockCount(storeId) {
    // Common layout: stores/{storeId}/products
    try {
        const snap = await firestore_2.defaultDb.collection('stores').doc(storeId).collection('products').get();
        if (snap.empty)
            return 0;
        let count = 0;
        snap.forEach((doc) => {
            const p = doc.data() || {};
            const stock = num(p.stockCount ?? p.qty ?? p.quantity ?? p.onHand);
            const threshold = typeof p.lowStockThreshold === 'number'
                ? p.lowStockThreshold
                : typeof p.reorderLevel === 'number'
                    ? p.reorderLevel
                    : 0;
            // If threshold is 0, we only treat <=0 as low-stock.
            // If threshold >0, use that.
            const isLow = threshold > 0 ? stock <= threshold : stock <= 0;
            if (isLow)
                count += 1;
        });
        return count;
    }
    catch (e) {
        functions.logger.warn(`[reports] lowStockCount failed for store ${storeId}`, e);
        return 0;
    }
}
async function inventoryAdjustmentsCount(storeId, start, end) {
    // Try a few likely collections; first one with data wins
    const paths = [
        firestore_2.defaultDb.collection('stores').doc(storeId).collection('inventoryAdjustments'),
        firestore_2.defaultDb.collection('stores').doc(storeId).collection('stockAdjustments'),
        firestore_2.defaultDb.collection('stores').doc(storeId).collection('inventoryLogs'),
        firestore_2.defaultDb.collection('stores').doc(storeId).collection('stockMovements'),
        firestore_2.defaultDb.collection('inventoryAdjustments').where('storeId', '==', storeId),
        firestore_2.defaultDb.collection('stockAdjustments').where('storeId', '==', storeId),
    ];
    for (const base of paths) {
        try {
            const q = base.where('createdAt', '>=', start).where('createdAt', '<', end).orderBy('createdAt', 'desc');
            const snap = await q.get();
            if (!snap.empty)
                return snap.size;
        }
        catch (e) {
            // keep trying other names
            functions.logger.warn(`[reports] inventory adjustments query failed for store ${storeId}`, e);
        }
    }
    return 0;
}
async function ensureHeader(sheets, spreadsheetId, tab) {
    const range = `${tab}!A1:J1`;
    const read = await sheets.spreadsheets.values.get({ spreadsheetId, range }).catch(() => null);
    const firstRow = (read?.data?.values?.[0] ?? []);
    const headerMatches = HEADER.every((h, i) => String(firstRow[i] ?? '') === String(h));
    if (!headerMatches) {
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'RAW',
            requestBody: { values: [HEADER] },
        });
    }
}
async function appendRows(sheets, spreadsheetId, tab, rows) {
    const range = `${tab}!A:J`;
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows },
    });
}
exports.exportDailyStoreReports = functions.pubsub
    .schedule('every day 06:00')
    .timeZone('Africa/Accra')
    .onRun(async () => {
    const spreadsheetId = REPORTS_SHEET_ID.value();
    if (!spreadsheetId) {
        functions.logger.error('[reports] Missing REPORTS_SHEET_ID; skipping.');
        return null;
    }
    const tab = REPORTS_SHEET_TAB.value() || 'DailyReports';
    const today = new Date();
    const dateStr = ymd(today);
    const { start, end } = dayRange(today);
    const storesSnap = await firestore_2.defaultDb.collection('stores').get();
    if (storesSnap.empty) {
        functions.logger.info('[reports] No stores found.');
        return null;
    }
    const sheets = await getSheetsClient();
    await ensureHeader(sheets, spreadsheetId, tab);
    const rows = [];
    for (const doc of storesSnap.docs) {
        const storeId = doc.id;
        const data = doc.data() || {};
        const storeName = pickStoreName(data);
        const email = pickStoreEmail(data);
        // Skip totally empty records (prevents blank rows like your qvsCy... row)
        if (!storeName && !email)
            continue;
        const sales = await salesMetrics(storeId, start, end);
        const newCustomers = await newCustomersCount(storeId, start, end);
        const lowStock = await lowStockCount(storeId);
        const adjustments = await inventoryAdjustmentsCount(storeId, start, end);
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
        ]);
    }
    await appendRows(sheets, spreadsheetId, tab, rows);
    functions.logger.info(`[reports] Appended ${rows.length} rows for ${dateStr} into ${tab}.`);
    return null;
});
