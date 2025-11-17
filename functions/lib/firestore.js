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
exports.rosterDb = exports.defaultDb = exports.admin = void 0;
const admin = __importStar(require("firebase-admin"));
exports.admin = admin;
const firestore_1 = require("@google-cloud/firestore");
// ─────────────────────────────────────────────────────────────────────────────
// One-time Admin init
try {
    admin.app();
}
catch {
    admin.initializeApp();
}
// Common flags
const activeApp = admin.apps.length ? admin.app() : null;
const projectId = process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    activeApp?.options?.projectId ||
    undefined;
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST; // e.g. "localhost:8080"
const isEmulator = Boolean(emulatorHost);
// ─────────────────────────────────────────────────────────────────────────────
// Default DB: (default) via Admin SDK
const defaultDb = admin.firestore();
exports.defaultDb = defaultDb;
if (typeof defaultDb.settings === 'function') {
    defaultDb.settings({ ignoreUndefinedProperties: true });
}
// If you really want to force Admin SDK through the emulator (usually not needed
// because Admin respects FIRESTORE_EMULATOR_HOST), you could uncomment below:
//
// if (isEmulator) {
//   // Admin SDK automatically uses the emulator when FIRESTORE_EMULATOR_HOST is set.
//   // This block is typically unnecessary.
// }
// ─────────────────────────────────────────────────────────────────────────────
// Secondary DB: named "roster"
// For named databases we must use the @google-cloud/firestore client.
const rosterOptions = {
    databaseId: 'roster',
    // prefer the REST transport in Cloud Functions Gen2 (often more reliable)
    // Safe to leave enabled elsewhere as well.
    preferRest: true,
};
if (projectId) {
    rosterOptions.projectId = projectId;
}
// When running against the emulator, @google-cloud/firestore honors the env var,
// but we can be explicit to avoid surprises in some environments.
if (isEmulator && emulatorHost) {
    const [host, portStr] = emulatorHost.split(':');
    const port = Number(portStr) || 8080;
    rosterOptions.host = host;
    rosterOptions.port = port;
    rosterOptions.ssl = false;
}
const rosterDb = (projectId || isEmulator ? new firestore_1.Firestore(rosterOptions) : defaultDb);
exports.rosterDb = rosterDb;
