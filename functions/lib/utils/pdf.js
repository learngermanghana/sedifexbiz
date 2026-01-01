"use strict";
// functions/src/utils/pdf.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSimplePdf = buildSimplePdf;
/**
 * Very lightweight helper. Returns a string; the caller wraps it in Buffer.
 * This will download as a .pdf file but will just contain plain text.
 */
function buildSimplePdf(title, lines) {
    const body = [title, '', ...lines].join('\n');
    return body;
}
