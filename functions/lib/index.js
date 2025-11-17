"use strict";
// functions/src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Billing config (plans & trial)
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
exports.logReceiptShareAttempt = exports.prepareReceiptShare = exports.receiveStock = exports.commitSale = exports.manageStaffAccount = exports.resolveStoreAccess = exports.initializeStore = exports.handleUserCreate = exports.checkSignupUnlock = exports.paystackWebhook = exports.createCheckout = exports.confirmPayment = exports.onAuthCreate = void 0;
// Core imports first
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("./firestore");
const pdf_1 = require("./utils/pdf");
// Billing config (plans & trial)
const plans_1 = require("./plans");
// Paystack billing functions
const paystack_1 = require("./paystack");
Object.defineProperty(exports, "createCheckout", { enumerable: true, get: function () { return paystack_1.createCheckout; } });
Object.defineProperty(exports, "paystackWebhook", { enumerable: true, get: function () { return paystack_1.paystackWebhook; } });
Object.defineProperty(exports, "checkSignupUnlock", { enumerable: true, get: function () { return paystack_1.checkSignupUnlock; } });
// Re-export triggers so Firebase can discover them
var onAuthCreate_1 = require("./onAuthCreate");
Object.defineProperty(exports, "onAuthCreate", { enumerable: true, get: function () { return onAuthCreate_1.onAuthCreate; } });
var confirmPayment_1 = require("./confirmPayment");
Object.defineProperty(exports, "confirmPayment", { enumerable: true, get: function () { return confirmPayment_1.confirmPayment; } });
function serializeError(error) {
    if (error instanceof functions.https.HttpsError) {
        return {
            message: error.message,
            code: error.code,
            details: error.details,
            stack: error.stack,
        };
    }
    if (error instanceof Error) {
        return { message: error.message, name: error.name, stack: error.stack };
    }
    return error;
}
function logCallableError(functionName, error, context, data) {
    functions.logger.error(`${functionName} callable failed`, {
        error: serializeError(error),
        uid: context.auth?.uid ?? null,
        hasAuth: Boolean(context.auth),
        data,
    });
}
const db = firestore_1.defaultDb;
const VALID_ROLES = new Set(['owner', 'staff']);
const VALID_PLAN_IDS = new Set(plans_1.PLAN_IDS);
function normalizePlanId(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed)
        return null;
    return VALID_PLAN_IDS.has(trimmed) ? trimmed : null;
}
function toTimestamp(value) {
    if (!value)
        return null;
    if (typeof value === 'object' && value !== null) {
        if (typeof value.toMillis === 'function') {
            return value;
        }
        const millis = value._millis;
        if (typeof millis === 'number') {
            return firestore_1.admin.firestore.Timestamp.fromMillis(millis);
        }
    }
    return null;
}
function isTimestamp(value) {
    return toTimestamp(value) !== null;
}
function normalizeWorkspaceSlug(value, fallback) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
            return trimmed;
        }
    }
    return fallback;
}
function normalizeContactPayload(contact) {
    let hasPhone = false;
    let hasFirstSignupEmail = false;
    let hasOwnerName = false;
    let hasBusinessName = false;
    let hasCountry = false;
    let hasTown = false;
    let hasSignupRole = false;
    let phone;
    let firstSignupEmail;
    let ownerName;
    let businessName;
    let country;
    let town;
    let signupRole;
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
        if ('country' in contact) {
            hasCountry = true;
            const raw = contact.country;
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
        if ('town' in contact) {
            hasTown = true;
            const raw = contact.town;
            if (raw === null || raw === undefined || raw === '') {
                town = null;
            }
            else if (typeof raw === 'string') {
                const trimmed = raw.trim();
                town = trimmed ? trimmed : null;
            }
            else {
                throw new functions.https.HttpsError('invalid-argument', 'Town must be a string when provided');
            }
        }
        if ('signupRole' in contact) {
            hasSignupRole = true;
            const raw = contact.signupRole;
            if (raw === null || raw === undefined || raw === '') {
                signupRole = null;
            }
            else if (typeof raw === 'string') {
                const normalized = raw.trim().toLowerCase().replace(/[_\s]+/g, '-');
                if (normalized === 'owner') {
                    signupRole = 'owner';
                }
                else if (normalized === 'team-member' || normalized === 'team') {
                    signupRole = 'team-member';
                }
                else {
                    signupRole = null;
                }
            }
            else {
                throw new functions.https.HttpsError('invalid-argument', 'Signup role must be a string when provided');
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
        country,
        hasCountry,
        town,
        hasTown,
        signupRole,
        hasSignupRole,
    };
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
function assertStaffAccess(context) {
    assertAuthenticated(context);
    const role = getRoleFromToken(context.auth.token);
    if (!role) {
        throw new functions.https.HttpsError('permission-denied', 'Staff access required');
    }
}
async function updateUserClaims(uid, role) {
    const userRecord = await firestore_1.admin
        .auth()
        .getUser(uid)
        .catch(() => null);
    const existingClaims = (userRecord?.customClaims ?? {});
    const nextClaims = { ...existingClaims };
    nextClaims.role = role;
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
    if (passwordRaw === null || passwordRaw === undefined || passwordRaw === '') {
        password = undefined;
    }
    else if (typeof passwordRaw === 'string') {
        password = passwordRaw;
    }
    else {
        throw new functions.https.HttpsError('invalid-argument', 'Password must be a string when provided');
    }
    if (!storeId)
        throw new functions.https.HttpsError('invalid-argument', 'A storeId is required');
    if (!email)
        throw new functions.https.HttpsError('invalid-argument', 'A valid email is required');
    if (!role)
        throw new functions.https.HttpsError('invalid-argument', 'A role is required');
    if (!VALID_ROLES.has(role)) {
        throw new functions.https.HttpsError('invalid-argument', 'Unsupported role requested');
    }
    return { storeId, email, role, password };
}
async function ensureAuthUser(email, password) {
    try {
        const record = await firestore_1.admin.auth().getUserByEmail(email);
        if (password)
            await firestore_1.admin.auth().updateUser(record.uid, { password });
        return { record, created: false };
    }
    catch (error) {
        if (error?.code === 'auth/user-not-found') {
            if (!password) {
                throw new functions.https.HttpsError('invalid-argument', 'A password is required when creating a new staff account');
            }
            const record = await firestore_1.admin.auth().createUser({ email, password, emailVerified: false });
            return { record, created: true };
        }
        throw error;
    }
}
function getOptionalString(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
            return trimmed;
        }
    }
    return null;
}
function getOptionalEmail(value) {
    const candidate = getOptionalString(value);
    return candidate ? candidate.toLowerCase() : null;
}
function isInactiveContractStatus(value) {
    if (!value)
        return false;
    const normalized = value.trim().toLowerCase();
    if (!normalized)
        return false;
    const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    const tokenSet = new Set(tokens);
    const inactiveTokens = [
        'inactive',
        'terminated',
        'termination',
        'cancelled',
        'canceled',
        'suspended',
        'paused',
        'hold',
        'closed',
        'ended',
        'deactivated',
        'disabled',
    ];
    return inactiveTokens.some(token => tokenSet.has(token));
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
function buildSeedId(storeId, candidate, fallback) {
    const normalizedCandidate = candidate ? slugify(candidate) : '';
    if (normalizedCandidate) {
        return normalizedCandidate;
    }
    return `${storeId}_${fallback}`;
}
function toSeedRecords(value) {
    if (Array.isArray(value)) {
        return value.filter((item) => typeof item === 'object' && item !== null);
    }
    if (value && typeof value === 'object') {
        return Object.values(value).filter((item) => typeof item === 'object' && item !== null);
    }
    return [];
}
function mapProductSeeds(records, storeId) {
    return records
        .map((product, index) => {
        const name = getOptionalString(product.name ??
            product.productName ??
            product.displayName ??
            product.title ??
            undefined) ?? null;
        const sku = getOptionalString(product.sku ??
            product.code ??
            product.productSku ??
            undefined);
        const idCandidate = getOptionalString(product.id ??
            product.productId ??
            product.identifier ??
            product.externalId ??
            sku ??
            name ??
            undefined) ?? null;
        const data = { storeId };
        for (const [key, value] of Object.entries(product)) {
            if (key === 'id')
                continue;
            data[key] = value;
        }
        if (name && !data.name)
            data.name = name;
        if (sku && !data.sku)
            data.sku = sku;
        if (Object.keys(data).length <= 1)
            return null;
        const seedId = buildSeedId(storeId, idCandidate, `product_${index + 1}`);
        return { id: seedId, data };
    })
        .filter((item) => item !== null);
}
function mapCustomerSeeds(records, storeId) {
    return records
        .map((customer, index) => {
        const primaryName = getOptionalString(customer.displayName ??
            customer.display_name ??
            customer.primaryName ??
            customer.primary_name ??
            undefined) ?? null;
        const fallbackName = getOptionalString(customer.name ??
            customer.customerName ??
            customer.customer_name ??
            customer.displayName ??
            undefined) ?? primaryName;
        const email = getOptionalEmail(customer.email ??
            customer.contactEmail ??
            customer.contact_email ??
            undefined);
        const phone = getOptionalString(customer.phone ??
            customer.phoneNumber ??
            customer.phone_number ??
            customer.contactPhone ??
            undefined);
        if (!primaryName && !fallbackName && !email && !phone) {
            return null;
        }
        const identifierCandidate = getOptionalString(customer.id ??
            customer.customerId ??
            customer.customer_id ??
            customer.identifier ??
            customer.externalId ??
            customer.external_id ??
            email ??
            phone ??
            primaryName ??
            fallbackName ??
            undefined) ?? null;
        const labelFallback = fallbackName ?? primaryName ?? email ?? phone ?? `customer_${index + 1}`;
        const data = { storeId };
        for (const [key, value] of Object.entries(customer)) {
            if (key === 'id')
                continue;
            data[key] = value;
        }
        if (primaryName && !data.displayName)
            data.displayName = primaryName;
        if (!data.name)
            data.name = labelFallback;
        const seedId = buildSeedId(storeId, identifierCandidate, `customer_${index + 1}`);
        return { id: seedId, data };
    })
        .filter((item) => item !== null);
}
function serializeFirestoreData(data) {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        if (value instanceof firestore_1.admin.firestore.Timestamp) {
            result[key] = value.toMillis();
        }
        else if (value && typeof value === 'object' && '_millis' in value) {
            const millis = value._millis;
            result[key] = typeof millis === 'number' ? millis : value;
        }
        else if (Array.isArray(value)) {
            result[key] = value.map(item => item instanceof firestore_1.admin.firestore.Timestamp ? item.toMillis() : item);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
exports.handleUserCreate = functions.auth.user().onCreate(async (user) => {
    const uid = user.uid;
    const email = typeof user.email === 'string' ? user.email.toLowerCase() : null;
    const memberRef = firestore_1.rosterDb.collection('teamMembers').doc(uid);
    const emailRef = email ? firestore_1.rosterDb.collection('teamMembers').doc(email) : null;
    const [memberSnap, emailSnap] = await Promise.all([
        memberRef.get(),
        emailRef ? emailRef.get() : Promise.resolve(null),
    ]);
    const existingData = (memberSnap.data() ?? {});
    const existingEmailData = (emailSnap?.data() ?? {});
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const resolvedEmail = user.email ?? existingData.email ?? existingEmailData.email ?? null;
    const resolvedPhone = user.phoneNumber ?? existingData.phone ?? existingEmailData.phone ?? null;
    const resolvedStoreId = getOptionalString(existingData.storeId ??
        existingData.storeID ??
        existingData.store_id ??
        undefined) ??
        getOptionalString(existingEmailData.storeId ??
            existingEmailData.storeID ??
            existingEmailData.store_id ??
            undefined) ??
        null;
    const resolvedRoleRaw = getOptionalString(existingData.role ??
        existingEmailData.role ??
        existingEmailData.memberRole ??
        undefined) ?? null;
    const resolvedRole = resolvedRoleRaw
        ? VALID_ROLES.has(resolvedRoleRaw.toLowerCase())
            ? resolvedRoleRaw.toLowerCase()
            : resolvedRoleRaw
        : null;
    const resolvedFirstSignupEmail = typeof existingData.firstSignupEmail === 'string'
        ? existingData.firstSignupEmail
        : typeof existingEmailData.firstSignupEmail === 'string'
            ? existingEmailData.firstSignupEmail
            : null;
    const resolvedInvitedBy = getOptionalString(existingData.invitedBy ??
        existingEmailData.invitedBy ??
        undefined) ?? null;
    const resolvedName = getOptionalString(existingData.name ??
        existingEmailData.name ??
        existingEmailData.displayName ??
        undefined) ?? null;
    const resolvedCompanyName = getOptionalString(existingData.companyName ??
        existingEmailData.companyName ??
        existingEmailData.businessName ??
        existingEmailData.workspaceName ??
        undefined) ?? null;
    const resolvedStatus = getOptionalString(existingData.status ??
        existingEmailData.status ??
        undefined) ?? null;
    const resolvedContractStatus = getOptionalString(existingData.contractStatus ??
        existingEmailData.contractStatus ??
        existingEmailData.contract_status ??
        undefined) ?? null;
    const storeId = resolvedStoreId ?? uid;
    const shouldSeedDefaultStore = !resolvedStoreId;
    const memberData = {
        ...existingEmailData,
        ...existingData,
        uid,
        email: resolvedEmail,
        phone: resolvedPhone,
        updatedAt: timestamp,
    };
    if (resolvedStoreId) {
        ;
        memberData.storeId = resolvedStoreId;
    }
    else {
        const currentStoreId = getOptionalString(memberData.storeId ?? undefined);
        if (!currentStoreId) {
            memberData.storeId = storeId;
        }
    }
    if (resolvedRole) {
        memberData.role = resolvedRole;
    }
    else if (shouldSeedDefaultStore) {
        const currentRole = getOptionalString(memberData.role ?? undefined);
        if (!currentRole) {
            memberData.role = 'owner';
        }
    }
    if (resolvedFirstSignupEmail !== null)
        memberData.firstSignupEmail = resolvedFirstSignupEmail;
    if (resolvedInvitedBy)
        memberData.invitedBy = resolvedInvitedBy;
    if (resolvedName)
        memberData.name = resolvedName;
    if (resolvedCompanyName)
        memberData.companyName = resolvedCompanyName;
    if (resolvedStatus)
        memberData.status = resolvedStatus;
    if (resolvedContractStatus)
        memberData.contractStatus = resolvedContractStatus;
    if (!memberSnap.exists) {
        if (memberData.createdAt === undefined) {
            ;
            memberData.createdAt = timestamp;
        }
    }
    await memberRef.set(memberData, { merge: true });
    if (email && emailRef) {
        const emailData = {
            ...existingEmailData,
            ...memberData,
            uid,
            email: resolvedEmail,
            updatedAt: timestamp,
        };
        if (!emailSnap?.exists) {
            if (emailData.createdAt === undefined) {
                ;
                emailData.createdAt = timestamp;
            }
        }
        else {
            delete emailData.createdAt;
        }
        await emailRef.set(emailData, { merge: true });
    }
    if (shouldSeedDefaultStore) {
        const storeRef = firestore_1.defaultDb.collection('stores').doc(storeId);
        const storeSnap = await storeRef.get();
        // Add default billing on first seed too (parity with initializeStore)
        const { trialDays } = (0, plans_1.getBillingConfig)();
        const trialEndsAt = firestore_1.admin.firestore.Timestamp.fromMillis(Date.now() + trialDays * 24 * 60 * 60 * 1000);
        const storeData = {
            ownerId: uid,
            status: 'Active',
            contractStatus: 'Active',
            billing: {
                planId: 'starter',
                status: 'trial',
                trialEndsAt,
                provider: 'paystack',
            },
            inventorySummary: {
                trackedSkus: 0,
                lowStockSkus: 0,
                incomingShipments: 0,
            },
            updatedAt: timestamp,
        };
        if (resolvedEmail) {
            ;
            storeData.ownerEmail = resolvedEmail;
        }
        const ownerName = getOptionalString(memberData.name ?? undefined);
        if (ownerName) {
            ;
            storeData.ownerName = ownerName;
        }
        const companyName = getOptionalString(memberData.companyName ?? undefined);
        if (companyName) {
            ;
            storeData.displayName = companyName;
            storeData.businessName = companyName;
        }
        if (!storeSnap.exists) {
            ;
            storeData.createdAt = timestamp;
        }
        await storeRef.set(storeData, { merge: true });
    }
});
async function initializeStoreImpl(data, context) {
    assertAuthenticated(context);
    const uid = context.auth.uid;
    const token = context.auth.token;
    const email = typeof token.email === 'string' ? token.email : null;
    const normalizedEmail = email ? email.toLowerCase() : null;
    const tokenPhone = typeof token.phone_number === 'string' ? token.phone_number : null;
    const payload = (data ?? {});
    const contact = normalizeContactPayload(payload.contact);
    const resolvedPhone = contact.hasPhone ? contact.phone ?? null : tokenPhone ?? null;
    const resolvedFirstSignupEmail = contact.hasFirstSignupEmail
        ? contact.firstSignupEmail ?? null
        : email?.toLowerCase() ?? null;
    const resolvedOwnerName = contact.hasOwnerName ? contact.ownerName ?? null : null;
    const resolvedBusinessName = contact.hasBusinessName ? contact.businessName ?? null : null;
    const resolvedCountry = contact.hasCountry ? contact.country ?? null : null;
    const resolvedTown = contact.hasTown ? contact.town ?? null : null;
    const resolvedSignupRole = contact.hasSignupRole ? contact.signupRole ?? null : null;
    const memberRef = firestore_1.rosterDb.collection('teamMembers').doc(uid);
    const defaultMemberRef = firestore_1.defaultDb.collection('teamMembers').doc(uid);
    const [memberSnap, defaultMemberSnap] = await Promise.all([
        memberRef.get(),
        defaultMemberRef.get(),
    ]);
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const { trialDays } = (0, plans_1.getBillingConfig)();
    const requestedPlanId = normalizePlanId(payload.planId);
    if (payload.planId !== undefined && requestedPlanId === null) {
        throw new functions.https.HttpsError('invalid-argument', 'Choose a valid Sedifex plan.');
    }
    const existingData = memberSnap.data() ?? {};
    const existingStoreId = typeof existingData.storeId === 'string' &&
        existingData.storeId.trim() !== ''
        ? existingData.storeId
        : null;
    const storeId = existingStoreId ?? uid;
    const storeRef = firestore_1.defaultDb.collection('stores').doc(storeId);
    const storeSnap = await storeRef.get();
    const existingStoreData = (storeSnap.data() ?? {});
    const workspaceSlug = normalizeWorkspaceSlug(existingStoreData.workspaceSlug ??
        existingStoreData.slug ??
        existingStoreData.storeSlug ??
        null, storeId);
    const workspaceRef = firestore_1.defaultDb.collection('workspaces').doc(workspaceSlug);
    const workspaceSnap = await workspaceRef.get();
    const existingWorkspaceData = (workspaceSnap.data() ?? {});
    const existingBillingRaw = typeof existingStoreData.billing === 'object' &&
        existingStoreData.billing !== null
        ? { ...existingStoreData.billing }
        : {};
    const existingPlanId = normalizePlanId(existingBillingRaw.planId ??
        existingStoreData.planId ??
        null);
    const resolvedPlanId = requestedPlanId ?? existingPlanId ?? 'starter';
    const trialDurationMs = Math.max(trialDays, 0) * 24 * 60 * 60 * 1000;
    const nowTimestampValue = firestore_1.admin.firestore.Timestamp.now();
    const existingContractStart = toTimestamp(existingStoreData.contractStart);
    const hasContractStart = Boolean(existingContractStart);
    const contractStartTimestamp = existingContractStart ?? nowTimestampValue;
    const existingContractEnd = toTimestamp(existingStoreData.contractEnd);
    const hasContractEnd = Boolean(existingContractEnd);
    const contractEndTimestamp = hasContractEnd
        ? existingContractEnd
        : firestore_1.admin.firestore.Timestamp.fromMillis(contractStartTimestamp.toMillis() + trialDurationMs);
    const memberData = {
        uid,
        email,
        role: 'owner',
        storeId,
        phone: resolvedPhone,
        firstSignupEmail: resolvedFirstSignupEmail,
        invitedBy: uid,
        updatedAt: timestamp,
        workspaceSlug,
    };
    if (resolvedOwnerName !== null) {
        ;
        memberData.name = resolvedOwnerName;
    }
    if (resolvedBusinessName !== null) {
        ;
        memberData.companyName = resolvedBusinessName;
    }
    if (resolvedCountry !== null) {
        ;
        memberData.country = resolvedCountry;
    }
    if (resolvedTown !== null) {
        ;
        memberData.town = resolvedTown;
    }
    if (resolvedSignupRole !== null) {
        ;
        memberData.signupRole = resolvedSignupRole;
    }
    if (!memberSnap.exists) {
        ;
        memberData.createdAt = timestamp;
    }
    await Promise.all([
        memberRef.set(memberData, { merge: true }),
        (async () => {
            const defaultMemberData = {
                uid,
                email,
                role: 'owner',
                storeId,
                phone: resolvedPhone,
                firstSignupEmail: resolvedFirstSignupEmail,
                invitedBy: uid,
                updatedAt: timestamp,
                workspaceSlug,
            };
            if (resolvedOwnerName !== null) {
                ;
                defaultMemberData.name = resolvedOwnerName;
            }
            if (resolvedBusinessName !== null) {
                ;
                defaultMemberData.companyName = resolvedBusinessName;
            }
            if (resolvedCountry !== null) {
                ;
                defaultMemberData.country = resolvedCountry;
            }
            if (resolvedTown !== null) {
                ;
                defaultMemberData.town = resolvedTown;
            }
            if (resolvedSignupRole !== null) {
                ;
                defaultMemberData.signupRole = resolvedSignupRole;
            }
            if (!defaultMemberSnap.exists) {
                ;
                defaultMemberData.createdAt = timestamp;
            }
            await defaultMemberRef.set(defaultMemberData, { merge: true });
        })(),
    ]);
    if (normalizedEmail) {
        const emailRef = firestore_1.rosterDb.collection('teamMembers').doc(normalizedEmail);
        const emailSnap = await emailRef.get();
        const emailData = {
            uid,
            email,
            role: 'owner',
            storeId,
            phone: resolvedPhone,
            firstSignupEmail: resolvedFirstSignupEmail,
            invitedBy: uid,
            updatedAt: timestamp,
            workspaceSlug,
        };
        if (resolvedOwnerName !== null) {
            ;
            emailData.name = resolvedOwnerName;
        }
        if (resolvedBusinessName !== null) {
            ;
            emailData.companyName = resolvedBusinessName;
        }
        if (resolvedCountry !== null) {
            ;
            emailData.country = resolvedCountry;
        }
        if (resolvedTown !== null) {
            ;
            emailData.town = resolvedTown;
        }
        if (resolvedSignupRole !== null) {
            ;
            emailData.signupRole = resolvedSignupRole;
        }
        if (!emailSnap.exists) {
            ;
            emailData.createdAt = timestamp;
        }
        await emailRef.set(emailData, { merge: true });
    }
    const storeData = {
        ownerId: uid,
        updatedAt: timestamp,
        workspaceSlug,
    };
    const existingStatus = getOptionalString(existingStoreData.status ?? undefined);
    if (!existingStatus) {
        ;
        storeData.status = 'Active';
    }
    const existingContractStatus = getOptionalString(existingStoreData.contractStatus ?? undefined);
    if (!existingContractStatus) {
        ;
        storeData.contractStatus = 'Active';
    }
    if (!hasContractStart) {
        ;
        storeData.contractStart = contractStartTimestamp;
    }
    if (!hasContractEnd) {
        ;
        storeData.contractEnd = contractEndTimestamp;
    }
    if (email) {
        ;
        storeData.ownerEmail = email;
    }
    if (resolvedOwnerName) {
        ;
        storeData.ownerName = resolvedOwnerName;
    }
    if (resolvedBusinessName) {
        ;
        storeData.displayName = resolvedBusinessName;
        storeData.businessName = resolvedBusinessName;
    }
    if (resolvedCountry) {
        ;
        storeData.country = resolvedCountry;
    }
    if (resolvedTown) {
        ;
        storeData.town = resolvedTown;
    }
    if (resolvedPhone) {
        ;
        storeData.ownerPhone = resolvedPhone;
    }
    const existingTrialEndsAt = toTimestamp(existingBillingRaw.trialEndsAt);
    const nextBilling = { ...existingBillingRaw };
    nextBilling.planId = resolvedPlanId;
    if (!getOptionalString(nextBilling.provider ?? undefined)) {
        ;
        nextBilling.provider = 'paystack';
    }
    if (!getOptionalString(nextBilling.status ?? undefined)) {
        ;
        nextBilling.status = 'trial';
    }
    ;
    nextBilling.trialEndsAt = existingTrialEndsAt ?? contractEndTimestamp;
    storeData.billing = nextBilling;
    const existingInventory = existingStoreData.inventorySummary;
    if (!storeSnap.exists) {
        ;
        storeData.createdAt = timestamp;
        if (!existingInventory) {
            ;
            storeData.inventorySummary = {
                trackedSkus: 0,
                lowStockSkus: 0,
                incomingShipments: 0,
            };
        }
    }
    else if (!existingInventory) {
        ;
        storeData.inventorySummary = {
            trackedSkus: 0,
            lowStockSkus: 0,
            incomingShipments: 0,
        };
    }
    await storeRef.set(storeData, { merge: true });
    const workspaceData = {
        slug: workspaceSlug,
        storeId,
        ownerId: uid,
        updatedAt: timestamp,
        planId: resolvedPlanId,
    };
    if (!workspaceSnap.exists) {
        ;
        workspaceData.createdAt = timestamp;
    }
    if (email) {
        ;
        workspaceData.ownerEmail = email;
    }
    if (resolvedPhone) {
        ;
        workspaceData.ownerPhone = resolvedPhone;
    }
    if (resolvedOwnerName) {
        ;
        workspaceData.ownerName = resolvedOwnerName;
    }
    if (resolvedBusinessName) {
        ;
        workspaceData.company = resolvedBusinessName;
        workspaceData.displayName = resolvedBusinessName;
    }
    if (resolvedCountry) {
        ;
        workspaceData.country = resolvedCountry;
    }
    if (resolvedTown) {
        ;
        workspaceData.town = resolvedTown;
    }
    if (resolvedFirstSignupEmail !== null) {
        ;
        workspaceData.firstSignupEmail = resolvedFirstSignupEmail;
    }
    const existingWorkspaceContractStart = toTimestamp(existingWorkspaceData.contractStart);
    if (!existingWorkspaceContractStart) {
        ;
        workspaceData.contractStart = contractStartTimestamp;
    }
    const existingWorkspaceContractEnd = toTimestamp(existingWorkspaceData.contractEnd);
    if (!existingWorkspaceContractEnd) {
        ;
        workspaceData.contractEnd = contractEndTimestamp;
    }
    const existingWorkspaceStatus = getOptionalString(existingWorkspaceData.status ?? undefined);
    if (!existingWorkspaceStatus) {
        ;
        workspaceData.status = 'active';
    }
    const existingWorkspaceContractStatus = getOptionalString(existingWorkspaceData.contractStatus ?? undefined);
    if (!existingWorkspaceContractStatus) {
        ;
        workspaceData.contractStatus = 'active';
    }
    const existingWorkspacePaymentStatus = getOptionalString(existingWorkspaceData.paymentStatus ?? undefined);
    if (!existingWorkspacePaymentStatus) {
        ;
        workspaceData.paymentStatus = 'trial';
    }
    await workspaceRef.set(workspaceData, { merge: true });
    const claims = await updateUserClaims(uid, 'owner');
    return { ok: true, claims, storeId };
}
exports.initializeStore = functions.https.onCall(async (data, context) => {
    try {
        return await initializeStoreImpl(data, context);
    }
    catch (error) {
        logCallableError('initializeStore', error, context, data);
        throw error;
    }
});
async function lookupWorkspaceBySelector(selector) {
    const normalized = selector.trim();
    if (!normalized) {
        return null;
    }
    const workspacesCollection = firestore_1.defaultDb.collection('workspaces');
    const directRef = workspacesCollection.doc(normalized);
    const directSnap = await directRef.get();
    if (directSnap.exists) {
        const data = (directSnap.data() ?? {});
        const storeId = getOptionalString(data.storeId ?? undefined);
        return { slug: directRef.id, storeId, data };
    }
    const fallbackFields = ['storeId', 'slug', 'workspaceSlug', 'storeSlug'];
    for (const field of fallbackFields) {
        const fallbackQuery = await workspacesCollection
            .where(field, '==', normalized)
            .limit(1)
            .get();
        const fallbackDoc = fallbackQuery.docs[0];
        if (!fallbackDoc) {
            continue;
        }
        const fallbackData = (fallbackDoc.data() ?? {});
        const fallbackStoreId = getOptionalString(fallbackData.storeId ?? undefined);
        return { slug: fallbackDoc.id, storeId: fallbackStoreId, data: fallbackData };
    }
    return null;
}
exports.resolveStoreAccess = functions.https.onCall(async (data, context) => {
    assertAuthenticated(context);
    const uid = context.auth.uid;
    const token = context.auth.token;
    const emailFromToken = typeof token.email === 'string' ? token.email.toLowerCase() : null;
    // storeId that comes from the app (or fall back to uid)
    const rawStoreId = data && typeof data.storeId === 'string'
        ? data.storeId.trim()
        : '';
    const workspaceSlug = rawStoreId || uid;
    // 1) Workspace in DEFAULT database
    const workspaceRef = firestore_1.defaultDb.collection('workspaces').doc(workspaceSlug);
    const workspaceSnap = await workspaceRef.get();
    if (!workspaceSnap.exists) {
        throw new functions.https.HttpsError('failed-precondition', 'We could not locate your Sedifex workspace configuration. Check the store ID in Settings.');
    }
    const workspaceData = (workspaceSnap.data() ?? {});
    // Prefer storeId from workspace doc, otherwise use slug
    const existingStoreIdRaw = typeof workspaceData.storeId === 'string'
        ? workspaceData.storeId.trim()
        : '';
    const storeId = existingStoreIdRaw || workspaceSlug;
    const now = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    // 2) Store document in DEFAULT database
    const storeRef = firestore_1.defaultDb.collection('stores').doc(storeId);
    const storeSnap = await storeRef.get();
    const baseStoreData = (storeSnap.data() ?? {});
    const storeData = {
        ...baseStoreData,
        ownerId: typeof baseStoreData.ownerId === 'string'
            ? baseStoreData.ownerId
            : uid,
        ownerEmail: typeof baseStoreData.ownerEmail === 'string'
            ? baseStoreData.ownerEmail
            : emailFromToken,
        status: baseStoreData.status ?? 'Active',
        contractStatus: baseStoreData.contractStatus ?? 'Active',
        workspaceSlug,
        updatedAt: now,
    };
    if (!storeSnap.exists) {
        ;
        storeData.createdAt = now;
        if (!storeData.inventorySummary) {
            ;
            storeData.inventorySummary = {
                trackedSkus: 0,
                lowStockSkus: 0,
                incomingShipments: 0,
            };
        }
    }
    await storeRef.set(storeData, { merge: true });
    // 3) Team member record in DEFAULT database (give yourself OWNER role)
    const memberRef = firestore_1.defaultDb.collection('teamMembers').doc(uid);
    const memberSnap = await memberRef.get();
    const existingMember = (memberSnap.data() ?? {});
    const memberCreatedAt = memberSnap.exists &&
        existingMember.createdAt instanceof firestore_1.admin.firestore.Timestamp
        ? existingMember.createdAt
        : firestore_1.admin.firestore.Timestamp.now();
    const memberData = {
        ...existingMember,
        uid,
        storeId,
        role: 'owner',
        email: emailFromToken,
        workspaceSlug,
        updatedAt: now,
        createdAt: memberCreatedAt,
    };
    await memberRef.set(memberData, { merge: true });
    // 4) Set auth custom claims so commitSale/receiveStock pass assertStaffAccess
    const claims = await updateUserClaims(uid, 'owner');
    const storeResponseData = {
        ...storeData,
        storeId,
        workspaceSlug,
    };
    // Shape similar to original implementation; products/customers left empty
    return {
        ok: true,
        storeId,
        role: 'owner',
        claims,
        teamMember: { id: memberRef.id, data: serializeFirestoreData(memberData) },
        store: {
            id: storeRef.id,
            data: serializeFirestoreData(storeResponseData),
        },
        products: [],
        customers: [],
    };
});
exports.manageStaffAccount = functions.https.onCall(async (data, context) => {
    assertOwnerAccess(context);
    const { storeId, email, role, password } = normalizeManageStaffPayload(data);
    const invitedBy = context.auth?.uid ?? null;
    const { record, created } = await ensureAuthUser(email, password);
    const memberRef = firestore_1.rosterDb.collection('teamMembers').doc(record.uid);
    const memberSnap = await memberRef.get();
    const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
    const memberData = {
        uid: record.uid,
        email,
        storeId,
        role,
        invitedBy,
        updatedAt: timestamp,
    };
    if (!memberSnap.exists) {
        ;
        memberData.createdAt = timestamp;
    }
    await memberRef.set(memberData, { merge: true });
    const emailRef = firestore_1.rosterDb.collection('teamMembers').doc(email);
    const emailSnap = await emailRef.get();
    const emailData = {
        uid: record.uid,
        email,
        storeId,
        role,
        invitedBy,
        updatedAt: timestamp,
    };
    if (!emailSnap.exists) {
        ;
        emailData.createdAt = timestamp;
    }
    await emailRef.set(emailData, { merge: true });
    const claims = await updateUserClaims(record.uid, role);
    return { ok: true, role, email, uid: record.uid, created, storeId, claims };
});
exports.commitSale = functions.https.onCall(async (data, context) => {
    // For now, just require that the user is logged in.
    // We’re NOT enforcing role-based access until claims are sorted out.
    assertAuthenticated(context);
    const { branchId, workspaceId: workspaceIdRaw, items, totals, cashierId, saleId: saleIdRaw, payment, customer, } = data || {};
    const normalizedBranchIdRaw = typeof branchId === 'string' ? branchId.trim() : '';
    if (!normalizedBranchIdRaw) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid branch identifier is required');
    }
    const normalizedBranchId = normalizedBranchIdRaw;
    const workspaceIdCandidate = typeof workspaceIdRaw === 'string' ? workspaceIdRaw.trim() : '';
    const lookupSelector = workspaceIdCandidate || normalizedBranchId;
    const workspaceLookup = lookupSelector ? await lookupWorkspaceBySelector(lookupSelector) : null;
    const resolvedWorkspaceId = workspaceLookup?.slug ??
        (workspaceIdCandidate ? workspaceIdCandidate : normalizedBranchId);
    const resolvedStoreId = workspaceLookup?.storeId ?? normalizedBranchId;
    // Determine saleId (use provided one or generate a new ID)
    const saleId = typeof saleIdRaw === 'string' && saleIdRaw.trim()
        ? saleIdRaw.trim()
        : db.collection('_').doc().id;
    const workspaceRef = db.collection('workspaces').doc(resolvedWorkspaceId);
    // IMPORTANT: use global products collection so products are found correctly
    const productsCollection = db.collection('products');
    const saleRef = workspaceRef.collection('sales').doc(saleId);
    const saleItemsCollection = workspaceRef.collection('saleItems');
    const ledgerCollection = workspaceRef.collection('ledger');
    await db.runTransaction(async (tx) => {
        const existingSale = await tx.get(saleRef);
        if (existingSale.exists) {
            throw new functions.https.HttpsError('already-exists', 'Sale has already been committed');
        }
        const normalizedItems = Array.isArray(items)
            ? items.map((it) => {
                const productId = typeof it?.productId === 'string' ? it.productId : null;
                const name = typeof it?.name === 'string' ? it.name : null;
                const qty = Number(it?.qty ?? 0) || 0;
                const price = Number(it?.price ?? 0) || 0;
                const taxRate = Number(it?.taxRate ?? 0) || 0;
                return { productId, name, qty, price, taxRate };
            })
            : [];
        const timestamp = firestore_1.admin.firestore.FieldValue.serverTimestamp();
        tx.set(saleRef, {
            workspaceId: resolvedWorkspaceId,
            branchId: resolvedStoreId,
            storeId: resolvedStoreId,
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
            if (!it.productId) {
                throw new functions.https.HttpsError('failed-precondition', 'Bad product');
            }
            const itemId = db.collection('_').doc().id;
            tx.set(saleItemsCollection.doc(itemId), {
                saleId,
                productId: it.productId,
                qty: it.qty,
                price: it.price,
                taxRate: it.taxRate,
                storeId: resolvedStoreId,
                workspaceId: resolvedWorkspaceId,
                createdAt: timestamp,
            });
            const pRef = productsCollection.doc(it.productId);
            const pSnap = await tx.get(pRef);
            if (!pSnap.exists) {
                throw new functions.https.HttpsError('failed-precondition', 'Bad product');
            }
            const curr = Number(pSnap.get('stockCount') || 0);
            const next = curr - Math.abs(it.qty || 0);
            tx.update(pRef, { stockCount: next, updatedAt: timestamp });
            const ledgerId = db.collection('_').doc().id;
            tx.set(ledgerCollection.doc(ledgerId), {
                productId: it.productId,
                qtyChange: -Math.abs(it.qty || 0),
                type: 'sale',
                refId: saleId,
                storeId: resolvedStoreId,
                workspaceId: resolvedWorkspaceId,
                createdAt: timestamp,
            });
        }
    });
    return { ok: true, saleId };
});
exports.receiveStock = functions.https.onCall(async (data, context) => {
    // Same here: only require that the user is authenticated.
    assertAuthenticated(context);
    const { productId, qty, supplier, reference, unitCost, workspaceId: workspaceIdRaw, storeId: storeIdRaw, branchId: branchIdRaw, } = data || {};
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
    const workspaceIdCandidate = typeof workspaceIdRaw === 'string' ? workspaceIdRaw.trim() : '';
    const storeIdCandidate = typeof storeIdRaw === 'string' ? storeIdRaw.trim() : '';
    const branchIdCandidate = typeof branchIdRaw === 'string' ? branchIdRaw.trim() : '';
    const selector = workspaceIdCandidate || storeIdCandidate || branchIdCandidate;
    const workspaceLookup = selector ? await lookupWorkspaceBySelector(selector) : null;
    const resolvedWorkspaceId = workspaceLookup?.slug ?? (workspaceIdCandidate ? workspaceIdCandidate : selector);
    if (!resolvedWorkspaceId) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid workspace identifier is required');
    }
    let resolvedStoreId = workspaceLookup?.storeId ?? storeIdCandidate;
    if (!resolvedStoreId) {
        resolvedStoreId = branchIdCandidate || resolvedWorkspaceId;
    }
    const workspaceRef = db.collection('workspaces').doc(resolvedWorkspaceId);
    // IMPORTANT: use global products collection to match commitSale
    const productRef = db.collection('products').doc(productIdStr);
    const receiptRef = workspaceRef.collection('receipts').doc();
    const ledgerRef = workspaceRef.collection('ledger').doc();
    await db.runTransaction(async (tx) => {
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
            : Math.round((normalizedUnitCost * amount + Number.EPSILON) * 100) /
                100;
        tx.set(receiptRef, {
            productId: productIdStr,
            qty: amount,
            supplier: normalizedSupplier,
            reference: normalizedReference,
            unitCost: normalizedUnitCost,
            totalCost,
            receivedBy: context.auth?.uid ?? null,
            createdAt: timestamp,
            storeId: productStoreId || resolvedStoreId,
            workspaceId: resolvedWorkspaceId,
        });
        tx.set(ledgerRef, {
            productId: productIdStr,
            qtyChange: amount,
            type: 'receipt',
            refId: receiptRef.id,
            storeId: productStoreId || resolvedStoreId,
            workspaceId: resolvedWorkspaceId,
            createdAt: timestamp,
        });
    });
    return { ok: true, receiptId: receiptRef.id };
});
const SHARE_METHODS = new Set(['web-share', 'email', 'sms', 'whatsapp', 'download']);
const SHARE_STATUSES = new Set(['started', 'success', 'cancelled', 'error']);
exports.prepareReceiptShare = functions.https.onCall(async (rawData, context) => {
    assertStaffAccess(context);
    const saleIdRaw = rawData?.saleId;
    const saleId = typeof saleIdRaw === 'string' ? saleIdRaw.trim() : '';
    if (!saleId) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid saleId is required');
    }
    const storeIdRaw = rawData?.storeId;
    const storeId = typeof storeIdRaw === 'string' && storeIdRaw.trim()
        ? storeIdRaw.trim()
        : null;
    const linesRaw = Array.isArray(rawData?.lines) ? rawData?.lines ?? [] : [];
    const lines = linesRaw
        .map(line => (typeof line === 'string' ? line : ''))
        .map(line => line.trimEnd())
        .filter((line, index) => line.length > 0 || index === 0);
    if (lines.length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Receipt lines are required');
    }
    const pdfFileNameRaw = rawData?.pdfFileName;
    const pdfFileName = typeof pdfFileNameRaw === 'string' && pdfFileNameRaw.trim()
        ? pdfFileNameRaw.trim()
        : `receipt-${saleId}.pdf`;
    const bucket = firestore_1.admin.storage().bucket();
    const safeStoreSegment = storeId
        ? storeId.replace(/[^A-Za-z0-9_-]/g, '_')
        : 'unassigned';
    const pdfPath = `receipt-shares/${safeStoreSegment}/${saleId}.pdf`;
    const file = bucket.file(pdfPath);
    const [exists] = await file.exists();
    if (!exists) {
        const pdfBody = (0, pdf_1.buildSimplePdf)('Sedifex POS', lines.slice(1));
        await file.save(Buffer.from(pdfBody), {
            resumable: false,
            contentType: 'application/pdf',
            metadata: {
                cacheControl: 'public, max-age=31536000',
                contentDisposition: `attachment; filename="${pdfFileName}"`,
            },
        });
    }
    const expiresAtMillis = Date.now() + 1000 * 60 * 60 * 24 * 30;
    const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: new Date(expiresAtMillis),
    });
    const shareId = db.collection('_').doc().id;
    await db
        .collection('receiptShareSessions')
        .doc(shareId)
        .set({
        saleId,
        storeId,
        pdfPath,
        pdfFileName,
        preparedAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
        preparedBy: context.auth?.uid ?? null,
        signedUrl,
        expiresAt: firestore_1.admin.firestore.Timestamp.fromMillis(expiresAtMillis),
    });
    return {
        ok: true,
        saleId,
        pdfUrl: signedUrl,
        pdfFileName,
        shareUrl: signedUrl,
        shareId,
    };
});
exports.logReceiptShareAttempt = functions.https.onCall(async (rawData, context) => {
    assertStaffAccess(context);
    const saleIdRaw = rawData?.saleId;
    const saleId = typeof saleIdRaw === 'string' ? saleIdRaw.trim() : '';
    if (!saleId) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid saleId is required');
    }
    const methodRaw = rawData?.method;
    const method = typeof methodRaw === 'string' ? methodRaw.trim() : '';
    if (!SHARE_METHODS.has(method)) {
        throw new functions.https.HttpsError('invalid-argument', 'Unsupported share method');
    }
    const statusRaw = rawData?.status;
    const status = typeof statusRaw === 'string' ? statusRaw.trim() : '';
    if (!SHARE_STATUSES.has(status)) {
        throw new functions.https.HttpsError('invalid-argument', 'Unsupported share status');
    }
    const storeIdRaw = rawData?.storeId;
    const storeId = typeof storeIdRaw === 'string' && storeIdRaw.trim()
        ? storeIdRaw.trim()
        : null;
    const shareIdRaw = rawData?.shareId;
    const shareId = typeof shareIdRaw === 'string' && shareIdRaw.trim()
        ? shareIdRaw.trim()
        : null;
    const errorMessageRaw = rawData?.errorMessage;
    const errorMessage = typeof errorMessageRaw === 'string' && errorMessageRaw.trim()
        ? errorMessageRaw.trim().slice(0, 500)
        : null;
    const attemptId = db.collection('_').doc().id;
    await db
        .collection('receiptShareAttempts')
        .doc(attemptId)
        .set({
        saleId,
        storeId,
        shareId,
        method,
        status,
        errorMessage,
        createdAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
        createdBy: context.auth?.uid ?? null,
    });
    if (shareId) {
        await db
            .collection('receiptShareSessions')
            .doc(shareId)
            .set({
            lastAttemptAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
            lastAttemptStatus: status,
        }, { merge: true });
    }
    return { ok: true, attemptId };
});
