from pathlib import Path

# Functions export
index_path = Path('functions/src/index.ts')
index_text = index_path.read_text()
anchor = """export {\n  shareEventClientPortal,\n  eventClientPortal,\n} from './eventClientCollaboration'\n"""
replacement = anchor + """export {\n  shareCustomerPortal,\n  revokeCustomerPortal,\n  getCustomerPortal,\n} from './customerPortal'\n"""
if replacement not in index_text:
    if anchor not in index_text:
        raise SystemExit('functions index anchor missing')
    index_text = index_text.replace(anchor, replacement, 1)
index_path.write_text(index_text)

# Public web route
main_path = Path('web/src/main.tsx')
main_text = main_path.read_text()
import_anchor = "import PublicQuickPayReceipt from './pages/PublicQuickPayReceipt'\n"
import_line = "import PublicCustomerPortal from './pages/PublicCustomerPortal'\n"
if import_line not in main_text:
    if import_anchor not in main_text:
        raise SystemExit('main import anchor missing')
    main_text = main_text.replace(import_anchor, import_anchor + import_line, 1)
route_anchor = "  { path: '/event-contract/:token', element: <PublicEventContractPage /> },\n"
route_line = "  { path: '/customer-portal/:token', element: <PublicCustomerPortal /> },\n"
if route_line not in main_text:
    if route_anchor not in main_text:
        raise SystemExit('main route anchor missing')
    main_text = main_text.replace(route_anchor, route_anchor + route_line, 1)
main_path.write_text(main_text)

# CRM share card
crm_path = Path('web/src/pages/CustomerCRM.tsx')
crm_text = crm_path.read_text()
crm_import_anchor = "import { useActiveStore } from '../hooks/useActiveStore'\n"
crm_import = "import CustomerPortalShareCard from '../components/CustomerPortalShareCard'\n"
if crm_import not in crm_text:
    if crm_import_anchor not in crm_text:
        raise SystemExit('CRM import anchor missing')
    crm_text = crm_text.replace(crm_import_anchor, crm_import_anchor + crm_import, 1)
profile_anchor = """              <section className=\"customer-crm__stats\" aria-label=\"Customer CRM summary\">\n"""
card = """              {storeId ? (\n                <CustomerPortalShareCard\n                  storeId={storeId}\n                  customerId={selectedCustomer.id}\n                  customerName={customerName(selectedCustomer)}\n                  customerEmail={selectedCustomer.email}\n                />\n              ) : null}\n\n"""
if card not in crm_text:
    if profile_anchor not in crm_text:
        raise SystemExit('CRM profile anchor missing')
    crm_text = crm_text.replace(profile_anchor, card + profile_anchor, 1)
crm_path.write_text(crm_text)

# Firestore rules: customer portal links are bearer credentials and must only be
# accessed through Admin SDK functions.
rules_path = Path('firestore.rules')
rules = rules_path.read_text()
secure_anchor = """    match /eventClientLinks/{linkId} {\n      allow read, create, update, delete: if false;\n    }\n"""
secure_rule = secure_anchor + """\n    // Customer portal links are bearer credentials. Public clients access the\n    // portal through a callable function; browser Firestore clients must never\n    // enumerate or forge these records.\n    match /customerPortalLinks/{linkId} {\n      allow read, create, update, delete: if false;\n    }\n"""
if "match /customerPortalLinks/{linkId}" not in rules:
    if secure_anchor not in rules:
        raise SystemExit('secure link rules anchor missing')
    rules = rules.replace(secure_anchor, secure_rule, 1)
legacy_anchor = """        && topCollection != 'eventContractLinks'\n        && topCollection != 'eventClientLinks';\n"""
legacy_replacement = """        && topCollection != 'eventContractLinks'\n        && topCollection != 'eventClientLinks'\n        && topCollection != 'customerPortalLinks';\n"""
if "&& topCollection != 'customerPortalLinks'" not in rules:
    if legacy_anchor not in rules:
        raise SystemExit('legacy wildcard anchor missing')
    rules = rules.replace(legacy_anchor, legacy_replacement, 1)
rules_path.write_text(rules)

# Security regression: even an authenticated store owner cannot directly read or
# forge a customer portal bearer-link record.
test_path = Path('web/tests/event-planning-security-regressions.rules.emulator.test.ts')
test_text = test_path.read_text()
marker = "test('customer portal bearer-link records are never exposed to browser Firestore clients'"
if marker not in test_text:
    insert = r'''

  test('customer portal bearer-link records are never exposed to browser Firestore clients', async () => {
    const owner = await createOwner()
    try {
      const linkRef = doc(owner.db, 'customerPortalLinks', 'browser-must-not-access-customer-portal-link')
      await expectPermissionDenied(
        setDoc(linkRef, {
          storeId: owner.storeId,
          customerId: 'customer-1',
          status: 'active',
        }),
        'store owner must not be able to forge a customer portal bearer-link record directly',
      )
      await expectPermissionDenied(
        getDoc(linkRef),
        'store owner must not be able to read customer portal bearer-link records directly',
      )
    } finally {
      await destroyContext(owner)
    }
  })
'''
    closing = test_text.rfind('\n})')
    if closing < 0:
        raise SystemExit('security test describe closing anchor missing')
    test_text = test_text[:closing] + insert + test_text[closing:]
    test_path.write_text(test_text)

print('Customer portal wiring applied.')
