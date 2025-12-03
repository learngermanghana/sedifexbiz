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
exports.handlePaystackWebhook = exports.createCheckout = exports.createPaystackCheckout = exports.receiveStock = exports.logReceiptShare = exports.commitSale = exports.manageStaffAccount = exports.resolveStoreAccess = exports.initializeStore = exports.handleUserCreate = exports.exportDailyStoreReports = exports.generateAiAdvice = void 0;
// functions/src/index.ts
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const params_1 = require("firebase-functions/params");
var aiAdvisor_1 = require("./aiAdvisor");
Object.defineProperty(exports, "generateAiAdvice", { enumerable: true, get: function () { return aiAdvisor_1.generateAiAdvice; } });
var reports_1 = require("./reports");
Object.defineProperty(exports, "exportDailyStoreReports", { enumerable: true, get: function () { return reports_1.exportDailyStoreReports; } });
/**
 * SINGLE FIRESTORE INSTANCE
 */
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const VALID_ROLES = new Set(['owner', 'staff']);
const TRIAL_DAYS = 14;
const GRACE_DAYS = 7;
const MILLIS_PER_DAY = 1000 * 60 * 60 * 24;
/** ============================================================================
 *  HELPERS
 * ==========================================================================*/
function normalizeContactPayload(contact) {
    let hasPhone = false;
    let hasFirstSignupEmail = false;
    let phone;
    let firstSignupEmail;
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
    }
    return { phone, hasPhone, firstSignupEmail, hasFirstSignupEmail };
}
// 🔹 NEW: normalize store profile fields from signup
function normalizeStoreProfile(profile) {
    let businessName;
    let country;
    let city;
    let phone;
    if (profile && typeof profile === 'object') {
        if ('businessName' in profile) {
            const raw = profile.businessName;
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
        if ('country' in profile) {
            const raw = profile.country;
            if (raw === null || raw === undefined || raw === '') {
                country = null;
            }
            else if (typeof raw === 'string') {
                const trimmed = raw.trim();
                country = trimmed ? trimmed : null;
            }
            else {
                throw new functions.https.HttpsError('invalid-argument', 'Country must be a string when provided');
            }
        }
        if ('city' in profile) {
            const raw = profile.city;
            if (raw === null || raw === undefined || raw === '') {
                city = null;
            }
            else if (typeof raw === 'string') {
                const trimmed = raw.trim();
                city = trimmed ? trimmed : null;
            }
            else {
                throw new functions.https.HttpsError('invalid-argument', 'City must be a string when provided');
            }
        }
        if ('phone' in profile) {
            const raw = profile.phone;
            if (raw === null || raw === undefined || raw === '') {
                phone = null;
            }
            else if (typeof raw === 'string') {
                const trimmed = raw.trim();
                phone = trimmed ? trimmed : null;
            }
            else {
                throw new functions.https.HttpsError('invalid-argument', 'Store phone must be a string when provided');
            }
        }
    }
    return { businessName, country, city, phone };
}
function calculateDaysRemaining(target, now) {
    if (!target || typeof target.toMillis !== 'function')
        return null;
    const diffMs = target.toMillis() - now.toMillis();
    return Math.ceil(diffMs / MILLIS_PER_DAY);
}
function getRoleFromToken(token) {
    const role = typeof token?.role === 'string' ? token.role : null;
    return role && VALID_ROLES.has(role) ? role : null;
}
function assertAuthenticated(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }
}
function assertOwnerAccess(context) {
    assertAuthenticated(context);
    const role = getRoleFromToken(context.auth.token);
    if (role !== 'owner') {
        throw new functions.https.HttpsError('permission-denied', 'Owner access required');
    }
}
async function verifyOwnerForStore(uid, storeId) {
    const memberRef = db.collection('teamMembers').doc(uid);
    const memberSnap = await memberRef.get();
    const memberData = (memberSnap.data() ?? {});
    const memberRole = typeof memberData.role === 'string' ? memberData.role : '';
    const memberStoreId = typeof memberData.storeId === 'string' ? memberData.storeId : '';
    if (memberRole !== 'owner' || memberStoreId !== storeId) {
        throw new functions.https.HttpsError('permission-denied', 'Owner permission for this workspace is required');
    }
}
function assertStaffAccess(context) {
    assertAuthenticated(context);
    const role = getRoleFromToken(context.auth.token);
    if (!role) {
        throw new functions.https.HttpsError('permission-denied', 'Staff access required');
    }
}
async function updateUserClaims(uid, role) {
    const userRecord = await admin.auth().getUser(uid).catch(() => null);
    const existingClaims = (userRecord?.customClaims ?? {});
    const nextClaims = {
        ...existingClaims,
        role,
    };
    delete nextClaims.stores;
    delete nextClaims.activeStoreId;
    delete nextClaims.storeId;
    delete nextClaims.roleByStore;
    await admin.auth().setCustomUserClaims(uid, nextClaims);
    return nextClaims;
}
function normalizeManageStaffPayload(data) {
    const storeIdRaw = data.storeId;
    const storeId = typeof storeIdRaw === 'string' ? storeIdRaw.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const role = typeof data.role === 'string' ? data.role.trim() : '';
    const passwordRaw = data.password;
    let password;
    if (passwordRaw === null || passwordRaw === undefined || passwordRaw === '') {
        password = undefined;
    }
    else if (typeof passwordRaw === 'string') {
        password = passwordRaw;
    }
    else {
        throw new functions.https.HttpsError('invalid-argument', 'Password must be a string when provided');
    }
    if (!storeId) {
        throw new functions.https.HttpsError('invalid-argument', 'A storeId is required');
    }
    if (!email) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid email is required');
    }
    if (!role) {
        throw new functions.https.HttpsError('invalid-argument', 'A role is required');
    }
    if (!VALID_ROLES.has(role)) {
        throw new functions.https.HttpsError('invalid-argument', 'Unsupported role requested');
    }
    const actionRaw = typeof data.action === 'string' ? data.action.trim() : 'invite';
    const action = ['invite', 'reset', 'deactivate'].includes(actionRaw)
        ? actionRaw
        : 'invite';
    return { storeId, email, role, password, action };
}
function timestampDaysFromNow(days) {
    const now = new Date();
    now.setDate(now.getDate() + days);
    return admin.firestore.Timestamp.fromDate(now);
}
function normalizeStoreProfilePayload(profile) {
    let phone;
    let ownerName;
    let businessName;
    let country;
    let city;
    let addressLine1;
    if (profile && typeof profile === 'object') {
        const normalize = (value) => {
            if (value === null || value === undefined || value === '')
                return null;
            if (typeof value === 'string') {
                const trimmed = value.trim();
                return trimmed ? trimmed : null;
            }
            throw new functions.https.HttpsError('invalid-argument', 'Profile fields must be strings when provided');
        };
        if ('phone' in profile)
            phone = normalize(profile.phone);
        if ('ownerName' in profile)
            ownerName = normalize(profile.ownerName);
        if ('businessName' in profile)
            businessName = normalize(profile.businessName);
        if ('country' in profile)
            country = normalize(profile.country);
        // prefer explicit city, but allow town as source
        if ('city' in profile)
            city = normalize(profile.city);
        if (!city && 'town' in profile)
            city = normalize(profile.town);
        // address: accept addressLine1 or address
        if ('addressLine1' in profile)
            addressLine1 = normalize(profile.addressLine1);
        if (!addressLine1 && 'address' in profile)
            addressLine1 = normalize(profile.address);
    }
    return { phone, ownerName, businessName, country, city, addressLine1 };
}
/** ============================================================================
 *  AUTH TRIGGER: seed teamMembers on first user creation
 * ==========================================================================*/
exports.handleUserCreate = functions.auth.user().onCreate(async (user) => {
    const uid = user.uid;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    await db.collection('teamMembers').doc(uid).set({
        uid,
        email: user.email ?? null,
        phone: user.phoneNumber ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
    }, { merge: true });
});
/** ============================================================================
 *  CALLABLE: initializeStore
 * ==========================================================================*/
exports.initializeStore = functions.https.onCall(async (data, context) => {
    assertAuthenticated(context);
    const uid = context.auth.uid;
    const token = context.auth.token;
    const email = typeof token.email === 'string' ? token.email : null;
    const tokenPhone = typeof token.phone_number === 'string' ? token.phone_number : null;
    const payload = (data ?? {});
    const contact = normalizeContactPayload(payload.contact);
    const profile = normalizeStoreProfilePayload(payload.profile);
    const requestedStoreIdRaw = payload.storeId;
    const requestedStoreId = typeof requestedStoreIdRaw === 'string' ? requestedStoreIdRaw.trim() : '';
    const memberRef = db.collection('teamMembers').doc(uid);
    const memberSnap = await memberRef.get();
    const existingData = (memberSnap.data() ?? {});
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    let existingStoreId = null;
    if (typeof existingData.storeId === 'string' &&
        existingData.storeId.trim() !== '') {
        existingStoreId = existingData.storeId;
    }
    let storeId = existingStoreId;
    if (!storeId) {
        storeId = requestedStoreId || uid;
    }
    // --- Determine role ---
    const role = requestedStoreId ? 'staff' : 'owner';
    const workspaceSlug = storeId;
    // --- Validate store existence when joining as team-member ---
    const storeRef = db.collection('stores').doc(storeId);
    const storeSnap = await storeRef.get();
    if (requestedStoreId && !storeSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'No company was found with that Store ID. Please check with your admin.');
    }
    // --- Determine contact info for teamMembers ---
    const existingPhone = typeof existingData.phone === 'string' ? existingData.phone : null;
    const resolvedPhone = contact.hasPhone
        ? contact.phone ?? null
        : existingPhone || tokenPhone || null;
    const existingFirstSignupEmail = typeof existingData.firstSignupEmail === 'string'
        ? existingData.firstSignupEmail
        : null;
    const resolvedFirstSignupEmail = contact.hasFirstSignupEmail
        ? contact.firstSignupEmail ?? null
        : existingFirstSignupEmail || (email ? email.toLowerCase() : null);
    // --- Save team member info ---
    const memberData = {
        uid,
        email,
        role,
        storeId,
        phone: resolvedPhone,
        firstSignupEmail: resolvedFirstSignupEmail,
        invitedBy: existingData.invitedBy || uid,
        updatedAt: timestamp,
    };
    if (!memberSnap.exists)
        memberData.createdAt = timestamp;
    await memberRef.set(memberData, { merge: true });
    // --- If owner, create/merge store + workspace profile info ---
    if (role === 'owner') {
        const baseStoreData = storeSnap.data() ?? {};
        const previousBilling = (baseStoreData.billing || {});
        const nowTs = admin.firestore.Timestamp.now();
        const trialEndsAt = previousBilling.trialEndsAt ||
            previousBilling.trialEnd ||
            timestampDaysFromNow(TRIAL_DAYS);
        const graceEndsAt = previousBilling.graceEndsAt ||
            previousBilling.graceEnd ||
            timestampDaysFromNow(TRIAL_DAYS + GRACE_DAYS);
        const billingStatus = previousBilling.status === 'active' ||
            previousBilling.status === 'past_due'
            ? previousBilling.status
            : 'trial';
        const billingData = {
            planKey: previousBilling.planKey || 'standard',
            status: billingStatus,
            trialEndsAt,
            graceEndsAt,
            paystackCustomerCode: previousBilling.paystackCustomerCode !== undefined
                ? previousBilling.paystackCustomerCode
                : null,
            paystackSubscriptionCode: previousBilling.paystackSubscriptionCode !== undefined
                ? previousBilling.paystackSubscriptionCode
                : null,
            paystackPlanCode: previousBilling.paystackPlanCode !== undefined
                ? previousBilling.paystackPlanCode
                : null,
            currentPeriodEnd: previousBilling.currentPeriodEnd !== undefined
                ? previousBilling.currentPeriodEnd
                : null,
            lastEventAt: nowTs,
            lastChargeReference: previousBilling.lastChargeReference !== undefined
                ? previousBilling.lastChargeReference
                : null,
        };
        const displayName = baseStoreData.displayName ||
            profile.businessName ||
            profile.ownerName ||
            null;
        const storeData = {
            id: storeId,
            storeId,
            ownerUid: baseStoreData.ownerUid || uid,
            ownerEmail: baseStoreData.ownerEmail || email || null,
            email: baseStoreData.email || email || null,
            // 🔹 profile fields
            name: baseStoreData.name || profile.businessName || null,
            displayName,
            phone: profile.phone ?? baseStoreData.phone ?? resolvedPhone ?? null,
            country: profile.country ?? baseStoreData.country ?? null,
            city: profile.city ?? baseStoreData.city ?? null,
            addressLine1: profile.addressLine1 ?? baseStoreData.addressLine1 ?? null,
            status: baseStoreData.status || 'active',
            workspaceSlug,
            contractStatus: baseStoreData.contractStatus || 'trial',
            productCount: typeof baseStoreData.productCount === 'number'
                ? baseStoreData.productCount
                : 0,
            totalStockCount: typeof baseStoreData.totalStockCount === 'number'
                ? baseStoreData.totalStockCount
                : 0,
            createdAt: baseStoreData.createdAt || timestamp,
            updatedAt: timestamp,
            billing: billingData,
        };
        await storeRef.set(storeData, { merge: true });
        const wsRef = db.collection('workspaces').doc(storeId);
        const wsSnap = await wsRef.get();
        const wsBase = wsSnap.data() ?? {};
        const workspaceData = {
            id: storeId,
            slug: wsBase.slug || workspaceSlug,
            storeId,
            ownerUid: wsBase.ownerUid || uid,
            ownerEmail: wsBase.ownerEmail || email || null,
            status: wsBase.status || 'active',
            createdAt: wsBase.createdAt || timestamp,
            updatedAt: timestamp,
        };
        await wsRef.set(workspaceData, { merge: true });
    }
    // --- Update custom claims with role ---
    const claims = await updateUserClaims(uid, role);
    return {
        ok: true,
        storeId,
        workspaceSlug,
        role,
        claims,
    };
});
/** ============================================================================
 *  CALLABLE: resolveStoreAccess
 * ==========================================================================*/
exports.resolveStoreAccess = functions.https.onCall(async (data, context) => {
    assertAuthenticated(context);
    const uid = context.auth.uid;
    const token = context.auth.token;
    const email = typeof token.email === 'string' ? token.email : null;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const payload = (data ?? {});
    const requestedStoreIdRaw = payload.storeId;
    const requestedStoreId = typeof requestedStoreIdRaw === 'string' ? requestedStoreIdRaw.trim() : '';
    const memberRef = db.collection('teamMembers').doc(uid);
    const memberSnap = await memberRef.get();
    const memberData = (memberSnap.data() ?? {});
    let existingStoreId = null;
    if (typeof memberData.storeId === 'string' && memberData.storeId.trim() !== '') {
        existingStoreId = memberData.storeId;
    }
    const storeId = requestedStoreId || existingStoreId || uid;
    let role;
    if (typeof memberData.role === 'string' &&
        (memberData.role === 'owner' || memberData.role === 'staff')) {
        role = memberData.role;
    }
    else {
        role = requestedStoreId ? 'staff' : 'owner';
    }
    const workspaceSlug = storeId;
    const nextMemberData = {
        uid,
        email: memberData.email || email || null,
        storeId,
        role,
        updatedAt: timestamp,
    };
    if (!memberSnap.exists) {
        nextMemberData.createdAt = timestamp;
    }
    await memberRef.set(nextMemberData, { merge: true });
    const storeRef = db.collection('stores').doc(storeId);
    const storeSnap = await storeRef.get();
    const baseStore = storeSnap.data() ?? {};
    const previousBilling = (baseStore.billing || {});
    const nowTs = admin.firestore.Timestamp.now();
    const paymentStatusRaw = typeof baseStore.paymentStatus === 'string' ? baseStore.paymentStatus : null;
    const trialEndsAt = previousBilling.trialEndsAt ||
        previousBilling.trialEnd ||
        timestampDaysFromNow(TRIAL_DAYS);
    const graceEndsAt = previousBilling.graceEndsAt ||
        previousBilling.graceEnd ||
        timestampDaysFromNow(TRIAL_DAYS + GRACE_DAYS);
    const billingStatus = previousBilling.status === 'active' || previousBilling.status === 'past_due'
        ? previousBilling.status
        : 'trial';
    const trialDaysRemaining = calculateDaysRemaining(trialEndsAt, nowTs);
    const trialExpired = billingStatus === 'trial' &&
        paymentStatusRaw !== 'active' &&
        trialDaysRemaining !== null &&
        trialDaysRemaining <= 0;
    const normalizedBillingStatus = trialExpired
        ? 'past_due'
        : billingStatus;
    const normalizedPaymentStatus = trialExpired
        ? 'past_due'
        : paymentStatusRaw === 'active'
            ? 'active'
            : paymentStatusRaw === 'past_due'
                ? 'past_due'
                : billingStatus;
    const billingData = {
        planKey: previousBilling.planKey || 'standard',
        status: normalizedBillingStatus,
        trialEndsAt,
        graceEndsAt,
        paystackCustomerCode: previousBilling.paystackCustomerCode !== undefined
            ? previousBilling.paystackCustomerCode
            : null,
        paystackSubscriptionCode: previousBilling.paystackSubscriptionCode !== undefined
            ? previousBilling.paystackSubscriptionCode
            : null,
        paystackPlanCode: previousBilling.paystackPlanCode !== undefined
            ? previousBilling.paystackPlanCode
            : null,
        currentPeriodEnd: previousBilling.currentPeriodEnd !== undefined
            ? previousBilling.currentPeriodEnd
            : null,
        lastEventAt: nowTs,
        lastChargeReference: previousBilling.lastChargeReference !== undefined
            ? previousBilling.lastChargeReference
            : null,
    };
    const storeData = {
        id: storeId,
        ownerUid: baseStore.ownerUid || (role === 'owner' ? uid : baseStore.ownerUid || uid),
        ownerEmail: baseStore.ownerEmail || email || null,
        status: baseStore.status || 'active',
        workspaceSlug: baseStore.workspaceSlug || workspaceSlug,
        contractStatus: baseStore.contractStatus || 'trial',
        productCount: typeof baseStore.productCount === 'number' ? baseStore.productCount : 0,
        totalStockCount: typeof baseStore.totalStockCount === 'number'
            ? baseStore.totalStockCount
            : 0,
        createdAt: baseStore.createdAt || timestamp,
        updatedAt: timestamp,
        paymentStatus: normalizedPaymentStatus,
        billing: billingData,
    };
    await storeRef.set(storeData, { merge: true });
    const wsRef = db.collection('workspaces').doc(storeId);
    const wsSnap = await wsRef.get();
    const wsBase = wsSnap.data() ?? {};
    const workspaceData = {
        id: storeId,
        slug: wsBase.slug || workspaceSlug,
        storeId,
        ownerUid: wsBase.ownerUid || storeData.ownerUid,
        ownerEmail: wsBase.ownerEmail || storeData.ownerEmail,
        status: wsBase.status || 'active',
        createdAt: wsBase.createdAt || timestamp,
        updatedAt: timestamp,
    };
    await wsRef.set(workspaceData, { merge: true });
    const billingSummary = {
        status: normalizedBillingStatus,
        paymentStatus: normalizedPaymentStatus,
        trialEndsAt: trialEndsAt && typeof trialEndsAt.toMillis === 'function'
            ? trialEndsAt.toMillis()
            : null,
        trialDaysRemaining: trialDaysRemaining === null ? null : Math.max(trialDaysRemaining, 0),
    };
    if (trialExpired) {
        const endDate = trialEndsAt && typeof trialEndsAt.toDate === 'function'
            ? trialEndsAt.toDate().toISOString().slice(0, 10)
            : 'your trial end date';
        throw new functions.https.HttpsError('permission-denied', `Your free trial ended on ${endDate}. Please upgrade to continue.`);
    }
    const claims = await updateUserClaims(uid, role);
    return {
        ok: true,
        storeId,
        workspaceSlug,
        role,
        claims,
        billing: billingSummary,
    };
});
/** ============================================================================
 *  CALLABLE: manageStaffAccount (owner only)
 * ==========================================================================*/
async function logStaffAudit(entry) {
    const auditRef = db.collection('staffAudit').doc();
    const payload = {
        ...entry,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
        await auditRef.set(payload);
    }
    catch (error) {
        console.error('[staff-audit] Failed to record audit entry', error);
    }
}
async function ensureAuthUser(email, password) {
    try {
        const record = await admin.auth().getUserByEmail(email);
        if (password) {
            await admin.auth().updateUser(record.uid, { password });
        }
        return { record, created: false };
    }
    catch (error) {
        if (error?.code === 'auth/user-not-found') {
            if (!password) {
                throw new functions.https.HttpsError('invalid-argument', 'A password is required when creating a new staff account');
            }
            const record = await admin.auth().createUser({
                email,
                password,
                emailVerified: false,
            });
            return { record, created: true };
        }
        throw error;
    }
}
exports.manageStaffAccount = functions.https.onCall(async (data, context) => {
    assertOwnerAccess(context);
    const { storeId, email, role, password, action } = normalizeManageStaffPayload(data);
    const actorUid = context.auth.uid;
    const actorEmail = typeof context.auth?.token?.email === 'string'
        ? context.auth.token.email
        : null;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const getUserOrThrow = async () => {
        try {
            return await admin.auth().getUserByEmail(email);
        }
        catch (error) {
            if (error?.code === 'auth/user-not-found') {
                throw new functions.https.HttpsError('not-found', 'No account found for that email');
            }
            throw error;
        }
    };
    const auditBase = {
        action,
        storeId,
        actorUid,
        actorEmail,
        targetEmail: email,
    };
    try {
        await verifyOwnerForStore(actorUid, storeId);
        let record;
        let created = false;
        let claims;
        if (action === 'invite') {
            const ensured = await ensureAuthUser(email, password);
            record = ensured.record;
            created = ensured.created;
            await admin.auth().updateUser(record.uid, { disabled: false });
            const memberRef = db.collection('teamMembers').doc(record.uid);
            const memberSnap = await memberRef.get();
            const memberData = {
                uid: record.uid,
                email,
                storeId,
                role,
                invitedBy: actorUid,
                status: 'active',
                updatedAt: timestamp,
            };
            if (!memberSnap.exists) {
                memberData.createdAt = timestamp;
            }
            await memberRef.set(memberData, { merge: true });
            claims = await updateUserClaims(record.uid, role);
        }
        else if (action === 'reset') {
            if (!password) {
                throw new functions.https.HttpsError('invalid-argument', 'A new password is required to reset staff credentials');
            }
            record = await getUserOrThrow();
            await admin.auth().updateUser(record.uid, { password, disabled: false });
            const memberRef = db.collection('teamMembers').doc(record.uid);
            await memberRef.set({ uid: record.uid, email, storeId, role, status: 'active', updatedAt: timestamp }, { merge: true });
            claims = await updateUserClaims(record.uid, role);
        }
        else {
            record = await getUserOrThrow();
            await admin.auth().updateUser(record.uid, { disabled: true });
            const memberRef = db.collection('teamMembers').doc(record.uid);
            await memberRef.set({ uid: record.uid, email, storeId, role, status: 'inactive', updatedAt: timestamp }, { merge: true });
            created = false;
        }
        await logStaffAudit({
            ...auditBase,
            targetUid: record.uid,
            outcome: 'success',
            errorMessage: null,
        });
        return { ok: true, role, email, uid: record.uid, created, storeId, claims };
    }
    catch (error) {
        await logStaffAudit({
            ...auditBase,
            outcome: 'failure',
            targetUid: null,
            errorMessage: typeof error?.message === 'string' ? error.message : 'Unknown error',
        });
        throw error;
    }
});
/** ============================================================================
 *  CALLABLE: commitSale (staff)
 * ==========================================================================*/
exports.commitSale = functions.https.onCall(async (data, context) => {
    assertStaffAccess(context);
    const { branchId, items, totals, cashierId, saleId: saleIdRaw, payment, customer, } = data || {};
    const saleId = typeof saleIdRaw === 'string' ? saleIdRaw.trim() : '';
    if (!saleId) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid saleId is required');
    }
    const normalizedBranchIdRaw = typeof branchId === 'string' ? branchId.trim() : '';
    if (!normalizedBranchIdRaw) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid branch identifier is required');
    }
    const normalizedBranchId = normalizedBranchIdRaw;
    // Normalize items ONCE outside the transaction
    const normalizedItems = Array.isArray(items)
        ? items.map((it) => {
            const productId = typeof it?.productId === 'string' ? it.productId.trim() : null;
            const name = typeof it?.name === 'string' ? it.name : null;
            const qty = Number(it?.qty ?? 0) || 0;
            const price = Number(it?.price ?? 0) || 0;
            const taxRate = Number(it?.taxRate ?? 0) || 0;
            const typeRaw = typeof it?.type === 'string'
                ? it.type.trim().toLowerCase()
                : null;
            const type = typeRaw === 'service' ? 'service' : typeRaw === 'product' ? 'product' : null;
            const isService = it?.isService === true || type === 'service';
            return { productId, name, qty, price, taxRate, type, isService };
        })
        : [];
    // Validate products before we even touch Firestore
    for (const it of normalizedItems) {
        if (!it.productId) {
            throw new functions.https.HttpsError('failed-precondition', 'Bad product');
        }
    }
    const saleRef = db.collection('sales').doc(saleId);
    const saleItemsRef = db.collection('saleItems');
    await db.runTransaction(async (tx) => {
        // 1️⃣ ALL READS FIRST
        // sale doc (prevent duplicates)
        const existingSale = await tx.get(saleRef);
        if (existingSale.exists) {
            throw new functions.https.HttpsError('already-exists', 'Sale has already been committed');
        }
        // product docs
        const productSnaps = {};
        const productRefs = {};
        for (const it of normalizedItems) {
            const productId = it.productId;
            const pRef = db.collection('products').doc(productId);
            productRefs[productId] = pRef;
            const pSnap = await tx.get(pRef);
            if (!pSnap.exists) {
                throw new functions.https.HttpsError('failed-precondition', 'Bad product');
            }
            productSnaps[productId] = pSnap;
        }
        // 2️⃣ THEN ALL WRITES
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        tx.set(saleRef, {
            branchId: normalizedBranchId,
            storeId: normalizedBranchId,
            cashierId,
            total: totals?.total ?? 0,
            taxTotal: totals?.taxTotal ?? 0,
            payment: payment ?? null,
            customer: customer ?? null,
            items: normalizedItems,
            createdBy: context.auth?.uid ?? null,
            createdAt: timestamp,
        });
        for (const it of normalizedItems) {
            const productId = it.productId;
            // saleItems row
            const itemId = db.collection('_').doc().id;
            tx.set(saleItemsRef.doc(itemId), {
                saleId,
                productId,
                qty: it.qty,
                price: it.price,
                taxRate: it.taxRate,
                type: it.type,
                isService: it.isService === true,
                storeId: normalizedBranchId,
                createdAt: timestamp,
            });
            // product stock update
            const pRef = productRefs[productId];
            const pSnap = productSnaps[productId];
            const curr = Number(pSnap.get('stockCount') || 0);
            const next = curr - Math.abs(it.qty || 0);
            tx.update(pRef, { stockCount: next, updatedAt: timestamp });
            // ledger entry
            const ledgerId = db.collection('_').doc().id;
            tx.set(db.collection('ledger').doc(ledgerId), {
                productId,
                qtyChange: -Math.abs(it.qty || 0),
                type: 'sale',
                refId: saleId,
                storeId: normalizedBranchId,
                createdAt: timestamp,
            });
        }
    });
    return { ok: true, saleId };
});
/** ============================================================================
 *  CALLABLE: logReceiptShare (staff)
 * ==========================================================================*/
const RECEIPT_CHANNELS = new Set(['email', 'sms', 'whatsapp']);
const RECEIPT_STATUSES = new Set(['attempt', 'failed', 'sent']);
exports.logReceiptShare = functions.https.onCall(async (data, context) => {
    assertStaffAccess(context);
    const storeId = typeof data?.storeId === 'string' ? data.storeId.trim() : '';
    const saleId = typeof data?.saleId === 'string' ? data.saleId.trim() : '';
    const channel = typeof data?.channel === 'string' ? data.channel.trim() : '';
    const status = typeof data?.status === 'string' ? data.status.trim() : '';
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
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
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
    const ref = await db.collection('receiptShareLogs').add(payload);
    return { ok: true, shareId: ref.id };
});
/** ============================================================================
 *  CALLABLE: receiveStock (staff)
 * ==========================================================================*/
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
    const productRef = db.collection('products').doc(productIdStr);
    const receiptRef = db.collection('receipts').doc();
    const ledgerRef = db.collection('ledger').doc();
    await db.runTransaction(async (tx) => {
        const pSnap = await tx.get(productRef);
        if (!pSnap.exists) {
            throw new functions.https.HttpsError('failed-precondition', 'Bad product');
        }
        const productStoreIdRaw = pSnap.get('storeId');
        const productStoreId = typeof productStoreIdRaw === 'string' ? productStoreIdRaw.trim() : null;
        const currentStock = Number(pSnap.get('stockCount') || 0);
        const nextStock = currentStock + amount;
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
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
/** ============================================================================
 *  PAYSTACK HELPERS
 * ==========================================================================*/
const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const PAYSTACK_SECRET_KEY = (0, params_1.defineString)('PAYSTACK_SECRET_KEY');
const PAYSTACK_STANDARD_PLAN_CODE = (0, params_1.defineString)('PAYSTACK_STANDARD_PLAN_CODE');
const PAYSTACK_CURRENCY = (0, params_1.defineString)('PAYSTACK_CURRENCY');
function safeParamValue(param) {
    try {
        return param.value();
    }
    catch (error) {
        console.log('[paystack] param not set; falling back to env', { error });
        return '';
    }
}
let paystackConfigLogged = false;
function getPaystackConfig() {
    const secret = safeParamValue(PAYSTACK_SECRET_KEY) || process.env.PAYSTACK_SECRET_KEY || '';
    const plan = safeParamValue(PAYSTACK_STANDARD_PLAN_CODE) || process.env.PAYSTACK_STANDARD_PLAN_CODE || '';
    const currency = safeParamValue(PAYSTACK_CURRENCY) || process.env.PAYSTACK_CURRENCY || 'GHS';
    if (!paystackConfigLogged) {
        console.log('[paystack] startup config', {
            hasSecret: !!secret,
            hasPlan: !!plan,
            currency,
        });
        paystackConfigLogged = true;
    }
    return { secret, plan, currency };
}
function ensurePaystackConfig() {
    const config = getPaystackConfig();
    if (!config.secret) {
        console.error('[paystack] Missing PAYSTACK_SECRET_KEY env');
        throw new functions.https.HttpsError('failed-precondition', 'Paystack is not configured. Please contact support.');
    }
    if (!config.plan) {
        console.error('[paystack] Missing PAYSTACK_STANDARD_PLAN_CODE env');
        throw new functions.https.HttpsError('failed-precondition', 'Subscription plan is not configured. Please contact support.');
    }
    return config;
}
/** ============================================================================
 *  CALLABLE: createPaystackCheckout
 * ==========================================================================*/
exports.createPaystackCheckout = functions.https.onCall(async (data, context) => {
    assertOwnerAccess(context);
    const paystackConfig = ensurePaystackConfig();
    const uid = context.auth.uid;
    const token = context.auth.token;
    const email = typeof token.email === 'string' ? token.email : null;
    const payload = (data ?? {});
    const requestedStoreId = typeof payload.storeId === 'string' ? payload.storeId.trim() : '';
    const memberRef = db.collection('teamMembers').doc(uid);
    const memberSnap = await memberRef.get();
    const memberData = (memberSnap.data() ?? {});
    let resolvedStoreId = '';
    if (requestedStoreId) {
        resolvedStoreId = requestedStoreId;
    }
    else if (typeof memberData.storeId === 'string' &&
        memberData.storeId.trim() !== '') {
        resolvedStoreId = memberData.storeId;
    }
    else {
        resolvedStoreId = uid;
    }
    const storeId = resolvedStoreId;
    const storeRef = db.collection('stores').doc(storeId);
    const storeSnap = await storeRef.get();
    const storeData = (storeSnap.data() ?? {});
    const billing = (storeData.billing || {});
    // Amount is in minor units (pesewas). 1000 = GHS 10.00
    const amountMinorUnits = 1000;
    const body = {
        email: email || storeData.ownerEmail || undefined,
        amount: amountMinorUnits,
        currency: paystackConfig.currency,
        callback_url: typeof payload.redirectUrl === 'string'
            ? payload.redirectUrl
            : typeof payload.returnUrl === 'string'
                ? payload.returnUrl
                : undefined,
        metadata: {
            storeId,
            userId: uid,
            planKey: 'standard',
        },
        plan: paystackConfig.plan,
    };
    let responseJson;
    try {
        const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${paystackConfig.secret}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
        responseJson = await response.json();
        if (!response.ok || !responseJson.status) {
            console.error('[paystack] initialize failed', responseJson);
            throw new functions.https.HttpsError('unknown', 'Unable to start checkout with Paystack.');
        }
    }
    catch (error) {
        console.error('[paystack] initialize error', error);
        throw new functions.https.HttpsError('unknown', 'Unable to start checkout with Paystack.');
    }
    const authUrl = responseJson.data &&
        typeof responseJson.data.authorization_url === 'string'
        ? responseJson.data.authorization_url
        : null;
    if (!authUrl) {
        throw new functions.https.HttpsError('unknown', 'Paystack did not return a valid authorization URL.');
    }
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    await storeRef.set({
        billing: {
            ...(billing || {}),
            planKey: billing.planKey || 'standard',
            status: billing.status || 'trial',
            lastCheckoutUrl: authUrl,
            lastCheckoutAt: timestamp,
        },
    }, { merge: true });
    return {
        ok: true,
        authorizationUrl: authUrl,
    };
});
// 🔹 Alias so the frontend name still works
exports.createCheckout = exports.createPaystackCheckout;
/** ============================================================================
 *  HTTP: handlePaystackWebhook
 * ==========================================================================*/
exports.handlePaystackWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    const { secret: paystackSecret, plan: paystackPlanCode } = getPaystackConfig();
    if (!paystackSecret) {
        console.error('[paystack] Missing PAYSTACK_SECRET_KEY for webhook');
        res.status(500).send('PAYSTACK_SECRET_KEY_NOT_CONFIGURED');
        return;
    }
    const signature = req.headers['x-paystack-signature'];
    if (!signature) {
        res.status(401).send('Missing signature');
        return;
    }
    const rawBody = req.rawBody;
    const hash = crypto
        .createHmac('sha512', paystackSecret)
        .update(rawBody)
        .digest('hex');
    if (hash !== signature) {
        console.error('[paystack] Signature mismatch');
        res.status(401).send('Invalid signature');
        return;
    }
    const event = req.body;
    const eventName = event && event.event;
    try {
        if (eventName === 'charge.success') {
            const data = event.data || {};
            const metadata = data.metadata || {};
            const storeId = typeof metadata.storeId === 'string' ? metadata.storeId.trim() : '';
            if (!storeId) {
                console.warn('[paystack] charge.success missing storeId in metadata');
            }
            else {
                const storeRef = db.collection('stores').doc(storeId);
                const timestamp = admin.firestore.FieldValue.serverTimestamp();
                const customer = data.customer || {};
                const subscription = data.subscription || {};
                const plan = data.plan || {};
                await storeRef.set({
                    billing: {
                        planKey: 'standard',
                        status: 'active',
                        paystackCustomerCode: customer.customer_code || null,
                        paystackSubscriptionCode: subscription.subscription_code || null,
                        paystackPlanCode: plan.plan_code || paystackPlanCode,
                        currentPeriodEnd: data.paid_at || null,
                        lastEventAt: timestamp,
                        lastChargeReference: data.reference || null,
                    },
                    paymentStatus: 'active',
                    contractStatus: 'active',
                }, { merge: true });
            }
        }
        res.status(200).send('ok');
    }
    catch (error) {
        console.error('[paystack] webhook handling error', error);
        res.status(500).send('error');
    }
});
