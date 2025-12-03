"use strict";
// functions/src/paystack.ts
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
exports.paystackWebhook = exports.checkSignupUnlock = exports.createCheckout = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const crypto = __importStar(require("crypto"));
const params_1 = require("firebase-functions/params");
const firestore_1 = require("./firestore");
/**
 * Config
 */
const PAYSTACK_SECRET = (0, params_1.defineString)('PAYSTACK_SECRET_KEY');
const PAYSTACK_PUBLIC = (0, params_1.defineString)('PAYSTACK_PUBLIC_KEY');
const APP_BASE_URL = (0, params_1.defineString)('APP_BASE_URL');
function safeParamValue(param) {
    try {
        return param.value();
    }
    catch (error) {
        functions.logger.debug('Param not set; falling back to env', { error });
        return '';
    }
}
let paystackConfigLogged = false;
function getPaystackConfig() {
    const secret = safeParamValue(PAYSTACK_SECRET) || process.env.PAYSTACK_SECRET_KEY || '';
    const publicKey = safeParamValue(PAYSTACK_PUBLIC) || process.env.PAYSTACK_PUBLIC_KEY || '';
    const appBaseUrl = safeParamValue(APP_BASE_URL) || process.env.APP_BASE_URL || '';
    if (!paystackConfigLogged && !secret) {
        functions.logger.warn('Paystack secret not set. Run: firebase functions:config:set paystack.secret="sk_live_xxx"');
        paystackConfigLogged = true;
    }
    return { secret, publicKey, appBaseUrl };
}
/**
 * Util: kobo conversion (Paystack expects amounts in kobo)
 */
const toKobo = (amount) => Math.round(Math.abs(amount) * 100);
/**
 * Helper: ensure user is authenticated for callables
 */
function assertAuthenticated(context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
}
async function recordPaystackEvent(storeId, evtType, data) {
    try {
        await firestore_1.defaultDb
            .collection('subscriptions')
            .doc(storeId)
            .collection('events')
            .doc(String(Date.now()))
            .set({
            event: evtType,
            data,
            receivedAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (e) {
        functions.logger.warn('Failed to store Paystack audit event', {
            e,
            evtType,
            storeId,
        });
    }
}
/**
 * Callable: initialize a Paystack checkout session
 *
 * Expected data:
 * {
 *   email: string,
 *   storeId: string,
 *   amount: number,
 *   plan?: string,
 *   planId?: string,
 *   redirectUrl?: string,
 *   metadata?: Record<string, any>
 * }
 */
exports.createCheckout = functions.https.onCall(async (data, context) => {
    assertAuthenticated(context);
    const { secret: paystackSecret, publicKey: paystackPublicKey, appBaseUrl } = getPaystackConfig();
    if (!paystackSecret) {
        throw new functions.https.HttpsError('failed-precondition', 'Paystack secret is not configured');
    }
    const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';
    const storeId = typeof data?.storeId === 'string' ? data.storeId.trim() : '';
    const rawPlan = (typeof data?.plan === 'string' ? data.plan.trim() : '') ||
        (typeof data?.planId === 'string' ? data.planId.trim() : '');
    const plan = rawPlan || null;
    const redirectUrlRaw = typeof data?.redirectUrl === 'string' ? data.redirectUrl.trim() : '';
    const redirectUrl = redirectUrlRaw || (appBaseUrl ? `${appBaseUrl}/billing/verify` : undefined);
    const metadataIn = data?.metadata && typeof data.metadata === 'object'
        ? data.metadata
        : {};
    const amount = Number(data?.amount);
    if (!email) {
        throw new functions.https.HttpsError('invalid-argument', 'A valid email is required');
    }
    if (!storeId) {
        throw new functions.https.HttpsError('invalid-argument', 'storeId is required');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Amount must be greater than zero');
    }
    const reference = `${storeId}_${Date.now()}`;
    const payload = {
        email,
        amount: toKobo(amount),
        reference,
        callback_url: redirectUrl,
        metadata: {
            storeId,
            plan: plan,
            createdBy: context.auth.uid,
            ...metadataIn,
        },
    };
    const resp = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${paystackSecret}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const json = (await resp.json());
    if (!json?.status) {
        throw new functions.https.HttpsError('internal', json?.message || 'Paystack init failed');
    }
    const { authorization_url: authUrl } = json.data ?? {};
    try {
        await firestore_1.defaultDb
            .collection('subscriptions')
            .doc(storeId)
            .set({
            provider: 'paystack',
            status: 'pending',
            plan,
            reference,
            amount,
            email,
            createdAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
            createdBy: context.auth.uid,
        }, { merge: true });
    }
    catch (e) {
        functions.logger.warn('Failed to write pending subscription doc', { e, storeId });
    }
    return {
        ok: true,
        authorizationUrl: authUrl,
        reference,
        publicKey: paystackPublicKey || null,
    };
});
/**
 * Callable: check if signup/workspace is unlocked after Paystack payment
 *
 * Reads subscriptions/<storeId> and returns whether status === 'active'
 */
exports.checkSignupUnlock = functions.https.onCall(async (data, context) => {
    assertAuthenticated(context);
    const storeId = typeof data?.storeId === 'string' ? data.storeId.trim() : '';
    if (!storeId) {
        throw new functions.https.HttpsError('invalid-argument', 'storeId is required');
    }
    const subRef = firestore_1.defaultDb.collection('subscriptions').doc(storeId);
    const snap = await subRef.get();
    if (!snap.exists) {
        return {
            ok: true,
            unlocked: false,
            status: 'pending',
        };
    }
    const sub = snap.data();
    const status = typeof sub.status === 'string'
        ? sub.status.toLowerCase()
        : 'pending';
    const unlocked = status === 'active';
    return {
        ok: true,
        unlocked,
        status,
        plan: sub.plan ?? null,
        provider: sub.provider ?? 'paystack',
        reference: sub.reference ?? null,
        lastEvent: sub.lastEvent ?? null,
    };
});
/**
 * HTTP Webhook: Paystack event receiver (authoritative status)
 *
 * Verifies x-paystack-signature using HMAC SHA512.
 */
exports.paystackWebhook = functions.https.onRequest(async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }
        const signature = req.get('x-paystack-signature') || '';
        const { secret } = getPaystackConfig();
        if (!secret) {
            res.status(500).send('Paystack secret not configured');
            return;
        }
        const computed = crypto
            .createHmac('sha512', secret)
            .update(req.rawBody)
            .digest('hex');
        const safeEqual = signature.length === computed.length &&
            crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
        if (!safeEqual) {
            res.status(401).send('Invalid signature');
            return;
        }
        const event = req.body;
        const evtType = event?.event || 'unknown';
        const data = event?.data || {};
        functions.logger.info('Paystack webhook received', {
            event: evtType,
            reference: data.reference,
            email: data.customer?.email,
            amount: data.amount,
            metadata: data.metadata,
        });
        switch (evtType) {
            case 'charge.success': {
                const storeId = data.metadata?.storeId;
                if (!storeId)
                    break;
                const rawPlan = data.metadata?.plan || data.plan || undefined;
                const plan = rawPlan || null;
                const email = data.customer?.email || null;
                const amount = typeof data.amount === 'number' ? data.amount / 100 : null;
                const paidAt = data.paid_at || null;
                const reference = data.reference || null;
                const fees = typeof data.fees === 'number' ? data.fees / 100 : null;
                const metadata = data.metadata || null;
                const posChannel = data.channel ||
                    (typeof data.metadata?.channel === 'string'
                        ? data.metadata.channel
                        : null);
                await firestore_1.defaultDb
                    .collection('subscriptions')
                    .doc(storeId)
                    .set({
                    provider: 'paystack',
                    status: 'active',
                    plan,
                    customerEmail: email,
                    reference,
                    amount,
                    currency: data.currency || 'NGN',
                    channel: data.channel || null,
                    posChannel,
                    fees,
                    metadata,
                    paidAt,
                    updatedAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
                    lastEvent: evtType,
                }, { merge: true });
                await recordPaystackEvent(storeId, evtType, data);
                break;
            }
            case 'charge.failed': {
                const storeId = data.metadata?.storeId;
                const reference = data.reference || null;
                const fees = typeof data.fees === 'number' ? data.fees / 100 : null;
                if (storeId) {
                    await firestore_1.defaultDb
                        .collection('subscriptions')
                        .doc(storeId)
                        .set({
                        provider: 'paystack',
                        status: 'failed',
                        plan: data.metadata?.plan ?? null,
                        reference,
                        fees,
                        channel: data.channel || null,
                        updatedAt: firestore_1.admin.firestore.FieldValue.serverTimestamp(),
                        lastEvent: evtType,
                    }, { merge: true });
                    await recordPaystackEvent(storeId, evtType, data);
                }
                break;
            }
            default: {
                const storeId = data.metadata?.storeId;
                if (storeId) {
                    await recordPaystackEvent(storeId, evtType, data);
                }
                break;
            }
        }
        res.status(200).send('ok');
    }
    catch (err) {
        functions.logger.error('paystackWebhook error', { err });
        res.status(500).send('error');
    }
});
