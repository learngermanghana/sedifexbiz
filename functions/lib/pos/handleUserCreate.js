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
exports.handleUserCreate = void 0;
// functions/src/pos/handleUserCreate.ts
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("../firestore");
async function createOwnerStoreAndWorkspace(params) {
    const { uid, email, storeId, company } = params;
    const now = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    // 1) Store document
    await firestore_1.defaultDb.collection('stores').doc(storeId).set({
        ownerId: uid,
        status: 'Active',
        contractStatus: 'trial',
        inventorySummary: {
            trackedSkus: 0,
            lowStockSkus: 0,
            incomingShipments: 0,
        },
        createdAt: now,
        updatedAt: now,
    }, { merge: true });
    // 2) Team member document as owner
    await firestore_1.defaultDb.collection('teamMembers').doc(uid).set({
        uid,
        email,
        storeId,
        role: 'owner',
        createdAt: now,
        updatedAt: now,
    }, { merge: true });
    // 3) Workspace document (ID == storeId)
    await firestore_1.defaultDb.collection('workspaces').doc(storeId).set({
        storeId,
        company: company || 'New Store',
        contactEmail: email,
        plan: 'Growth',
        billingCycle: 'annual',
        paymentStatus: 'trial',
        status: 'active',
        updatedAt: now,
    }, { merge: true });
    // 4) Custom auth claims
    await firestore_1.admin.auth().setCustomUserClaims(uid, {
        role: 'owner',
        storeId,
    });
}
/**
 * handleUserCreate
 * Called from the web app right after signup.
 *
 * - mode: 'owner' or 'member'
 *   - owner:
 *       - auto-creates store + teamMember + workspace
 *       - storeId defaults to uid if not supplied
 *   - member:
 *       - requires storeId, verifies store exists
 *       - creates teamMember with role 'staff'
 */
exports.handleUserCreate = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be signed in to complete onboarding.');
    }
    const uid = context.auth.uid;
    const email = context.auth.token.email ?? null;
    const now = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const mode = data?.mode === 'member' ? 'member' : 'owner';
    let storeId = (data?.storeId || '').trim();
    // ────────────────────────────────────────────────────────────
    // OWNER FLOW
    // ────────────────────────────────────────────────────────────
    if (mode === 'owner') {
        if (!storeId) {
            // simplest rule: owner's default store uses uid as ID
            storeId = uid;
        }
        await createOwnerStoreAndWorkspace({
            uid,
            email,
            storeId,
            company: data?.company,
        });
        return { ok: true, mode: 'owner', storeId };
    }
    // ────────────────────────────────────────────────────────────
    // MEMBER FLOW
    // ────────────────────────────────────────────────────────────
    if (!storeId) {
        throw new functions.https.HttpsError('invalid-argument', 'Store ID is required for team members.');
    }
    const storeRef = firestore_1.defaultDb.collection('stores').doc(storeId);
    const storeSnap = await storeRef.get();
    if (!storeSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'No store found with that Store ID.');
    }
    await firestore_1.defaultDb.collection('teamMembers').doc(uid).set({
        uid,
        email,
        storeId,
        role: 'staff',
        createdAt: now,
        updatedAt: now,
    }, { merge: true });
    await firestore_1.admin.auth().setCustomUserClaims(uid, {
        role: 'staff',
        storeId,
    });
    // Workspace will be ensured by ensureCanonicalWorkspace
    return { ok: true, mode: 'member', storeId };
});
