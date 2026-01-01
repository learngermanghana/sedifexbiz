"use strict";
// functions/src/pos/resolveStoreAccess.ts
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
exports.resolveStoreAccess = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("../firestore");
function normalizeCandidate(candidate) {
    if (typeof candidate !== 'string') {
        return null;
    }
    const trimmed = candidate.trim();
    return trimmed || null;
}
/**
 * resolveStoreAccess
 *
 * Very simple version:
 * - Requires authenticated user
 * - Requires a storeId in data
 * - Verifies that the store exists in the DEFAULT Firestore DB
 * - (Later we can add role / membership checks here)
 */
exports.resolveStoreAccess = functions.https.onCall(async (data, context) => {
    const uid = context.auth?.uid;
    if (!uid) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
    }
    const memberSnap = await firestore_1.defaultDb.collection('teamMembers').doc(uid).get();
    const memberData = memberSnap.data() || {};
    const candidateStoreIds = [
        data?.storeId,
        memberData.storeId,
        memberData.storeID,
        memberData.workspaceSlug,
        memberData.workspaceId,
        memberData.workspaceUid,
    ];
    const resolvedStoreId = candidateStoreIds.map(normalizeCandidate).find(id => id !== null) ?? uid;
    const storeRef = firestore_1.defaultDb.collection('stores').doc(resolvedStoreId);
    const storeSnap = await storeRef.get();
    if (!storeSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Store not found.');
    }
    const storeData = storeSnap.data() || {};
    const workspaceSlug = typeof storeData.workspaceSlug === 'string' && storeData.workspaceSlug.trim()
        ? storeData.workspaceSlug.trim()
        : storeRef.id;
    const role = typeof memberData.role === 'string' && memberData.role.trim().toLowerCase() === 'owner'
        ? 'owner'
        : 'staff';
    const finalStoreId = normalizeCandidate(storeData.storeId) ?? resolvedStoreId;
    // For now, we just confirm access and return store info.
    // We can later add role checks or membership rules here.
    return {
        ok: true,
        storeId: finalStoreId,
        workspaceSlug,
        role,
        claims: null,
        store: {
            ...storeData,
            id: storeRef.id,
        },
    };
});
