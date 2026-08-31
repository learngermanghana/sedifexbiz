from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

OLD_CONST = "const PUBLIC_APP_BASE_URL = (process.env.SEDIFEX_PUBLIC_APP_URL || 'https://sedifex.com').replace(/\\/$/, '')"
PORTAL_CONST = "const CUSTOMER_PORTAL_BASE_URL = (process.env.SEDIFEX_CUSTOMER_PORTAL_BASE_URL || 'https://pay.sedifex.com').replace(/\\/$/, '')"

for relative in [
    'functions/src/customerPortal.ts',
    'functions/src/customerPortalBookingAutomation.ts',
]:
    path = ROOT / relative
    text = path.read_text()
    if OLD_CONST not in text:
        raise SystemExit(f'Expected public app base constant not found in {path}')
    text = text.replace(OLD_CONST, PORTAL_CONST, 1)
    text = text.replace('${PUBLIC_APP_BASE_URL}/customer-portal/', '${CUSTOMER_PORTAL_BASE_URL}/customer-portal/')
    if 'PUBLIC_APP_BASE_URL' in text:
        raise SystemExit(f'Unexpected PUBLIC_APP_BASE_URL remains in {path}')
    path.write_text(text)

self_service = ROOT / 'functions/src/customerPortalSelfService.ts'
text = self_service.read_text()
if OLD_CONST not in text:
    raise SystemExit('Expected public app base constant not found in customerPortalSelfService.ts')
text = text.replace(OLD_CONST, OLD_CONST + '\n' + PORTAL_CONST, 1)
text = text.replace('${PUBLIC_APP_BASE_URL}/customer-portal/', '${CUSTOMER_PORTAL_BASE_URL}/customer-portal/')
if '${CUSTOMER_PORTAL_BASE_URL}/customer-portal/' not in text:
    raise SystemExit('Customer portal return URL was not isolated in customerPortalSelfService.ts')
if '${PUBLIC_APP_BASE_URL}/bookings/' not in text:
    raise SystemExit('Admin booking detail URL should continue using PUBLIC_APP_BASE_URL')
self_service.write_text(text)

share_card = ROOT / 'web/src/components/CustomerPortalShareCard.tsx'
text = share_card.read_text()
needle = "function errorMessage(error: unknown) {\n  if (!error || typeof error !== 'object' || !('message' in error)) return 'Customer portal action failed.'\n  return String((error as { message?: unknown }).message || '').replace(/^FirebaseError:\\s*/i, '') || 'Customer portal action failed.'\n}\n"
addition = needle + "\nfunction sessionIsolatedPortalUrl(value: string) {\n  if (!value) return ''\n  try {\n    const url = new URL(value)\n    if ((url.hostname === 'sedifex.com' || url.hostname === 'www.sedifex.com') && url.pathname.startsWith('/customer-portal/')) {\n      url.hostname = 'pay.sedifex.com'\n      url.protocol = 'https:'\n      return url.toString()\n    }\n  } catch {\n    // Keep non-standard/legacy values untouched.\n  }\n  return value\n}\n"
if needle not in text:
    raise SystemExit('CustomerPortalShareCard insertion point not found')
text = text.replace(needle, addition, 1)
text = text.replace("setPortalUrl(portal.status === 'active' ? text(portal.publicUrl) : '')", "setPortalUrl(portal.status === 'active' ? sessionIsolatedPortalUrl(text(portal.publicUrl)) : '')", 1)
text = text.replace("setPortalUrl(response.data.portalUrl)", "setPortalUrl(sessionIsolatedPortalUrl(response.data.portalUrl))", 1)
share_card.write_text(text)

vercel_path = ROOT / 'vercel.json'
vercel = json.loads(vercel_path.read_text())
portal_redirects = [
    {
        'source': '/customer-portal/:path*',
        'has': [{'type': 'host', 'value': 'sedifex.com'}],
        'destination': 'https://pay.sedifex.com/customer-portal/:path*',
        'permanent': False,
    },
    {
        'source': '/customer-portal/:path*',
        'has': [{'type': 'host', 'value': 'www.sedifex.com'}],
        'destination': 'https://pay.sedifex.com/customer-portal/:path*',
        'permanent': False,
    },
]
existing = [item for item in vercel.get('redirects', []) if not (item.get('source') == '/customer-portal/:path*' and item.get('destination') == 'https://pay.sedifex.com/customer-portal/:path*')]
vercel['redirects'] = portal_redirects + existing
vercel_path.write_text(json.dumps(vercel, indent=2) + '\n')

test_path = ROOT / 'web/tests/customer-portal-session-isolation.test.mjs'
test_path.write_text(r"""import assert from 'node:assert/strict'
import fs from 'node:fs'

const vercel = JSON.parse(fs.readFileSync('../vercel.json', 'utf8'))
const redirects = vercel.redirects ?? []
for (const host of ['sedifex.com', 'www.sedifex.com']) {
  const match = redirects.find(item => item.source === '/customer-portal/:path*'
    && item.destination === 'https://pay.sedifex.com/customer-portal/:path*'
    && item.has?.some(condition => condition.type === 'host' && condition.value === host))
  assert.ok(match, `Missing customer portal redirect for ${host}`)
}

for (const path of [
  '../functions/src/customerPortal.ts',
  '../functions/src/customerPortalBookingAutomation.ts',
]) {
  const source = fs.readFileSync(path, 'utf8')
  assert.match(source, /SEDIFEX_CUSTOMER_PORTAL_BASE_URL/)
  assert.match(source, /https:\/\/pay\.sedifex\.com/)
  assert.doesNotMatch(source, /PUBLIC_APP_BASE_URL/)
}

const selfService = fs.readFileSync('../functions/src/customerPortalSelfService.ts', 'utf8')
assert.match(selfService, /SEDIFEX_CUSTOMER_PORTAL_BASE_URL/)
assert.match(selfService, /https:\/\/pay\.sedifex\.com/)
assert.match(selfService, /\$\{CUSTOMER_PORTAL_BASE_URL\}\/customer-portal\//)
assert.match(selfService, /\$\{PUBLIC_APP_BASE_URL\}\/bookings\//)

const shareCard = fs.readFileSync('src/components/CustomerPortalShareCard.tsx', 'utf8')
assert.match(shareCard, /sessionIsolatedPortalUrl/)
assert.match(shareCard, /pay\.sedifex\.com/)
console.log('Customer portal session isolation regression checks passed.')
""")
