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
exports.receiveStock = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("../firestore");
const VALID_ROLES = new Set(['owner', 'staff']);
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
exports.receiveStock = functions.https.onCall(async (data, context) => {
    assertStaffAccess(context);
    const { productId, qty, supplier, reference, unitCost } = data || {};
    const productIdStr = typeof productId === 'string' ? productId : null;
    if (!productIdStr) {
        throw new functions.https.HttpsError('invalid-argument', 'A product must be selected');
    }
    const amount = Number(qty);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Quantity must be greater than zero');
    }
    const normalizedSupplier = typeof supplier === 'string' ? supplier.trim() : '';
    if (!normalizedSupplier) {
        throw new functions.https.HttpsError('invalid-argument', 'Supplier is required');
    }
    const normalizedReference = typeof reference === 'string' ? reference.trim() : '';
    if (!normalizedReference) {
        throw new functions.https.HttpsError('invalid-argument', 'Reference number is required');
    }
    let normalizedUnitCost = null;
    if (unitCost !== undefined && unitCost !== null && unitCost !== '') {
        const parsedCost = Number(unitCost);
        if (!Number.isFinite(parsedCost) || parsedCost < 0) {
            throw new functions.https.HttpsError('invalid-argument', 'Cost must be zero or greater when provided');
        }
        normalizedUnitCost = parsedCost;
    }
    const productRef = firestore_1.defaultDb.collection('products').doc(productIdStr);
    const receiptRef = firestore_1.defaultDb.collection('receipts').doc();
    const ledgerRef = firestore_1.defaultDb.collection('ledger').doc();
    await firestore_1.defaultDb.runTransaction(async (tx) => {
        const pSnap = await tx.get(productRef);
        if (!pSnap.exists) {
            throw new functions.https.HttpsError('failed-precondition', 'Bad product');
        }
        const productStoreIdRaw = pSnap.get('storeId');
        const productStoreId = typeof productStoreIdRaw === 'string' ? productStoreIdRaw.trim() : null;
        const currentStock = Number(pSnap.get('stockCount') || 0);
        const nextStock = currentStock + amount;
        const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
        tx.update(productRef, {
            stockCount: nextStock,
            updatedAt: timestamp,
            lastReceivedAt: timestamp,
            lastReceivedQty: amount,
            lastReceivedCost: normalizedUnitCost,
        });
        const totalCost = normalizedUnitCost === null
            ? null
            : Math.round((normalizedUnitCost * amount + Number.EPSILON) * 100) / 100;
        tx.set(receiptRef, {
            productId: productIdStr,
            qty: amount,
            supplier: normalizedSupplier,
            reference: normalizedReference,
            unitCost: normalizedUnitCost,
            totalCost,
            receivedBy: context.auth?.uid ?? null,
            createdAt: timestamp,
            storeId: productStoreId,
        });
        tx.set(ledgerRef, {
            productId: productIdStr,
            qtyChange: amount,
            type: 'receipt',
            refId: receiptRef.id,
            storeId: productStoreId,
            createdAt: timestamp,
        });
    });
    return { ok: true, receiptId: receiptRef.id };
});
