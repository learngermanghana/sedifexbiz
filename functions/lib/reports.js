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
const firestore_1 = require("./firestore");
const REPORTS_SHEET_ID = (0, params_1.defineString)('REPORTS_SHEET_ID');
function formatDateForSheet(date) {
    return date.toISOString().split('T')[0];
}
async function getSheetsClient() {
    const { google } = await Promise.resolve().then(() => __importStar(require('googleapis')));
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth: await auth.getClient() });
}
async function buildStoreRows() {
    const today = formatDateForSheet(new Date());
    const snapshot = await firestore_1.defaultDb.collection('stores').get();
    return snapshot.docs.map(doc => {
        const data = doc.data() || {};
        const displayName = typeof data.displayName === 'string' ? data.displayName : '';
        const email = typeof data.email === 'string' ? data.email : '';
        return [today, doc.id, displayName, email];
    });
}
exports.exportDailyStoreReports = functions.pubsub
    .schedule('0 7 * * *')
    .timeZone('Africa/Lagos')
    .onRun(async () => {
    const sheetId = REPORTS_SHEET_ID.value();
    if (!sheetId) {
        functions.logger.error('Missing REPORTS_SHEET_ID config; skipping export');
        return;
    }
    const [sheets, rows] = await Promise.all([getSheetsClient(), buildStoreRows()]);
    if (!rows.length) {
        functions.logger.info('No stores found to export');
        return;
    }
    const header = ['Date', 'Store ID', 'Display Name', 'Email'];
    const values = [header, ...rows];
    await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'DailyReports!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values,
        },
    });
    functions.logger.info(`Exported ${rows.length} stores to sheet ${sheetId}`);
});
