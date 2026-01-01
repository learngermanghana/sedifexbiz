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
exports.logReceiptShareAttempt = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("../firestore");
const VALID_ROLES = new Set(['owner', 'staff']);
const RECEIPT_CHANNELS = new Set(['email', 'sms', 'whatsapp']);
const RECEIPT_STATUSES = new Set(['attempt', 'failed', 'sent']);
function getRoleFromToken(token) {
    const role = typeof token?.role === 'string' ? token.role : null;
    return role && VALID_ROLES.has(role) ? role : null;
}
function assertStaffAccess(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }
    const role = getRoleFromToken(context.auth.token);
    if (!role) {
        throw new functions.https.HttpsError('permission-denied', 'Staff access required');
    }
}
exports.logReceiptShareAttempt = functions.https.onCall(async (data, context) => {
    assertStaffAccess(context);
    const storeId = typeof data?.storeId === 'string' ? data.storeId.trim() : '';
    const saleId = typeof data?.saleId === 'string' ? data.saleId.trim() : '';
    const channel = typeof data?.channel === 'string' ? data.channel.trim() : '';
    const statusRaw = typeof data?.status === 'string' ? data.status.trim() : '';
    const status = statusRaw || 'attempt';
    if (!storeId || !saleId) {
        throw new functions.https.HttpsError('invalid-argument', 'storeId and saleId are required');
    }
    if (!RECEIPT_CHANNELS.has(channel)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid channel');
    }
    if (!RECEIPT_STATUSES.has(status)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid status');
    }
    const contactRaw = data?.contact;
    const contact = contactRaw === null || contactRaw === undefined
        ? null
        : typeof contactRaw === 'string'
            ? contactRaw.trim() || null
            : (() => {
                throw new functions.https.HttpsError('invalid-argument', 'contact must be a string when provided');
            })();
    const customerIdRaw = data?.customerId;
    const customerId = customerIdRaw === null || customerIdRaw === undefined
        ? null
        : typeof customerIdRaw === 'string'
            ? customerIdRaw.trim() || null
            : (() => {
                throw new functions.https.HttpsError('invalid-argument', 'customerId must be a string when provided');
            })();
    const customerNameRaw = data?.customerName;
    const customerName = customerNameRaw === null || customerNameRaw === undefined
        ? null
        : typeof customerNameRaw === 'string'
            ? customerNameRaw.trim() || null
            : (() => {
                throw new functions.https.HttpsError('invalid-argument', 'customerName must be a string when provided');
            })();
    const errorMessageRaw = data?.errorMessage;
    const errorMessage = errorMessageRaw === null || errorMessageRaw === undefined
        ? null
        : typeof errorMessageRaw === 'string'
            ? errorMessageRaw.trim() || null
            : (() => {
                throw new functions.https.HttpsError('invalid-argument', 'errorMessage must be a string when provided');
            })();
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const payload = {
        storeId,
        saleId,
        channel,
        status,
        contact,
        customerId,
        customerName,
        errorMessage,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    const ref = await firestore_1.defaultDb.collection('receiptShareLogs').add(payload);
    return { ok: true, shareId: ref.id };
});
