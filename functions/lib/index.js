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
exports.handlePaystackWebhook = exports.createBulkCreditsCheckout = exports.createCheckout = exports.createPaystackCheckout = exports.sendBulkMessage = exports.logPaymentReminder = exports.logReceiptShareAttempt = exports.logReceiptShare = exports.commitSale = exports.manageStaffAccount = exports.resolveStoreAccess = exports.initializeStore = exports.handleUserCreate = exports.checkSignupUnlock = exports.exportDailyStoreReports = exports.generateAiAdvice = void 0;
// functions/src/index.ts
const functions = __importStar(require("firebase-functions/v1"));
const crypto = __importStar(require("crypto"));
const params_1 = require("firebase-functions/params");
const firestore_1 = require("./firestore");
const phone_1 = require("./phone");
var aiAdvisor_1 = require("./aiAdvisor");
Object.defineProperty(exports, "generateAiAdvice", { enumerable: true, get: function () { return aiAdvisor_1.generateAiAdvice; } });
var reports_1 = require("./reports");
Object.defineProperty(exports, "exportDailyStoreReports", { enumerable: true, get: function () { return reports_1.exportDailyStoreReports; } });
var paystack_1 = require("./paystack");
Object.defineProperty(exports, "checkSignupUnlock", { enumerable: true, get: function () { return paystack_1.checkSignupUnlock; } });
const VALID_ROLES = new Set(['owner', 'staff']);
const TRIAL_DAYS = 14;
const GRACE_DAYS = 7;
const MILLIS_PER_DAY = 1000 * 60 * 60 * 24;
const BULK_MESSAGE_LIMIT = 1000;
const BULK_MESSAGE_BATCH_LIMIT = 200;
const SMS_SEGMENT_SIZE = 160;
/** ============================================================================
 *  HELPERS
 * ==========================================================================*/
async function verifyOwnerEmail(uid) {
    try {
        const user = await firestore_1.admin.auth().getUser(uid);
        if (!user.emailVerified) {
            await firestore_1.admin.auth().updateUser(uid, { emailVerified: true });
        }
    }
    catch (error) {
        console.warn('[auth] Unable to auto-verify owner email', error);
    }
}
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
                const normalized = (0, phone_1.normalizePhoneE164)(raw);
                phone = normalized ? normalized : null;
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
// optional helper (ok if unused)
function normalizeStoreProfile(profile) {
    let businessName;
    let country;
    let city;
    let phone;
    if (profile && typeof profile === 'object') {
        if ('businessName' in profile) {
            const raw = profile.businessName;
            if (raw === null || raw === undefined || raw === '')
                businessName = null;
            else if (typeof raw === 'string')
                businessName = raw.trim() || null;
            else {
                throw new functions.https.HttpsError('invalid-argument', 'Business name must be a string when provided');
            }
        }
        if ('country' in profile) {
            const raw = profile.country;
            if (raw === null || raw === undefined || raw === '')
                country = null;
            else if (typeof raw === 'string')
                country = raw.trim() || null;
            else {
                throw new functions.https.HttpsError('invalid-argument', 'Country must be a string when provided');
            }
        }
        if ('city' in profile) {
            const raw = profile.city;
            if (raw === null || raw === undefined || raw === '')
                city = null;
            else if (typeof raw === 'string')
                city = raw.trim() || null;
            else {
                throw new functions.https.HttpsError('invalid-argument', 'City must be a string when provided');
            }
        }
        if ('phone' in profile) {
            const raw = profile.phone;
            if (raw === null || raw === undefined || raw === '')
                phone = null;
            else if (typeof raw === 'string')
                phone = (0, phone_1.normalizePhoneE164)(raw) || null;
            else {
                throw new functions.https.HttpsError('invalid-argument', 'Store phone must be a string when provided');
            }
        }
    }
    return { businessName, country, city, phone };
}
function normalizeBulkMessageChannel(value) {
    if (value === 'sms')
        return value;
    throw new functions.https.HttpsError('invalid-argument', 'Channel must be sms');
}
function normalizeBulkMessageRecipients(value) {
    if (!Array.isArray(value)) {
        throw new functions.https.HttpsError('invalid-argument', 'Recipients must be an array');
    }
    return value.map((recipient, index) => {
        if (!recipient || typeof recipient !== 'object') {
            throw new functions.https.HttpsError('invalid-argument', `Recipient at index ${index} must be an object`);
        }
        const raw = recipient;
        const phone = typeof raw.phone === 'string' ? (0, phone_1.normalizePhoneE164)(raw.phone) : '';
        const name = typeof raw.name === 'string' ? raw.name.trim() : undefined;
        if (!phone) {
            throw new functions.https.HttpsError('invalid-argument', `Recipient at index ${index} is missing a phone number`);
        }
        return {
            id: typeof raw.id === 'string' ? raw.id : undefined,
            name,
            phone,
        };
    });
}
function normalizeDialCode(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    return null;
}
function normalizeSmsRateTable(data) {
    if (!data || typeof data !== 'object') {
        throw new functions.https.HttpsError('failed-precondition', 'Bulk SMS rate table is not configured.');
    }
    const defaultGroup = typeof data.defaultGroup === 'string' && data.defaultGroup.trim()
        ? data.defaultGroup.trim()
        : 'ROW';
    const dialCodeToGroup = {};
    if (data.dialCodeToGroup && typeof data.dialCodeToGroup === 'object') {
        Object.entries(data.dialCodeToGroup).forEach(([dialCode, group]) => {
            const normalizedDial = normalizeDialCode(dialCode);
            if (!normalizedDial || typeof group !== 'string' || !group.trim())
                return;
            dialCodeToGroup[normalizedDial] = group.trim();
        });
    }
    const sms = {};
    if (data.sms && typeof data.sms === 'object') {
        Object.entries(data.sms).forEach(([group, rate]) => {
            if (!rate || typeof rate !== 'object')
                return;
            const perSegment = rate.perSegment;
            if (typeof perSegment !== 'number' || !Number.isFinite(perSegment))
                return;
            if (typeof group === 'string' && group.trim()) {
                sms[group.trim()] = { perSegment };
            }
        });
    }
    return { defaultGroup, dialCodeToGroup, sms };
}
function resolveGroupFromPhone(phone, dialCodeToGroup, defaultGroup) {
    if (!phone)
        return defaultGroup;
    const digits = phone.replace(/\D/g, '');
    if (!digits)
        return defaultGroup;
    let matchedGroup = null;
    let matchedLength = 0;
    Object.entries(dialCodeToGroup).forEach(([dialCode, group]) => {
        const normalizedDial = dialCode.replace(/\D/g, '');
        if (!normalizedDial)
            return;
        if (digits.startsWith(normalizedDial) && normalizedDial.length > matchedLength) {
            matchedGroup = group;
            matchedLength = normalizedDial.length;
        }
    });
    return matchedGroup ?? defaultGroup;
}
function normalizeBulkMessagePayload(payload) {
    if (!payload || typeof payload !== 'object') {
        throw new functions.https.HttpsError('invalid-argument', 'Payload is required');
    }
    const storeId = typeof payload.storeId === 'string' ? payload.storeId.trim() : '';
    if (!storeId)
        throw new functions.https.HttpsError('invalid-argument', 'Store id is required');
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!message)
        throw new functions.https.HttpsError('invalid-argument', 'Message is required');
    if (message.length > BULK_MESSAGE_LIMIT) {
        throw new functions.https.HttpsError('invalid-argument', `Message must be ${BULK_MESSAGE_LIMIT} characters or less`);
    }
    const channel = normalizeBulkMessageChannel(payload.channel);
    const recipients = normalizeBulkMessageRecipients(payload.recipients);
    if (recipients.length > BULK_MESSAGE_BATCH_LIMIT) {
        throw new functions.https.HttpsError('invalid-argument', `Recipient list is limited to ${BULK_MESSAGE_BATCH_LIMIT} contacts per send`);
    }
    return { storeId, channel, message, recipients };
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
    if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
}
function assertOwnerAccess(context) {
    assertAuthenticated(context);
    const role = getRoleFromToken(context.auth.token);
    if (role !== 'owner') {
        throw new functions.https.HttpsError('permission-denied', 'Owner access required');
    }
}
async function verifyOwnerForStore(uid, storeId) {
    const memberRef = firestore_1.defaultDb.collection('teamMembers').doc(uid);
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
    if (!role)
        throw new functions.https.HttpsError('permission-denied', 'Staff access required');
}
async function resolveStaffStoreId(uid) {
    const memberRef = firestore_1.defaultDb.collection('teamMembers').doc(uid);
    const memberSnap = await memberRef.get();
    const memberData = (memberSnap.data() ?? {});
    const storeIdRaw = typeof memberData.storeId === 'string' ? memberData.storeId.trim() : '';
    if (!storeIdRaw) {
        throw new functions.https.HttpsError('failed-precondition', 'No store associated with this account');
    }
    return storeIdRaw;
}
async function updateUserClaims(uid, role) {
    const userRecord = await firestore_1.admin.auth().getUser(uid).catch(() => null);
    const existingClaims = (userRecord?.customClaims ?? {});
    const nextClaims = { ...existingClaims, role };
    delete nextClaims.stores;
    delete nextClaims.activeStoreId;
    delete nextClaims.storeId;
    delete nextClaims.roleByStore;
    await firestore_1.admin.auth().setCustomUserClaims(uid, nextClaims);
    return nextClaims;
}
function normalizeManageStaffPayload(data) {
    const storeIdRaw = data.storeId;
    const storeId = typeof storeIdRaw === 'string' ? storeIdRaw.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const role = typeof data.role === 'string' ? data.role.trim() : '';
    const passwordRaw = data.password;
    let password;
    if (passwordRaw === null || passwordRaw === undefined || passwordRaw === '')
        password = undefined;
    else if (typeof passwordRaw === 'string')
        password = passwordRaw;
    else {
        throw new functions.https.HttpsError('invalid-argument', 'Password must be a string when provided');
    }
    if (!storeId)
        throw new functions.https.HttpsError('invalid-argument', 'A storeId is required');
    if (!email)
        throw new functions.https.HttpsError('invalid-argument', 'A valid email is required');
    if (!role)
        throw new functions.https.HttpsError('invalid-argument', 'A role is required');
    if (!VALID_ROLES.has(role))
        throw new functions.https.HttpsError('invalid-argument', 'Unsupported role requested');
    const actionRaw = typeof data.action === 'string' ? data.action.trim() : 'invite';
    const action = ['invite', 'reset', 'deactivate'].includes(actionRaw)
        ? actionRaw
        : 'invite';
    return { storeId, email, role, password, action };
}
function timestampDaysFromNow(days) {
    const now = new Date();
    now.setDate(now.getDate() + days);
    return firestore_1.admin.firestore.Timestamp.fromDate(now);
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
            if (typeof value === 'string')
                return value.trim() || null;
            throw new functions.https.HttpsError('invalid-argument', 'Profile fields must be strings when provided');
        };
        if ('phone' in profile) {
            const normalized = normalize(profile.phone);
            phone = normalized ? (0, phone_1.normalizePhoneE164)(normalized) || null : null;
        }
        if ('ownerName' in profile)
            ownerName = normalize(profile.ownerName);
        if ('businessName' in profile)
            businessName = normalize(profile.businessName);
        if ('country' in profile)
            country = normalize(profile.country);
        if ('city' in profile)
            city = normalize(profile.city);
        if (!city && 'town' in profile)
            city = normalize(profile.town);
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
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    await firestore_1.defaultDb.collection('teamMembers').doc(uid).set({
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
    const memberRef = firestore_1.defaultDb.collection('teamMembers').doc(uid);
    const memberSnap = await memberRef.get();
    const existingData = (memberSnap.data() ?? {});
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
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
    const storeRef = firestore_1.defaultDb.collection('stores').doc(storeId);
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
        const nowTs = firestore_1.admin.firestore.Timestamp.now();
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
            // profile fields
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
        const wsRef = firestore_1.defaultDb.collection('workspaces').doc(storeId);
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
        await verifyOwnerEmail(uid);
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
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const payload = (data ?? {});
    const requestedStoreIdRaw = payload.storeId;
    const requestedStoreId = typeof requestedStoreIdRaw === 'string' ? requestedStoreIdRaw.trim() : '';
    const memberRef = firestore_1.defaultDb.collection('teamMembers').doc(uid);
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
    const storeRef = firestore_1.defaultDb.collection('stores').doc(storeId);
    const storeSnap = await storeRef.get();
    const baseStore = storeSnap.data() ?? {};
    const previousBilling = (baseStore.billing || {});
    const nowTs = firestore_1.admin.firestore.Timestamp.now();
    const paymentStatusRaw = typeof baseStore.paymentStatus === 'string' ? baseStore.paymentStatus : null;
    const trialEndsAt = previousBilling.trialEndsAt ||
        previousBilling.trialEnd ||
        timestampDaysFromNow(TRIAL_DAYS);
    const graceEndsAt = previousBilling.graceEndsAt ||
        previousBilling.graceEnd ||
        timestampDaysFromNow(TRIAL_DAYS + GRACE_DAYS);
    const contractStatusRaw = typeof baseStore.contractStatus === 'string'
        ? baseStore.contractStatus.trim()
        : null;
    const normalizedContractStatus = contractStatusRaw && contractStatusRaw !== ''
        ? contractStatusRaw.toLowerCase()
        : null;
    const billingStatus = previousBilling.status === 'active' || previousBilling.status === 'past_due'
        ? previousBilling.status
        : 'trial';
    const trialDaysRemaining = calculateDaysRemaining(trialEndsAt, nowTs);
    const graceDaysRemaining = calculateDaysRemaining(graceEndsAt, nowTs);
    const trialExpired = (normalizedContractStatus === 'trial' || billingStatus === 'trial') &&
        paymentStatusRaw !== 'active' &&
        trialDaysRemaining !== null &&
        trialDaysRemaining <= 0;
    const normalizedBillingStatus = trialExpired ? 'past_due' : billingStatus;
    const normalizedPaymentStatus = trialExpired
        ? 'past_due'
        : paymentStatusRaw === 'active'
            ? 'active'
            : paymentStatusRaw === 'past_due'
                ? 'past_due'
                : billingStatus;
    const graceExpired = normalizedPaymentStatus === 'past_due' &&
        graceDaysRemaining !== null &&
        graceDaysRemaining <= 0;
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
        contractStatus: contractStatusRaw || baseStore.contractStatus || 'trial',
        productCount: typeof baseStore.productCount === 'number' ? baseStore.productCount : 0,
        totalStockCount: typeof baseStore.totalStockCount === 'number' ? baseStore.totalStockCount : 0,
        createdAt: baseStore.createdAt || timestamp,
        updatedAt: timestamp,
        paymentStatus: normalizedPaymentStatus,
        billing: billingData,
    };
    await storeRef.set(storeData, { merge: true });
    const wsRef = firestore_1.defaultDb.collection('workspaces').doc(storeId);
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
    if (role === 'owner') {
        await verifyOwnerEmail(uid);
    }
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
    if (graceExpired) {
        const graceEndDate = graceEndsAt && typeof graceEndsAt.toDate === 'function'
            ? graceEndsAt.toDate().toISOString().slice(0, 10)
            : 'the end of your billing grace period';
        throw new functions.https.HttpsError('permission-denied', `Your Sedifex subscription is past due and access was suspended on ${graceEndDate}. Update your payment method to regain access.`);
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
    const auditRef = firestore_1.defaultDb.collection('staffAudit').doc();
    const payload = {
        ...entry,
        createdAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
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
        const record = await firestore_1.admin.auth().getUserByEmail(email);
        if (password) {
            await firestore_1.admin.auth().updateUser(record.uid, { password });
        }
        return { record, created: false };
    }
    catch (error) {
        if (error?.code === 'auth/user-not-found') {
            if (!password) {
                throw new functions.https.HttpsError('invalid-argument', 'A password is required when creating a new staff account');
            }
            const record = await firestore_1.admin.auth().createUser({
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
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const getUserOrThrow = async () => {
        try {
            return await firestore_1.admin.auth().getUserByEmail(email);
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
            await firestore_1.admin.auth().updateUser(record.uid, { disabled: false });
            const memberRef = firestore_1.defaultDb.collection('teamMembers').doc(record.uid);
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
            await firestore_1.admin.auth().updateUser(record.uid, { password, disabled: false });
            const memberRef = firestore_1.defaultDb.collection('teamMembers').doc(record.uid);
            await memberRef.set({ uid: record.uid, email, storeId, role, status: 'active', updatedAt: timestamp }, { merge: true });
            claims = await updateUserClaims(record.uid, role);
        }
        else {
            // deactivate
            record = await getUserOrThrow();
            await firestore_1.admin.auth().updateUser(record.uid, { disabled: true });
            const memberRef = firestore_1.defaultDb.collection('teamMembers').doc(record.uid);
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
            const typeRaw = typeof it?.type === 'string' ? it.type.trim().toLowerCase() : null;
            const type = typeRaw === 'service'
                ? 'service'
                : typeRaw === 'made_to_order'
                    ? 'made_to_order'
                    : typeRaw === 'product'
                        ? 'product'
                        : null;
            const isService = it?.isService === true || type === 'service';
            const prepDate = typeof it?.prepDate === 'string' && it.prepDate.trim() ? it.prepDate : null;
            return { productId, name, qty, price, taxRate, type, isService, prepDate };
        })
        : [];
    // Validate products before we even touch Firestore
    for (const it of normalizedItems) {
        if (!it.productId) {
            throw new functions.https.HttpsError('failed-precondition', 'Bad product');
        }
    }
    const saleRef = firestore_1.defaultDb.collection('sales').doc(saleId);
    const saleItemsRef = firestore_1.defaultDb.collection('saleItems');
    await firestore_1.defaultDb.runTransaction(async (tx) => {
        // 1️⃣ ALL READS FIRST
        // prevent duplicates
        const existingSale = await tx.get(saleRef);
        if (existingSale.exists) {
            throw new functions.https.HttpsError('already-exists', 'Sale has already been committed');
        }
        // product docs
        const productSnaps = {};
        const productRefs = {};
        for (const it of normalizedItems) {
            const productId = it.productId;
            const pRef = firestore_1.defaultDb.collection('products').doc(productId);
            productRefs[productId] = pRef;
            const pSnap = await tx.get(pRef);
            if (!pSnap.exists) {
                throw new functions.https.HttpsError('failed-precondition', 'Bad product');
            }
            productSnaps[productId] = pSnap;
        }
        // 2️⃣ THEN ALL WRITES
        const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
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
            const itemId = firestore_1.defaultDb.collection('_').doc().id;
            tx.set(saleItemsRef.doc(itemId), {
                saleId,
                productId,
                qty: it.qty,
                price: it.price,
                taxRate: it.taxRate,
                type: it.type,
                isService: it.isService === true,
                prepDate: it.prepDate ?? null,
                storeId: normalizedBranchId,
                createdAt: timestamp,
            });
            const isInventoryTracked = it.type !== 'service' && it.type !== 'made_to_order';
            if (isInventoryTracked) {
                const pRef = productRefs[productId];
                const pSnap = productSnaps[productId];
                const curr = Number(pSnap.get('stockCount') || 0);
                const next = curr - Math.abs(it.qty || 0);
                tx.update(pRef, { stockCount: next, updatedAt: timestamp });
                const ledgerId = firestore_1.defaultDb.collection('_').doc().id;
                tx.set(firestore_1.defaultDb.collection('ledger').doc(ledgerId), {
                    productId,
                    qtyChange: -Math.abs(it.qty || 0),
                    type: 'sale',
                    refId: saleId,
                    storeId: normalizedBranchId,
                    createdAt: timestamp,
                });
            }
        }
    });
    return { ok: true, saleId };
});
/** ============================================================================
 *  CALLABLE: logReceiptShare (staff)
 * ==========================================================================*/
const RECEIPT_CHANNELS = new Set(['email', 'sms', 'whatsapp']);
const RECEIPT_STATUSES = new Set(['attempt', 'failed', 'sent']);
const RECEIPT_SHARE_CHANNELS = new Set(['email', 'sms', 'whatsapp']);
const RECEIPT_SHARE_STATUSES = new Set(['success', 'failure']);
const REMINDER_CHANNELS = new Set(['email', 'telegram', 'whatsapp']);
const REMINDER_STATUSES = new Set(['attempt', 'failed', 'sent']);
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
/** ============================================================================
 *  CALLABLE: logReceiptShareAttempt (staff)
 * ==========================================================================*/
function maskDestination(destination) {
    const trimmed = destination.trim();
    if (!trimmed)
        return null;
    const last4 = trimmed.slice(-4);
    if (trimmed.length <= 4)
        return { masked: `****${last4}`, last4 };
    const mask = '*'.repeat(Math.max(0, trimmed.length - 4));
    return { masked: `${mask}${last4}`, last4 };
}
exports.logReceiptShareAttempt = functions.https.onCall(async (data, context) => {
    assertStaffAccess(context);
    const uid = context.auth.uid;
    const storeId = await resolveStaffStoreId(uid);
    const saleId = typeof data?.saleId === 'string' ? data.saleId.trim() : '';
    const receiptId = typeof data?.receiptId === 'string' ? data.receiptId.trim() : '';
    const channel = typeof data?.channel === 'string' ? data.channel.trim() : '';
    const status = typeof data?.status === 'string' ? data.status.trim() : '';
    const destination = typeof data?.destination === 'string' ? data.destination.trim() : '';
    if (!saleId && !receiptId) {
        throw new functions.https.HttpsError('invalid-argument', 'saleId or receiptId is required');
    }
    if (!RECEIPT_SHARE_CHANNELS.has(channel)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid channel');
    }
    if (!RECEIPT_SHARE_STATUSES.has(status)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid status');
    }
    if (!destination) {
        throw new functions.https.HttpsError('invalid-argument', 'destination is required');
    }
    const errorMessageRaw = data?.errorMessage;
    const errorMessage = errorMessageRaw === null || errorMessageRaw === undefined
        ? null
        : typeof errorMessageRaw === 'string'
            ? errorMessageRaw.trim() || null
            : (() => {
                throw new functions.https.HttpsError('invalid-argument', 'errorMessage must be a string when provided');
            })();
    const masked = maskDestination(destination);
    if (!masked) {
        throw new functions.https.HttpsError('invalid-argument', 'destination is required');
    }
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const payload = {
        storeId,
        saleId: saleId || null,
        receiptId: receiptId || null,
        channel,
        status,
        destinationMasked: masked.masked,
        destinationLast4: masked.last4,
        errorMessage,
        actorUid: uid,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    const ref = firestore_1.defaultDb
        .collection('stores')
        .doc(storeId)
        .collection('receiptShareAttempts')
        .doc();
    await ref.set(payload);
    return { ok: true, attemptId: ref.id };
});
/** ============================================================================
 *  CALLABLE: logPaymentReminder (staff)
 * ==========================================================================*/
exports.logPaymentReminder = functions.https.onCall(async (data, context) => {
    assertStaffAccess(context);
    const storeId = typeof data?.storeId === 'string' ? data.storeId.trim() : '';
    const customerId = typeof data?.customerId === 'string' ? data.customerId.trim() : '';
    const channel = typeof data?.channel === 'string' ? data.channel.trim() : '';
    const status = typeof data?.status === 'string' ? data.status.trim() : '';
    if (!storeId || !customerId) {
        throw new functions.https.HttpsError('invalid-argument', 'storeId and customerId are required');
    }
    if (!REMINDER_CHANNELS.has(channel)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid channel');
    }
    if (!REMINDER_STATUSES.has(status)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid status');
    }
    const customerNameRaw = data?.customerName;
    const customerName = customerNameRaw === null || customerNameRaw === undefined
        ? null
        : typeof customerNameRaw === 'string'
            ? customerNameRaw.trim() || null
            : (() => {
                throw new functions.https.HttpsError('invalid-argument', 'customerName must be a string when provided');
            })();
    const templateIdRaw = data?.templateId;
    const templateId = templateIdRaw === null || templateIdRaw === undefined
        ? null
        : typeof templateIdRaw === 'string'
            ? templateIdRaw.trim() || null
            : (() => {
                throw new functions.https.HttpsError('invalid-argument', 'templateId must be a string when provided');
            })();
    const amountCentsRaw = data?.amountCents;
    const amountCents = amountCentsRaw === null || amountCentsRaw === undefined
        ? null
        : Number.isFinite(Number(amountCentsRaw))
            ? Number(amountCentsRaw)
            : (() => {
                throw new functions.https.HttpsError('invalid-argument', 'amountCents must be a number when provided');
            })();
    const dueDateRaw = data?.dueDate;
    const dueDate = (() => {
        if (dueDateRaw === null || dueDateRaw === undefined)
            return null;
        if (typeof dueDateRaw === 'string' || typeof dueDateRaw === 'number') {
            const parsed = new Date(dueDateRaw);
            if (Number.isNaN(parsed.getTime())) {
                throw new functions.https.HttpsError('invalid-argument', 'dueDate must be a valid date');
            }
            return firestore_1.admin.firestore.Timestamp.fromDate(parsed);
        }
        throw new functions.https.HttpsError('invalid-argument', 'dueDate must be a string or number when provided');
    })();
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const payload = {
        storeId,
        customerId,
        customerName,
        templateId,
        channel,
        status,
        amountCents,
        dueDate,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    const ref = await firestore_1.defaultDb.collection('paymentReminderLogs').add(payload);
    return { ok: true, reminderId: ref.id };
});
/** ============================================================================
 *  HUBTEL BULK MESSAGING
 * ==========================================================================*/
const HUBTEL_CLIENT_ID = (0, params_1.defineString)('HUBTEL_CLIENT_ID');
const HUBTEL_CLIENT_SECRET = (0, params_1.defineString)('HUBTEL_CLIENT_SECRET');
const HUBTEL_SENDER_ID = (0, params_1.defineString)('HUBTEL_SENDER_ID');
let hubtelConfigLogged = false;
function getHubtelConfig() {
    const clientId = HUBTEL_CLIENT_ID.value();
    const clientSecret = HUBTEL_CLIENT_SECRET.value();
    const senderId = HUBTEL_SENDER_ID.value();
    if (!hubtelConfigLogged) {
        console.log('[hubtel] startup config', {
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            hasSenderId: !!senderId,
        });
        hubtelConfigLogged = true;
    }
    return { clientId, clientSecret, senderId };
}
function ensureHubtelConfig() {
    const config = getHubtelConfig();
    if (!config.clientId || !config.clientSecret) {
        console.error('[hubtel] Missing client id or client secret');
        throw new functions.https.HttpsError('failed-precondition', 'Hubtel is not configured. Please contact support.');
    }
    if (!config.senderId) {
        throw new functions.https.HttpsError('failed-precondition', 'Hubtel sender ID is not configured.');
    }
    return config;
}
function formatSmsAddress(phone) {
    const trimmed = phone.trim();
    if (!trimmed)
        return trimmed;
    const normalized = (0, phone_1.normalizePhoneE164)(trimmed);
    return normalized ?? '';
}
async function sendHubtelMessage(options) {
    const { clientId, clientSecret, to, from, body } = options;
    const url = 'https://sms.hubtel.com/v1/messages/send';
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const payload = {
        From: from,
        To: to,
        Content: body,
    };
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Hubtel error ${response.status}: ${errorText}`);
    }
    return response.json();
}
exports.sendBulkMessage = functions.https.onCall(async (data, context) => {
    assertOwnerAccess(context);
    const { storeId, message, recipients } = normalizeBulkMessagePayload(data);
    await verifyOwnerForStore(context.auth.uid, storeId);
    const rateSnap = await firestore_1.defaultDb.collection('config').doc('hubtelRates').get();
    const legacyRateSnap = rateSnap.exists
        ? null
        : await firestore_1.defaultDb.collection('config').doc('twilioRates').get();
    const rateTable = normalizeSmsRateTable(rateSnap.data() ?? legacyRateSnap?.data());
    const getSmsRate = (group) => {
        const rate = rateTable.sms[group]?.perSegment;
        if (typeof rate !== 'number' || !Number.isFinite(rate)) {
            throw new functions.https.HttpsError('failed-precondition', `SMS rate missing for group ${group}.`);
        }
        return rate;
    };
    const segments = Math.ceil(message.length / SMS_SEGMENT_SIZE);
    const getRecipientCost = (recipient) => {
        const group = resolveGroupFromPhone(recipient.phone, rateTable.dialCodeToGroup, rateTable.defaultGroup);
        return segments * getSmsRate(group);
    };
    const creditCosts = recipients.map(recipient => getRecipientCost(recipient));
    const creditsRequired = creditCosts.reduce((total, cost) => total + cost, 0);
    const storeRef = firestore_1.defaultDb.collection('stores').doc(storeId);
    const config = ensureHubtelConfig();
    const from = config.senderId;
    // debit credits first
    await firestore_1.defaultDb.runTransaction(async (transaction) => {
        const storeSnap = await transaction.get(storeRef);
        if (!storeSnap.exists) {
            throw new functions.https.HttpsError('not-found', 'Store not found for this bulk messaging request.');
        }
        const storeData = storeSnap.data() ?? {};
        const rawCredits = storeData.bulkMessagingCredits;
        const currentCredits = typeof rawCredits === 'number' && Number.isFinite(rawCredits) ? rawCredits : 0;
        if (currentCredits < creditsRequired) {
            throw new functions.https.HttpsError('failed-precondition', 'You do not have enough bulk messaging credits. Please buy more to continue.');
        }
        transaction.update(storeRef, {
            bulkMessagingCredits: currentCredits - creditsRequired,
            updatedAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
        });
    });
    const attempted = recipients.length;
    const results = await Promise.allSettled(recipients.map(async (recipient) => {
        const to = formatSmsAddress(recipient.phone ?? '');
        if (!to)
            throw new Error('Missing recipient phone');
        await sendHubtelMessage({
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            to,
            from,
            body: message,
        });
        return { phone: recipient.phone ?? '' };
    }));
    const failures = results
        .map((result, index) => {
        if (result.status === 'fulfilled')
            return null;
        const phone = recipients[index]?.phone ?? '';
        const errorMessage = result.reason instanceof Error
            ? result.reason.message
            : typeof result.reason === 'string'
                ? result.reason
                : 'Unknown error';
        return { phone, error: errorMessage, index };
    })
        .filter(Boolean);
    const sent = attempted - failures.length;
    // refund failed recipients
    const refundCredits = failures.reduce((total, failure) => total + (creditCosts[failure.index] ?? 0), 0);
    if (refundCredits > 0) {
        await storeRef.update({
            bulkMessagingCredits: firestore_1.admin.firestore.FieldValue.increment(refundCredits),
            updatedAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    return {
        ok: true,
        attempted,
        sent,
        failures: failures.map(({ phone, error }) => ({ phone, error })),
    };
});
/** ============================================================================
 *  PAYSTACK HELPERS
 * ==========================================================================*/
const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const PAYSTACK_SECRET_KEY = (0, params_1.defineString)('PAYSTACK_SECRET_KEY');
const PAYSTACK_PUBLIC_KEY = (0, params_1.defineString)('PAYSTACK_PUBLIC_KEY');
// Legacy: was a single plan code for all checkouts. Kept for backwards compatibility.
const PAYSTACK_STANDARD_PLAN_CODE = (0, params_1.defineString)('PAYSTACK_STANDARD_PLAN_CODE');
// New: map frontend plan keys -> Paystack plan codes (optional).
const PAYSTACK_STARTER_MONTHLY_PLAN_CODE = (0, params_1.defineString)('PAYSTACK_STARTER_MONTHLY_PLAN_CODE');
const PAYSTACK_STARTER_YEARLY_PLAN_CODE = (0, params_1.defineString)('PAYSTACK_STARTER_YEARLY_PLAN_CODE');
const PAYSTACK_CURRENCY = (0, params_1.defineString)('PAYSTACK_CURRENCY');
// Fixed packages (GHS)
const BULK_CREDITS_PACKAGES = {
    '100': { credits: 100, amount: 50 },
    '500': { credits: 500, amount: 230 },
    '1000': { credits: 1000, amount: 430 },
};
let paystackConfigLogged = false;
function getPaystackConfig() {
    const secret = PAYSTACK_SECRET_KEY.value();
    const publicKey = PAYSTACK_PUBLIC_KEY.value();
    const currency = PAYSTACK_CURRENCY.value() || 'GHS';
    const starterMonthly = PAYSTACK_STARTER_MONTHLY_PLAN_CODE.value() || PAYSTACK_STANDARD_PLAN_CODE.value();
    const starterYearly = PAYSTACK_STARTER_YEARLY_PLAN_CODE.value();
    if (!paystackConfigLogged) {
        console.log('[paystack] startup config', {
            hasSecret: !!secret,
            hasPublicKey: !!publicKey,
            currency,
            hasStarterMonthlyPlan: !!starterMonthly,
            hasStarterYearlyPlan: !!starterYearly,
        });
        paystackConfigLogged = true;
    }
    return {
        secret,
        publicKey,
        currency,
        plans: {
            'starter-monthly': starterMonthly,
            'starter-yearly': starterYearly,
        },
    };
}
function ensurePaystackConfig() {
    const config = getPaystackConfig();
    if (!config.secret) {
        console.error('[paystack] Missing PAYSTACK_SECRET_KEY env');
        throw new functions.https.HttpsError('failed-precondition', 'Paystack is not configured. Please contact support.');
    }
    return config;
}
function toMinorUnits(amount) {
    return Math.round(Math.abs(amount) * 100);
}
function resolvePlanKey(raw) {
    if (typeof raw !== 'string')
        return null;
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
}
function resolveBulkCreditsPackage(raw) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const key = String(raw);
        return BULK_CREDITS_PACKAGES[key] ? key : null;
    }
    if (typeof raw !== 'string')
        return null;
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    return BULK_CREDITS_PACKAGES[trimmed] ? trimmed : null;
}
function resolvePlanMonths(planKey) {
    if (!planKey)
        return 1;
    const lower = planKey.toLowerCase();
    if (lower.includes('year'))
        return 12;
    if (lower.includes('annual'))
        return 12;
    if (lower.includes('month'))
        return 1;
    return 1;
}
function addMonths(base, months) {
    const d = new Date(base.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day)
        d.setDate(0);
    return d;
}
function resolvePaystackPlanCode(planKey, config) {
    if (!planKey)
        return undefined;
    const key = String(planKey).toLowerCase();
    return config.plans[key];
}
/** ============================================================================
 *  CALLABLE: createPaystackCheckout (subscription)
 * ==========================================================================*/
exports.createPaystackCheckout = functions.https.onCall(async (data, context) => {
    assertOwnerAccess(context);
    const paystackConfig = ensurePaystackConfig();
    const uid = context.auth.uid;
    const token = context.auth.token;
    const tokenEmail = typeof token.email === 'string' ? token.email : null;
    const payload = (data ?? {});
    const requestedStoreId = typeof payload.storeId === 'string' ? payload.storeId.trim() : '';
    const memberRef = firestore_1.defaultDb.collection('teamMembers').doc(uid);
    const memberSnap = await memberRef.get();
    const memberData = (memberSnap.data() ?? {});
    let resolvedStoreId = '';
    if (requestedStoreId) {
        resolvedStoreId = requestedStoreId;
    }
    else if (typeof memberData.storeId === 'string' && memberData.storeId.trim() !== '') {
        resolvedStoreId = memberData.storeId;
    }
    else {
        resolvedStoreId = uid;
    }
    const storeId = resolvedStoreId;
    const storeRef = firestore_1.defaultDb.collection('stores').doc(storeId);
    const storeSnap = await storeRef.get();
    const storeData = (storeSnap.data() ?? {});
    const billing = (storeData.billing || {});
    const emailInput = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const email = emailInput || tokenEmail || storeData.ownerEmail || null;
    if (!email) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing owner email. Please sign in again.');
    }
    const planKey = resolvePlanKey(payload.plan) ||
        resolvePlanKey(payload.planId) ||
        resolvePlanKey(payload.planKey) ||
        'starter-monthly';
    const amountInput = Number(payload.amount);
    const amountGhs = Number.isFinite(amountInput) && amountInput > 0
        ? amountInput
        : planKey.toLowerCase().includes('year')
            ? 1100
            : 100;
    const amountMinorUnits = toMinorUnits(amountGhs);
    const reference = `${storeId}_${Date.now()}`;
    const callbackUrl = typeof payload.redirectUrl === 'string'
        ? payload.redirectUrl
        : typeof payload.returnUrl === 'string'
            ? payload.returnUrl
            : undefined;
    const metadataIn = payload.metadata && typeof payload.metadata === 'object'
        ? payload.metadata
        : {};
    // ✅ UPDATED: only attach callback_url if it's provided
    const body = {
        email,
        amount: amountMinorUnits,
        currency: paystackConfig.currency,
        reference,
        metadata: {
            storeId,
            userId: uid,
            planKey,
            ...metadataIn,
        },
    };
    if (callbackUrl) {
        body.callback_url = callbackUrl;
    }
    const planCode = resolvePaystackPlanCode(planKey, paystackConfig);
    if (planCode)
        body.plan = planCode;
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
    const authUrl = responseJson.data && typeof responseJson.data.authorization_url === 'string'
        ? responseJson.data.authorization_url
        : null;
    if (!authUrl) {
        throw new functions.https.HttpsError('unknown', 'Paystack did not return a valid authorization URL.');
    }
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    await storeRef.set({
        billing: {
            ...(billing || {}),
            provider: 'paystack',
            planKey,
            status: typeof billing.status === 'string' && billing.status === 'active'
                ? billing.status
                : 'pending',
            currency: paystackConfig.currency,
            lastCheckoutUrl: authUrl,
            lastCheckoutAt: timestamp,
            lastChargeReference: reference,
        },
        paymentProvider: 'paystack',
        paymentStatus: 'pending',
        contractStatus: 'pending',
    }, { merge: true });
    await firestore_1.defaultDb.collection('subscriptions').doc(storeId).set({
        provider: 'paystack',
        status: 'pending',
        plan: planKey,
        reference,
        amount: amountGhs,
        currency: paystackConfig.currency,
        email,
        lastCheckoutUrl: authUrl,
        lastCheckoutAt: timestamp,
        createdAt: timestamp,
        createdBy: uid,
    }, { merge: true });
    return {
        ok: true,
        authorizationUrl: authUrl,
        reference,
        publicKey: paystackConfig.publicKey || null,
    };
});
// Alias so frontend name still works
exports.createCheckout = exports.createPaystackCheckout;
/** ============================================================================
 *  CALLABLE: createBulkCreditsCheckout (bulk messaging credits)
 * ==========================================================================*/
exports.createBulkCreditsCheckout = functions.https.onCall(async (data, context) => {
    assertOwnerAccess(context);
    const paystackConfig = ensurePaystackConfig();
    const payload = (data ?? {});
    const storeId = typeof payload.storeId === 'string' ? payload.storeId.trim() : '';
    if (!storeId) {
        throw new functions.https.HttpsError('invalid-argument', 'storeId is required.');
    }
    await verifyOwnerForStore(context.auth.uid, storeId);
    const packageKey = resolveBulkCreditsPackage(payload.package);
    if (!packageKey) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid bulk credits package.');
    }
    const pkg = BULK_CREDITS_PACKAGES[packageKey];
    const storeSnap = await firestore_1.defaultDb.collection('stores').doc(storeId).get();
    const storeData = (storeSnap.data() ?? {});
    const token = context.auth.token;
    const tokenEmail = typeof token.email === 'string' ? token.email : null;
    const email = tokenEmail ||
        (typeof storeData.ownerEmail === 'string' ? storeData.ownerEmail : null);
    if (!email) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing owner email. Please sign in again.');
    }
    const reference = `${storeId}_bulk_credits_${Date.now()}`;
    const callbackUrl = typeof payload.redirectUrl === 'string'
        ? String(payload.redirectUrl)
        : typeof payload.returnUrl === 'string'
            ? String(payload.returnUrl)
            : undefined;
    const extraMetadata = payload.metadata && typeof payload.metadata === 'object'
        ? payload.metadata
        : {};
    const body = {
        email,
        amount: toMinorUnits(pkg.amount),
        currency: paystackConfig.currency,
        reference,
        metadata: {
            storeId,
            userId: context.auth.uid,
            kind: 'bulk_credits',
            package: packageKey,
            credits: pkg.credits,
            ...extraMetadata,
        },
    };
    // Only attach callback_url if provided
    if (callbackUrl) {
        body.callback_url = callbackUrl;
    }
    // Optional: store a pending record for debugging + later idempotency
    const ts = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    await firestore_1.defaultDb.collection('bulkCreditsPurchases').doc(reference).set({
        storeId,
        userId: context.auth.uid,
        email,
        package: packageKey,
        credits: pkg.credits,
        amount: pkg.amount,
        currency: paystackConfig.currency,
        status: 'pending',
        createdAt: ts,
        updatedAt: ts,
    }, { merge: true });
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
            console.error('[paystack] bulk credits initialize failed', responseJson);
            throw new functions.https.HttpsError('unknown', 'Unable to start checkout with Paystack.');
        }
    }
    catch (error) {
        console.error('[paystack] bulk credits initialize error', error);
        throw new functions.https.HttpsError('unknown', 'Unable to start checkout with Paystack.');
    }
    const authUrl = responseJson.data && typeof responseJson.data.authorization_url === 'string'
        ? responseJson.data.authorization_url
        : null;
    if (!authUrl) {
        throw new functions.https.HttpsError('unknown', 'Paystack did not return a valid authorization URL.');
    }
    // Save checkout url for debugging
    await firestore_1.defaultDb.collection('bulkCreditsPurchases').doc(reference).set({
        checkoutUrl: authUrl,
        updatedAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
        ok: true,
        authorizationUrl: authUrl,
        reference,
        package: packageKey,
        credits: pkg.credits,
    };
});
/** ============================================================================
 *  HTTP: handlePaystackWebhook
 * ==========================================================================*/
exports.handlePaystackWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    const paystackConfig = getPaystackConfig();
    const paystackSecret = paystackConfig.secret;
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
    const hash = crypto.createHmac('sha512', paystackSecret).update(rawBody).digest('hex');
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
            const reference = typeof data.reference === 'string' ? data.reference : null;
            const storeId = typeof metadata.storeId === 'string' ? metadata.storeId.trim() : '';
            const kind = typeof metadata.kind === 'string' ? metadata.kind.trim() : null;
            // ✅ BULK CREDITS FLOW
            if (kind === 'bulk_credits') {
                if (!storeId) {
                    console.warn('[paystack] bulk_credits missing storeId in metadata');
                    res.status(200).send('ok');
                    return;
                }
                const creditsRaw = metadata.credits;
                const credits = typeof creditsRaw === 'number' && Number.isFinite(creditsRaw) ? creditsRaw : Number(creditsRaw);
                if (!Number.isFinite(credits) || credits <= 0) {
                    console.warn('[paystack] bulk_credits missing/invalid credits in metadata', metadata);
                    res.status(200).send('ok');
                    return;
                }
                // idempotency (avoid double credit)
                const eventId = reference || `${storeId}_bulk_${Date.now()}`;
                const eventRef = firestore_1.defaultDb.collection('paystackEvents').doc(eventId);
                const storeRef = firestore_1.defaultDb.collection('stores').doc(storeId);
                await firestore_1.defaultDb.runTransaction(async (tx) => {
                    const existing = await tx.get(eventRef);
                    if (existing.exists)
                        return;
                    tx.set(eventRef, {
                        kind: 'bulk_credits',
                        storeId,
                        credits,
                        reference: reference || null,
                        createdAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
                    });
                    tx.set(storeRef, {
                        bulkMessagingCredits: firestore_1.admin.firestore.FieldValue.increment(credits),
                        updatedAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
                    }, { merge: true });
                });
                res.status(200).send('ok');
                return;
            }
            // ✅ SUBSCRIPTION FLOW (existing)
            if (!storeId) {
                console.warn('[paystack] charge.success missing storeId in metadata');
                res.status(200).send('ok');
                return;
            }
            const storeRef = firestore_1.defaultDb.collection('stores').doc(storeId);
            const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
            const customer = data.customer || {};
            const subscription = data.subscription || {};
            const plan = data.plan || {};
            await storeRef.set({
                billing: {
                    provider: 'paystack',
                    planKey: resolvePlanKey(metadata.planKey) ||
                        resolvePlanKey(metadata.plan) ||
                        resolvePlanKey(metadata.planId) ||
                        'starter-monthly',
                    status: 'active',
                    currency: paystackConfig.currency,
                    paystackCustomerCode: customer.customer_code || null,
                    paystackSubscriptionCode: subscription.subscription_code || null,
                    paystackPlanCode: (plan && typeof plan.plan_code === 'string' && plan.plan_code) ||
                        resolvePaystackPlanCode(resolvePlanKey(metadata.planKey) ||
                            resolvePlanKey(metadata.plan) ||
                            resolvePlanKey(metadata.planId), paystackConfig) ||
                        null,
                    currentPeriodStart: firestore_1.admin.firestore.Timestamp.fromDate(new Date(typeof data.paid_at === 'string' ? data.paid_at : Date.now())),
                    currentPeriodEnd: firestore_1.admin.firestore.Timestamp.fromDate(addMonths(new Date(typeof data.paid_at === 'string' ? data.paid_at : Date.now()), resolvePlanMonths(resolvePlanKey(metadata.planKey) ||
                        resolvePlanKey(metadata.plan) ||
                        resolvePlanKey(metadata.planId)))),
                    lastPaymentAt: firestore_1.admin.firestore.Timestamp.fromDate(new Date(typeof data.paid_at === 'string' ? data.paid_at : Date.now())),
                    lastEventAt: timestamp,
                    lastChargeReference: data.reference || null,
                    amountPaid: typeof data.amount === 'number' ? data.amount / 100 : null,
                },
                paymentStatus: 'active',
                contractStatus: 'active',
                contractEnd: firestore_1.admin.firestore.Timestamp.fromDate(addMonths(new Date(typeof data.paid_at === 'string' ? data.paid_at : Date.now()), resolvePlanMonths(resolvePlanKey(metadata.planKey) ||
                    resolvePlanKey(metadata.plan) ||
                    resolvePlanKey(metadata.planId)))),
            }, { merge: true });
            await firestore_1.defaultDb.collection('subscriptions').doc(storeId).set({
                provider: 'paystack',
                status: 'active',
                plan: resolvePlanKey(metadata.planKey) ||
                    resolvePlanKey(metadata.plan) ||
                    resolvePlanKey(metadata.planId) ||
                    'starter-monthly',
                reference: data.reference || null,
                amount: typeof data.amount === 'number' ? data.amount / 100 : null,
                currency: paystackConfig.currency,
                currentPeriodStart: firestore_1.admin.firestore.Timestamp.fromDate(new Date(typeof data.paid_at === 'string' ? data.paid_at : Date.now())),
                currentPeriodEnd: firestore_1.admin.firestore.Timestamp.fromDate(addMonths(new Date(typeof data.paid_at === 'string' ? data.paid_at : Date.now()), resolvePlanMonths(resolvePlanKey(metadata.planKey) ||
                    resolvePlanKey(metadata.plan) ||
                    resolvePlanKey(metadata.planId)))),
                lastPaymentAt: firestore_1.admin.firestore.Timestamp.fromDate(new Date(typeof data.paid_at === 'string' ? data.paid_at : Date.now())),
                updatedAt: timestamp,
                lastEvent: eventName,
            }, { merge: true });
        }
        res.status(200).send('ok');
    }
    catch (error) {
        console.error('[paystack] webhook handling error', error);
        res.status(500).send('error');
    }
});
