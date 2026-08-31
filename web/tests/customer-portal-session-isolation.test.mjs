import assert from 'node:assert/strict'
import fs from 'node:fs'

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'))
const redirects = vercel.redirects ?? []
for (const host of ['sedifex.com', 'www.sedifex.com']) {
  const match = redirects.find(item => item.source === '/customer-portal/:path*'
    && item.destination === 'https://pay.sedifex.com/customer-portal/:path*'
    && item.has?.some(condition => condition.type === 'host' && condition.value === host))
  assert.ok(match, `Missing customer portal redirect for ${host}`)
}

for (const path of [
  'functions/src/customerPortal.ts',
  'functions/src/customerPortalBookingAutomation.ts',
]) {
  const source = fs.readFileSync(path, 'utf8')
  assert.match(source, /SEDIFEX_CUSTOMER_PORTAL_BASE_URL/)
  assert.match(source, /https:\/\/pay\.sedifex\.com/)
  assert.doesNotMatch(source, /PUBLIC_APP_BASE_URL/)
}

const selfService = fs.readFileSync('functions/src/customerPortalSelfService.ts', 'utf8')
assert.match(selfService, /SEDIFEX_CUSTOMER_PORTAL_BASE_URL/)
assert.match(selfService, /https:\/\/pay\.sedifex\.com/)
assert.match(selfService, /\$\{CUSTOMER_PORTAL_BASE_URL\}\/customer-portal\//)
assert.match(selfService, /\$\{PUBLIC_APP_BASE_URL\}\/bookings\//)

const shareCard = fs.readFileSync('web/src/components/CustomerPortalShareCard.tsx', 'utf8')
assert.match(shareCard, /sessionIsolatedPortalUrl/)
assert.match(shareCard, /pay\.sedifex\.com/)
console.log('Customer portal session isolation regression checks passed.')
