const assert = require('node:assert/strict')
const {
  defaultAutomationSettings,
  isEmailAutomationEnabled,
  isSmsAutomationEnabledForEvent,
  isSmsAutomationEnabledForStage,
  parseAutomationSettings,
} = require('../lib/automationSettings')

const defaults = defaultAutomationSettings()
assert.equal(defaults.emailEnabled, true)
assert.equal(defaults.smsEnabled, true)
assert.equal(defaults.deliveryPreference, 'automatic')
assert.equal(defaults.fallbackToSedifex, true)
assert.equal(isEmailAutomationEnabled(defaults, 'booking.confirmed'), true)
assert.equal(isSmsAutomationEnabledForStage(defaults, 'booking_received'), false)
assert.equal(isSmsAutomationEnabledForStage(defaults, 'booking_confirmed'), false)
assert.equal(isSmsAutomationEnabledForStage(defaults, 'booking_rescheduled'), false)
assert.equal(isSmsAutomationEnabledForStage(defaults, 'booking_cancelled'), false)
assert.equal(isSmsAutomationEnabledForStage(defaults, 'payment_confirmation'), true)
assert.equal(isSmsAutomationEnabledForStage(defaults, 'reminder_3d'), true)
assert.equal(isSmsAutomationEnabledForStage(defaults, 'reminder_2d'), true)
assert.equal(isSmsAutomationEnabledForStage(defaults, 'reminder_1d'), true)
assert.equal(isSmsAutomationEnabledForStage(defaults, 'thank_you'), true)

const disabled = parseAutomationSettings({
  emailEnabled: false,
  smsEnabled: false,
  deliveryPreference: 'store_email',
  fallbackToSedifex: false,
  channels: {},
})
assert.equal(isEmailAutomationEnabled(disabled, 'booking.confirmed'), false)
assert.equal(isSmsAutomationEnabledForStage(disabled, 'booking_confirmed'), false)
assert.equal(isSmsAutomationEnabledForStage(disabled, 'reminder_1d'), false)
assert.equal(disabled.deliveryPreference, 'store_email')
assert.equal(disabled.fallbackToSedifex, false)

const perRule = parseAutomationSettings({
  channels: {
    'booking.payment_confirmed': { email: false, sms: false },
    'booking.reminder_3d': { email: true, sms: false },
    'booking.confirmed': { email: false, sms: true },
    'booking.rescheduled': { email: true, sms: false },
    'booking.payment_received': { email: true, sms: true },
  },
})
assert.equal(isEmailAutomationEnabled(perRule, 'booking.payment_confirmed'), false)
assert.equal(isSmsAutomationEnabledForStage(perRule, 'payment_confirmation'), false)
assert.equal(isSmsAutomationEnabledForStage(perRule, 'reminder_3d'), false)
assert.equal(isEmailAutomationEnabled(perRule, 'booking.confirmed'), false)
assert.equal(isSmsAutomationEnabledForEvent(perRule, 'booking.confirmed'), true)
assert.equal(isSmsAutomationEnabledForStage(perRule, 'booking_confirmed'), true)
assert.equal(isSmsAutomationEnabledForStage(perRule, 'booking_rescheduled'), false)
assert.equal(isSmsAutomationEnabledForEvent(perRule, 'booking.payment_received'), false, 'unsupported SMS events must remain disabled')
assert.equal(perRule.channels['booking.payment_received'].sms, false, 'parser must reject unsupported SMS toggles')

assert.equal(isEmailAutomationEnabled(defaults, 'order.confirmed'), true, 'unknown/non-booking email events must keep existing behavior')
assert.equal(parseAutomationSettings({ deliveryPreference: 'invalid' }).deliveryPreference, 'automatic')

console.log('automation settings tests passed')
