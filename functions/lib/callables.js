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
exports.backfillMyStore = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("./firestore");
const db = firestore_1.defaultDb;
const VALID_ROLES = new Set(['owner', 'staff']);
function normalizeContact(contact) {
    let hasPhone = false;
    let hasFirstSignupEmail = false;
    let hasOwnerName = false;
    let hasBusinessName = false;
    let phone;
    let firstSignupEmail;
    let ownerName;
    let businessName;
    if (contact && typeof contact === 'object') {
        if ('phone' in contact) {
            hasPhone = true;
            const raw = contact.phone;
            if (raw === null || raw === undefined || raw === '') {
                phone = null;
            }
            else if (typeof raw === 'string') {
                const trimmed = raw.trim();
                phone = trimmed ? trimmed : null;
            }
            else {
                throw new functions.https.HttpsError('invalid-argument', 'Phone must be a string when provided');
            }
        }
        if ('firstSignupEmail' in contact) {
            hasFirstSignupEmail = true;
            const raw = contact.firstSignupEmail;
            if (raw === null || raw === undefined || raw === '') {
                firstSignupEmail = null;
            }
            else if (typeof raw === 'string') {
                const trimmed = raw.trim().toLowerCase();
                firstSignupEmail = trimmed ? trimmed : null;
            }
            else {
                throw new functions.https.HttpsError('invalid-argument', 'First signup email must be a string when provided');
            }
        }
        if ('ownerName' in contact) {
            hasOwnerName = true;
            const raw = contact.ownerName;
            if (raw === null || raw === undefined || raw === '') {
                ownerName = null;
            }
            else if (typeof raw === 'string') {
                const trimmed = raw.trim();
                ownerName = trimmed ? trimmed : null;
            }
            else {
                throw new functions.https.HttpsError('invalid-argument', 'Owner name must be a string when provided');
            }
        }
        if ('businessName' in contact) {
            hasBusinessName = true;
            const raw = contact.businessName;
            if (raw === null || raw === undefined || raw === '') {
                businessName = null;
            }
            else if (typeof raw === 'string') {
                const trimmed = raw.trim();
                businessName = trimmed ? trimmed : null;
            }
            else {
                throw new functions.https.HttpsError('invalid-argument', 'Business name must be a string when provided');
            }
        }
    }
    return {
        phone,
        hasPhone,
        firstSignupEmail,
        hasFirstSignupEmail,
        ownerName,
        hasOwnerName,
        businessName,
        hasBusinessName,
    };
}
async function applyRoleClaim(uid, role) {
    const userRecord = await firestore_1.admin
        .auth()
        .getUser(uid)
        .catch(() => null);
    const existingClaims = (userRecord?.customClaims ?? {});
    const nextClaims = { ...existingClaims };
    if (VALID_ROLES.has(role)) {
        nextClaims.role = role;
    }
    else {
        delete nextClaims.role;
    }
    delete nextClaims.stores;
    delete nextClaims.activeStoreId;
    delete nextClaims.storeId;
    delete nextClaims.roleByStore;
    await firestore_1.admin.auth().setCustomUserClaims(uid, nextClaims);
    return nextClaims;
}
exports.backfillMyStore = functions.https.onCall(async (data, context) => {
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
    const uid = context.auth.uid;
    const token = context.auth.token;
    const email = typeof token.email === 'string' ? token.email : null;
    const phone = typeof token.phone_number === 'string' ? token.phone_number : null;
    const payload = (data ?? {});
    const contact = normalizeContact(payload.contact);
    const resolvedPhone = contact.hasPhone ? contact.phone ?? null : phone ?? null;
    const resolvedFirstSignupEmail = contact.hasFirstSignupEmail
        ? contact.firstSignupEmail ?? null
        : email?.toLowerCase() ?? null;
    const resolvedOwnerName = contact.hasOwnerName ? contact.ownerName ?? null : null;
    const resolvedBusinessName = contact.hasBusinessName ? contact.businessName ?? null : null;
    const memberRef = firestore_1.rosterDb.collection('teamMembers').doc(uid);
    const memberSnap = await memberRef.get();
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const existingData = memberSnap.data() ?? {};
    const existingStoreId = typeof existingData.storeId === 'string' && existingData.storeId.trim() !== ''
        ? existingData.storeId
        : null;
    const storeId = existingStoreId ?? uid;
    const memberData = {
        uid,
        email,
        role: 'owner',
        storeId,
        phone: resolvedPhone,
        firstSignupEmail: resolvedFirstSignupEmail,
        invitedBy: uid,
        updatedAt: timestamp,
    };
    if (resolvedOwnerName !== null) {
        memberData.name = resolvedOwnerName;
    }
    if (resolvedBusinessName !== null) {
        memberData.companyName = resolvedBusinessName;
    }
    if (!memberSnap.exists) {
        memberData.createdAt = timestamp;
    }
    await memberRef.set(memberData, { merge: true });
    const claims = await applyRoleClaim(uid, 'owner');
    return { ok: true, claims, storeId };
});
