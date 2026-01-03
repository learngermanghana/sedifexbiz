"use strict";
// src/supabaseError.ts
// Minimal stub to satisfy existing SupabaseFunctionError imports.
// We match the constructor signature used in customClaims.ts.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupabaseFunctionError = void 0;
class SupabaseFunctionError extends Error {
    constructor(code, message, options) {
        super(message);
        this.name = 'SupabaseFunctionError';
        this.code = code;
        // Optional: attach cause if provided
        if (options && 'cause' in options) {
            ;
            this.cause = options.cause;
        }
    }
}
exports.SupabaseFunctionError = SupabaseFunctionError;
