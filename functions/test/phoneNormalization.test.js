const assert = require('assert')
const {
  normalizeGhanaPhoneDigits,
  normalizePhoneE164,
  normalizePhoneForWhatsApp,
} = require('../lib/phone.js')

assert.strictEqual(normalizeGhanaPhoneDigits('0245022743'), '233245022743')
assert.strictEqual(normalizePhoneE164('0245022743'), '+233245022743')
assert.strictEqual(normalizePhoneE164('245022743'), '+233245022743')
assert.strictEqual(normalizePhoneE164('+233245022743'), '+233245022743')
assert.strictEqual(normalizePhoneE164('00233245022743'), '+233245022743')
assert.strictEqual(normalizePhoneE164('2330245022743'), '+233245022743')
assert.strictEqual(normalizePhoneForWhatsApp('0245022743'), '233245022743')
assert.strictEqual(
  normalizePhoneE164('08012345678', { defaultCountryCode: '234' }),
  '+2348012345678',
)

console.log('phoneNormalization tests passed')
