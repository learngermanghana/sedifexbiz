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
exports.applyRoleClaims = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("./firestore");
function assertAuthenticated(ctx) {
    if (!ctx.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
}
/**
 * Minimal callable to set a user's custom role claim using Firebase Admin only.
 * If `uid` is omitted, the caller's uid is used.
 */
exports.applyRoleClaims = functions.https.onCall(async (data, context) => {
    assertAuthenticated(context);
    const uid = typeof data?.uid === 'string' && data.uid.trim() ? data.uid.trim() : context.auth.uid;
    if (!uid) {
        throw new functions.https.HttpsError('invalid-argument', 'A user id is required to apply role claims');
    }
    const roleRaw = typeof data?.role === 'string' ? data.role.trim().toLowerCase() : '';
    const role = roleRaw === 'owner' ? 'owner' : 'staff';
    // Merge with existing custom claims to avoid clobbering anything else.
    const existing = (await firestore_1.admin
        .auth()
        .getUser(uid)
        .then(u => (u.customClaims ?? {}))
        .catch(() => ({})));
    const nextClaims = { ...existing, role };
    delete nextClaims.stores;
    delete nextClaims.activeStoreId;
    delete nextClaims.storeId;
    delete nextClaims.roleByStore;
    await firestore_1.admin.auth().setCustomUserClaims(uid, nextClaims);
    return { ok: true, uid, claims: nextClaims };
});
