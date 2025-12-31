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
const admin = __importStar(require("firebase-admin"));
const TARGET_STORE_ID = (process.argv[2] ?? '').trim();
if (!TARGET_STORE_ID) {
    console.error('Usage: npm run backfill-store <storeId>');
    process.exit(1);
}
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
async function commitBatch(batch, writes) {
    if (writes === 0) {
        return 0;
    }
    await batch.commit();
    return 0;
}
function resolveStoreId(doc) {
    const data = doc.data() || {};
    const storeId = typeof data.storeId === 'string' ? data.storeId.trim() : '';
    if (storeId)
        return storeId;
    const branchId = typeof data.branchId === 'string' ? data.branchId.trim() : '';
    if (branchId)
        return branchId;
    return TARGET_STORE_ID;
}
async function backfillCollection(collectionName, resolver) {
    const snapshot = await db.collection(collectionName).get();
    let batch = db.batch();
    let writes = 0;
    let processed = 0;
    for (const doc of snapshot.docs) {
        processed += 1;
        const existingStore = resolveStoreId(doc);
        const result = resolver(doc, existingStore);
        if (!result)
            continue;
        batch.update(doc.ref, result.updates ? { storeId: result.storeId, ...result.updates } : { storeId: result.storeId });
        writes += 1;
        if (writes >= 400) {
            writes = await commitBatch(batch, writes);
            batch = db.batch();
        }
    }
    await commitBatch(batch, writes);
    console.log(`Backfilled ${processed} documents in ${collectionName}`);
}
async function run() {
    const saleStoreMap = new Map();
    await backfillCollection('products', (_doc, storeId) => {
        return { storeId };
    });
    await backfillCollection('customers', (_doc, storeId) => {
        return { storeId };
    });
    await backfillCollection('sales', (doc, existingStore) => {
        saleStoreMap.set(doc.id, existingStore);
        return { storeId: existingStore, updates: { branchId: existingStore } };
    });
    await backfillCollection('saleItems', (doc, existingStore) => {
        const parentSaleId = typeof doc.get('saleId') === 'string' ? doc.get('saleId') : '';
        const resolved = saleStoreMap.get(parentSaleId) ?? existingStore;
        return { storeId: resolved };
    });
    await backfillCollection('ledger', (doc, existingStore) => {
        const refId = typeof doc.get('refId') === 'string' ? doc.get('refId') : '';
        const resolved = saleStoreMap.get(refId) ?? existingStore;
        return { storeId: resolved };
    });
    console.log('Backfill complete.');
}
run().catch(error => {
    console.error('Backfill failed', error);
    process.exit(1);
});
