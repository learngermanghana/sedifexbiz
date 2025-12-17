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
exports.initializeStore = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("../firestore");
function normalizeString(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed || null;
}
function normalizeSignupRole(value) {
    if (typeof value === 'string' && value.trim().toLowerCase() === 'team-member') {
        return 'team-member';
    }
    return 'owner';
}
exports.initializeStore = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
    }
    const storeIdInput = normalizeString(data?.storeId);
    const storeId = storeIdInput || context.auth.uid;
    const now = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const contact = (data?.contact || {});
    const signupRole = normalizeSignupRole(contact.signupRole);
    const signupContact = {
        phone: normalizeString(contact.phone),
        firstSignupEmail: normalizeString(contact.firstSignupEmail),
        ownerName: normalizeString(contact.ownerName),
        businessName: normalizeString(contact.businessName),
        country: normalizeString(contact.country),
        town: normalizeString(contact.town),
        signupRole,
    };
    await firestore_1.defaultDb.runTransaction(async (tx) => {
        const storeRef = firestore_1.defaultDb.collection('stores').doc(storeId);
        const teamRef = firestore_1.defaultDb.collection('teamMembers').doc(context.auth.uid);
        const teamAliasRef = contact.firstSignupEmail
            ? firestore_1.defaultDb.collection('teamMembers').doc(contact.firstSignupEmail.toString().toLowerCase())
            : null;
        tx.set(storeRef, {
            storeId,
            workspaceSlug: storeId,
            updatedAt: now,
            signupContact,
        }, { merge: true });
        const baseTeamData = {
            uid: context.auth.uid,
            storeId,
            role: signupRole === 'team-member' ? 'staff' : 'owner',
            email: normalizeString(contact.firstSignupEmail),
            phone: normalizeString(contact.phone),
            updatedAt: now,
        };
        tx.set(teamRef, baseTeamData, { merge: true });
        if (teamAliasRef) {
            tx.set(teamAliasRef, baseTeamData, { merge: true });
        }
    });
    return {
        ok: true,
        storeId,
        claims: null,
        role: signupRole,
    };
});
