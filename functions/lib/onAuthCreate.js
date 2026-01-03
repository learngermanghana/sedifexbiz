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
exports.ensureCanonicalWorkspace = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("./firestore");
exports.ensureCanonicalWorkspace = functions.https.onCall(async (rawData, context) => {
    const uid = context.auth?.uid;
    const email = context.auth?.token?.email ?? null;
    if (!uid) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be authenticated to call ensureCanonicalWorkspace.');
    }
    const data = (rawData ?? {});
    const now = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const memberRef = firestore_1.defaultDb.collection('teamMembers').doc(uid);
    const memberSnap = await memberRef.get();
    const existingMember = memberSnap.exists ? memberSnap.data() : null;
    const finalize = async (storeId, role) => {
        const claims = { storeId, role };
        await firestore_1.admin.auth().setCustomUserClaims(uid, claims);
        return {
            ok: true,
            workspaceSlug: storeId,
            storeId,
            claims,
        };
    };
    // 🔹 Normalize inputs
    const requestedStoreId = (data.storeId ?? '').trim();
    const requestedRole = data.role === 'owner' ? 'owner' : data.role === 'member' ? 'member' : null;
    // ─────────────────────────────────────────────────────────────
    // NEW EXPLICIT MODE (frontend passes role + storeId)
    // ─────────────────────────────────────────────────────────────
    if (requestedRole) {
        let storeId = requestedStoreId;
        const companyName = (data.companyName ?? '').trim() || 'My Store';
        if (requestedRole === 'owner') {
            if (!storeId) {
                storeId = `store-${uid}`;
            }
            const workspaceRef = firestore_1.defaultDb.collection('workspaces').doc(storeId);
            await workspaceRef.set({
                company: companyName,
                storeId,
                status: 'active',
                contractStatus: 'trial',
                paymentStatus: 'trial',
                plan: 'Starter',
                billingCycle: 'monthly',
                contactEmail: email,
                createdAt: existingMember?.createdAt ?? now,
                updatedAt: now,
            }, { merge: true });
            await memberRef.set({
                uid,
                email,
                role: 'owner',
                storeId,
                createdAt: existingMember?.createdAt ?? now,
                updatedAt: now,
            }, { merge: true });
            return finalize(storeId, 'owner');
        }
        // requestedRole === 'member'
        if (!storeId) {
            throw new functions.https.HttpsError('invalid-argument', 'storeId is required when role is "member".');
        }
        // Optionally verify workspace exists:
        const wsSnap = await firestore_1.defaultDb.collection('workspaces').doc(storeId).get();
        if (!wsSnap.exists) {
            throw new functions.https.HttpsError('not-found', 'No workspace was found with that Store ID.');
        }
        await memberRef.set({
            uid,
            email,
            role: 'member',
            storeId,
            createdAt: existingMember?.createdAt ?? now,
            updatedAt: now,
        }, { merge: true });
        return finalize(storeId, 'member');
    }
    // ─────────────────────────────────────────────────────────────
    // LEGACY / AUTO MODE (no role passed)
    // 🔹 PATCHED: if data.storeId is present, treat as member join
    // ─────────────────────────────────────────────────────────────
    if (requestedStoreId) {
        const storeId = requestedStoreId;
        // Ensure workspace exists
        const wsSnap = await firestore_1.defaultDb.collection('workspaces').doc(storeId).get();
        if (!wsSnap.exists) {
            throw new functions.https.HttpsError('not-found', 'No workspace was found with that Store ID.');
        }
        await memberRef.set({
            uid,
            email,
            role: 'member',
            storeId,
            createdAt: existingMember?.createdAt ?? now,
            updatedAt: now,
        }, { merge: true });
        return finalize(storeId, 'member');
    }
    // Legacy auto-flow with no role and no storeId:
    // Case 1: re-use existing member.storeId
    if (existingMember &&
        typeof existingMember.storeId === 'string' &&
        existingMember.storeId.trim()) {
        const storeId = existingMember.storeId.trim();
        const role = (existingMember.role ?? 'owner');
        return finalize(storeId, role);
    }
    // Case 2: auto-provision owner store
    const generatedStoreId = `store-${uid}`;
    const workspaceRef = firestore_1.defaultDb.collection('workspaces').doc(generatedStoreId);
    await workspaceRef.set({
        company: email || 'My Store',
        storeId: generatedStoreId,
        status: 'active',
        contractStatus: 'trial',
        paymentStatus: 'trial',
        plan: 'Starter',
        billingCycle: 'monthly',
        contactEmail: email,
        createdAt: existingMember?.createdAt ?? now,
        updatedAt: now,
    }, { merge: true });
    await memberRef.set({
        uid,
        email,
        role: 'owner',
        storeId: generatedStoreId,
        createdAt: existingMember?.createdAt ?? now,
        updatedAt: now,
    }, { merge: true });
    return finalize(generatedStoreId, 'owner');
});
