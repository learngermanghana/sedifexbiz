"use strict";
// functions/src/callables.ts
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
    // Helper to set auth claims and build the response
    const finalize = async (storeId, role) => {
        const claims = { storeId, role };
        await firestore_1.admin.auth().setCustomUserClaims(uid, claims);
        return {
            ok: true,
            workspaceSlug: storeId, // we now treat storeId as the workspace id
            storeId,
            claims,
        };
    };
    // ─────────────────────────────────────────────────────────────
    // LEGACY / AUTO MODE (current frontend)
    // No role passed => we infer or auto-create a workspace.
    // ─────────────────────────────────────────────────────────────
    if (!data.role) {
        // Case 1: teamMembers/<uid> already has a storeId → reuse it.
        if (existingMember &&
            typeof existingMember.storeId === 'string' &&
            existingMember.storeId.trim()) {
            const storeId = existingMember.storeId.trim();
            const role = existingMember.role ?? 'owner';
            return finalize(storeId, role);
        }
        // Case 2: No storeId yet → auto-provision a default store and
        // treat this user as an owner.
        const generatedStoreId = `store-${uid}`;
        // Optional but useful: keep a workspace document keyed by storeId
        const workspaceRef = firestore_1.defaultDb.collection('workspaces').doc(generatedStoreId);
        await workspaceRef.set({
            company: email || 'My Store',
            storeId: generatedStoreId,
            status: 'active',
            contractStatus: 'Active',
            paymentStatus: 'trial',
            plan: 'Starter',
            billingCycle: 'monthly',
            contactEmail: email,
            createdAt: existingMember?.createdAt ?? now,
            updatedAt: now,
        }, { merge: true });
        // Upsert the team member as owner of this store
        await memberRef.set({
            uid,
            email,
            role: 'owner',
            storeId: generatedStoreId,
            createdAt: existingMember?.createdAt ?? now,
            updatedAt: now,
        }, { merge: true });
        return finalize(generatedStoreId, 'owner');
    }
    // ─────────────────────────────────────────────────────────────
    // NEW EXPLICIT MODE (when frontend passes role + storeId)
    // ─────────────────────────────────────────────────────────────
    const role = data.role === 'owner' ? 'owner' : 'member';
    let storeId = (data.storeId ?? '').trim();
    const companyName = (data.companyName ?? '').trim() || 'My Store';
    if (role === 'owner') {
        // If owner did not provide a storeId, generate one from uid
        if (!storeId) {
            storeId = `store-${uid}`;
        }
        const workspaceRef = firestore_1.defaultDb.collection('workspaces').doc(storeId);
        await workspaceRef.set({
            company: companyName,
            storeId,
            status: 'active',
            contractStatus: 'Active',
            paymentStatus: 'paid',
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
    else {
        // role === 'member'
        if (!storeId) {
            throw new functions.https.HttpsError('invalid-argument', 'storeId is required when role is "member".');
        }
        // Optionally verify workspace exists here if you want:
        // const workspaceSnap = await defaultDb.collection('workspaces').doc(storeId).get()
        // if (!workspaceSnap.exists) { throw new HttpsError(...); }
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
});
