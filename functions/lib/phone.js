"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePhoneE164 = normalizePhoneE164;
const AFRICAN_COUNTRY_CODES = [
    '233',
    '234',
    '225',
    '221',
    '237',
    '254',
    '255',
    '256',
    '250',
    '251',
    '260',
    '263',
    '27',
    '20',
    '212',
    '213',
    '216',
];
const DEFAULT_AFRICAN_COUNTRY_CODE = '233';
function normalizePhoneE164(input, options) {
    const trimmed = input.trim();
    if (!trimmed)
        return '';
    const withoutWhatsApp = trimmed.startsWith('whatsapp:')
        ? trimmed.slice('whatsapp:'.length).trim()
        : trimmed;
    if (!withoutWhatsApp)
        return '';
    const hasPlus = withoutWhatsApp.startsWith('+');
    const digits = withoutWhatsApp.replace(/\D/g, '');
    if (!digits)
        return '';
    if (hasPlus) {
        return `+${digits}`;
    }
    if (withoutWhatsApp.startsWith('00')) {
        return `+${digits.replace(/^00/, '')}`;
    }
    if (withoutWhatsApp.startsWith('0')) {
        const rest = digits.replace(/^0/, '');
        const countryCode = options?.defaultCountryCode ?? DEFAULT_AFRICAN_COUNTRY_CODE;
        return `+${countryCode}${rest}`;
    }
    const matchesAfricanCode = AFRICAN_COUNTRY_CODES.some(code => digits.startsWith(code));
    if (matchesAfricanCode) {
        return `+${digits}`;
    }
    return `+${digits}`;
}
