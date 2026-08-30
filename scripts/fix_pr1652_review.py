from pathlib import Path

# 1) Restrict notification settings writes to store owners and prevent the
# legacy authenticated wildcard from bypassing the storeSettings rule.
rules_path = Path('firestore.rules')
rules = rules_path.read_text()
old_store_settings = """    match /storeSettings/{docId} {\n      allow read: if true;\n      allow write: if isSignedIn();\n    }\n"""
new_store_settings = """    match /storeSettings/{storeId} {\n      allow read: if true;\n      allow create, update, delete: if isStoreOwner(storeId);\n    }\n"""
if old_store_settings in rules:
    rules = rules.replace(old_store_settings, new_store_settings, 1)
elif new_store_settings not in rules:
    raise SystemExit('storeSettings rule anchor missing')

legacy_anchor = """        && topCollection != 'customers'\n        && topCollection != 'eventContractLinks'\n        && topCollection != 'eventClientLinks';\n"""
legacy_replacement = """        && topCollection != 'customers'\n        && topCollection != 'storeSettings'\n        && topCollection != 'eventContractLinks'\n        && topCollection != 'eventClientLinks';\n"""
if legacy_anchor in rules:
    rules = rules.replace(legacy_anchor, legacy_replacement, 1)
elif "&& topCollection != 'storeSettings'" not in rules:
    raise SystemExit('legacy wildcard anchor missing')
rules_path.write_text(rules)

# 2) Honor fallbackToSedifex in automatic mode and never retry a custom URL
# as the central sender after that same endpoint already failed.
email_path = Path('functions/src/emailDelivery.ts')
email_text = email_path.read_text()
last_failure_anchor = """  const preference = settings.deliveryPreference\n  let lastFailure: TransactionalEmailDeliveryResult | null = null\n"""
last_failure_replacement = """  const preference = settings.deliveryPreference\n  let lastFailure: TransactionalEmailDeliveryResult | null = null\n  let attemptedCustomUrl = ''\n"""
if last_failure_anchor in email_text:
    email_text = email_text.replace(last_failure_anchor, last_failure_replacement, 1)
elif "let attemptedCustomUrl = ''" not in email_text:
    raise SystemExit('email delivery state anchor missing')

custom_anchor = """  if (shouldTryCustom && settings.customUrl) {\n    const custom = await sendWebhook(input, settings, settings.customUrl, 'custom_webhook')\n"""
custom_replacement = """  if (shouldTryCustom && settings.customUrl) {\n    attemptedCustomUrl = settings.customUrl\n    const custom = await sendWebhook(input, settings, settings.customUrl, 'custom_webhook')\n"""
if custom_anchor in email_text:
    email_text = email_text.replace(custom_anchor, custom_replacement, 1)
elif "attemptedCustomUrl = settings.customUrl" not in email_text:
    raise SystemExit('custom webhook anchor missing')

sedifex_anchor = """  const shouldTrySedifex = preference === 'sedifex' || preference === 'automatic' || settings.fallbackToSedifex\n  if (shouldTrySedifex && settings.centralUrl) {\n"""
sedifex_replacement = """  const shouldTrySedifex = preference === 'sedifex' || settings.fallbackToSedifex\n  if (shouldTrySedifex && settings.centralUrl && settings.centralUrl !== attemptedCustomUrl) {\n"""
if sedifex_anchor in email_text:
    email_text = email_text.replace(sedifex_anchor, sedifex_replacement, 1)
elif sedifex_replacement not in email_text:
    raise SystemExit('Sedifex fallback anchor missing')
email_path.write_text(email_text)

# 3) Prevent old store activity queries from replacing the newly selected
# store. A request token also prevents older same-store refreshes from winning.
ui_path = Path('web/src/pages/AutomationCenter.tsx')
ui = ui_path.read_text()
ui = ui.replace(
    "import React, { useEffect, useMemo, useState } from 'react'",
    "import React, { useEffect, useMemo, useRef, useState } from 'react'",
    1,
)
store_anchor = """export default function AutomationCenter() {\n  const { storeId } = useActiveStore()\n  const { memberships, loading: membershipsLoading } = useMemberships()\n"""
store_replacement = """export default function AutomationCenter() {\n  const { storeId } = useActiveStore()\n  const activeStoreRef = useRef(storeId)\n  activeStoreRef.current = storeId\n  const activityRequestRef = useRef(0)\n  const { memberships, loading: membershipsLoading } = useMemberships()\n"""
if store_anchor in ui:
    ui = ui.replace(store_anchor, store_replacement, 1)
elif "const activityRequestRef = useRef(0)" not in ui:
    raise SystemExit('AutomationCenter store anchor missing')

load_anchor = """  async function loadActivity(activeStoreId: string, quiet = false) {\n    if (!quiet) setRefreshing(true)\n    try {\n      const snapshot = await getDocs(query(\n        collection(db, 'stores', activeStoreId, 'notificationActivity'),\n        orderBy('createdAt', 'desc'),\n        limit(50),\n      ))\n      setActivity(snapshot.docs.map(document => {\n        const data = document.data()\n        return {\n          id: document.id,\n          eventType: stringValue(data.eventType),\n          recipientType: stringValue(data.recipientType),\n          to: stringValue(data.to),\n          subject: stringValue(data.subject),\n          status: stringValue(data.status),\n          deliveryChannel: stringValue(data.deliveryChannel),\n          deliveryStatus: stringValue(data.deliveryStatus),\n          deliveryReason: stringValue(data.deliveryReason),\n          createdAt: dateValue(data.createdAt),\n        }\n      }))\n    } catch (activityError) {\n      console.warn('[automation-center] Unable to load notification activity', activityError)\n      if (!quiet) setError(activityError instanceof Error ? activityError.message : 'Unable to load automation activity.')\n    } finally {\n      if (!quiet) setRefreshing(false)\n    }\n  }\n"""
load_replacement = """  async function loadActivity(activeStoreId: string, quiet = false) {\n    const requestId = ++activityRequestRef.current\n    if (!quiet) setRefreshing(true)\n    try {\n      const snapshot = await getDocs(query(\n        collection(db, 'stores', activeStoreId, 'notificationActivity'),\n        orderBy('createdAt', 'desc'),\n        limit(50),\n      ))\n      const rows = snapshot.docs.map(document => {\n        const data = document.data()\n        return {\n          id: document.id,\n          eventType: stringValue(data.eventType),\n          recipientType: stringValue(data.recipientType),\n          to: stringValue(data.to),\n          subject: stringValue(data.subject),\n          status: stringValue(data.status),\n          deliveryChannel: stringValue(data.deliveryChannel),\n          deliveryStatus: stringValue(data.deliveryStatus),\n          deliveryReason: stringValue(data.deliveryReason),\n          createdAt: dateValue(data.createdAt),\n        }\n      })\n      if (requestId !== activityRequestRef.current || activeStoreRef.current !== activeStoreId) return\n      setActivity(rows)\n    } catch (activityError) {\n      if (requestId !== activityRequestRef.current || activeStoreRef.current !== activeStoreId) return\n      console.warn('[automation-center] Unable to load notification activity', activityError)\n      if (!quiet) setError(activityError instanceof Error ? activityError.message : 'Unable to load automation activity.')\n    } finally {\n      if (!quiet && requestId === activityRequestRef.current && activeStoreRef.current === activeStoreId) {\n        setRefreshing(false)\n      }\n    }\n  }\n"""
if load_anchor in ui:
    ui = ui.replace(load_anchor, load_replacement, 1)
elif "requestId !== activityRequestRef.current" not in ui:
    raise SystemExit('AutomationCenter loadActivity anchor missing')

# When the workspace changes, clear the old log immediately while the new log loads.
effect_anchor = """    let cancelled = false\n    async function load() {\n      setLoading(true)\n      setError('')\n"""
effect_replacement = """    let cancelled = false\n    async function load() {\n      setLoading(true)\n      setRefreshing(false)\n      setActivity([])\n      setError('')\n"""
if effect_anchor in ui:
    ui = ui.replace(effect_anchor, effect_replacement, 1)
elif "setActivity([])" not in ui:
    raise SystemExit('AutomationCenter effect anchor missing')
ui_path.write_text(ui)

print('PR #1652 review fixes applied.')
