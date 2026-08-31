from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FUNCTION_FILES = [
    ROOT / 'functions/src/customerPortal.ts',
    ROOT / 'functions/src/customerPortalBookingAutomation.ts',
    ROOT / 'functions/src/customerPortalSelfService.ts',
]

OLD_CONST = "const PUBLIC_APP_BASE_URL = (process.env.SEDIFEX_PUBLIC_APP_URL || 'https://sedifex.com').replace(/\\/$/, '')"
NEW_CONST = "const CUSTOMER_PORTAL_BASE_URL = (process.env.SEDIFEX_CUSTOMER_PORTAL_BASE_URL || 'https://pay.sedifex.com').replace(/\\/$/, '')"

for path in FUNCTION_FILES:
    text = path.read_text()
    if OLD_CONST not in text:
        raise SystemExit(f'Expected public app base constant not found in {path}')
    text = text.replace(OLD_CONST, NEW_CONST, 1)
    text = text.replace('${PUBLIC_APP_BASE_URL}/customer-portal/', '${CUSTOMER_PORTAL_BASE_URL}/customer-portal/')
    if 'PUBLIC_APP_BASE_URL' in text:
        raise SystemExit(f'Unexpected PUBLIC_APP_BASE_URL remains in {path}')
    path.write_text(text)

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

web_ci = ROOT / '.github/workflows/web-ci.yml'
ci = web_ci.read_text()
if "      - 'vercel.json'\n" not in ci:
    ci = ci.replace("      - 'firebase.event-planning-ci.json'\n", "      - 'firebase.event-planning-ci.json'\n      - 'vercel.json'\n", 1)
step = "\n      - name: Test customer portal session isolation\n        run: node tests/customer-portal-session-isolation.test.mjs\n        working-directory: web\n"
if 'Test customer portal session isolation' not in ci:
    ci = ci.replace("\n      - name: Test event task progress\n", step + "\n      - name: Test event task progress\n", 1)
web_ci.write_text(ci)

test_path = ROOT / 'web/tests/customer-portal-session-isolation.test.mjs'
test_path.write_text("""import assert from 'node:assert/strict'\nimport fs from 'node:fs'\n\nconst vercel = JSON.parse(fs.readFileSync('../vercel.json', 'utf8'))\nconst redirects = vercel.redirects ?? []\nfor (const host of ['sedifex.com', 'www.sedifex.com']) {\n  const match = redirects.find(item => item.source === '/customer-portal/:path*'\n    && item.destination === 'https://pay.sedifex.com/customer-portal/:path*'\n    && item.has?.some(condition => condition.type === 'host' && condition.value === host))\n  assert.ok(match, `Missing customer portal redirect for ${host}`)\n}\n\nfor (const path of [\n  '../functions/src/customerPortal.ts',\n  '../functions/src/customerPortalBookingAutomation.ts',\n  '../functions/src/customerPortalSelfService.ts',\n]) {\n  const source = fs.readFileSync(path, 'utf8')\n  assert.match(source, /SEDIFEX_CUSTOMER_PORTAL_BASE_URL/)\n  assert.match(source, /https:\/\/pay\\.sedifex\\.com/)\n  assert.doesNotMatch(source, /PUBLIC_APP_BASE_URL/)\n}\n\nconst shareCard = fs.readFileSync('src/components/CustomerPortalShareCard.tsx', 'utf8')\nassert.match(shareCard, /sessionIsolatedPortalUrl/)\nassert.match(shareCard, /pay\\.sedifex\\.com/)\nconsole.log('Customer portal session isolation regression checks passed.')\n""")
