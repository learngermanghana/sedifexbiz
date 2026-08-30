from pathlib import Path
import re

# Route registration
main_path = Path('web/src/main.tsx')
main = main_path.read_text()
import_anchor = "import IntegrationEmailSettings from './pages/IntegrationEmailSettings'\n"
if "import AutomationCenter from './pages/AutomationCenter'" not in main:
    if import_anchor not in main:
        raise SystemExit('main import anchor missing')
    main = main.replace(import_anchor, import_anchor + "import AutomationCenter from './pages/AutomationCenter'\n", 1)
route_anchor = "      { path: 'settings/integrations/email', element: <IntegrationEmailSettings /> },\n"
if "settings/automations" not in main:
    if route_anchor not in main:
        raise SystemExit('main route anchor missing')
    main = main.replace(route_anchor, route_anchor + "      { path: 'settings/automations', element: <AutomationCenter /> },\n", 1)
main_path.write_text(main)

# Navigation
nav_path = Path('web/src/config/navigation.ts')
nav = nav_path.read_text()
nav_anchor = "  { id: 'integrations', label: 'Integrations', type: 'module', target: '/settings/integrations/website', rolesAllowed: ['owner'], sortOrder: 59 },\n"
if "id: 'automations'" not in nav:
    if nav_anchor not in nav:
        raise SystemExit('navigation item anchor missing')
    nav = nav.replace(nav_anchor, nav_anchor + "  { id: 'automations', label: 'Automations', type: 'module', target: '/settings/automations', rolesAllowed: ['owner'], sortOrder: 59.5 },\n", 1)
old_filter = "    if (item.id !== 'account' && !enabledModules.has(item.id)) return false"
new_filter = "    if (!['account', 'automations'].includes(item.id) && !enabledModules.has(item.id)) return false"
if old_filter in nav:
    nav = nav.replace(old_filter, new_filter, 1)
elif new_filter not in nav:
    raise SystemExit('navigation filter anchor missing')
nav_path.write_text(nav)

# Transactional notification settings + activity mirror
notifications_path = Path('functions/src/notifications.ts')
notifications = notifications_path.read_text()
old_type = "type NotificationSettings = { customerEmailEnabled: boolean; storeAlertEnabled: boolean; adminEmails: string[]; replyToEmail: string | null; mode: 'sedifex_default' | 'custom_webhook'; customWebhookEnabled: boolean; customWebhookUrl: string | null }"
new_type = "type NotificationSettings = { customerEmailEnabled: boolean; storeAlertEnabled: boolean; adminEmails: string[]; replyToEmail: string | null; mode: 'sedifex_default' | 'custom_webhook'; customWebhookEnabled: boolean; customWebhookUrl: string | null; deliveryPreference: 'automatic' | 'sedifex' | 'store_email' | 'custom_webhook'; fallbackToSedifex: boolean; automations: Record<string, boolean> }"
if old_type in notifications:
    notifications = notifications.replace(old_type, new_type, 1)
elif new_type not in notifications:
    raise SystemExit('notification settings type anchor missing')

helper_anchor = "function getNestedRecord(record: Record<string, unknown>, key: string) { return getRecord(record[key]) }\n"
helper_code = """function getNestedRecord(record: Record<string, unknown>, key: string) { return getRecord(record[key]) }\nfunction notificationDeliveryPreference(value: unknown): NotificationSettings['deliveryPreference'] {\n  const candidate = text(value, 40)\n  return ['automatic', 'sedifex', 'store_email', 'custom_webhook'].includes(candidate)\n    ? candidate as NotificationSettings['deliveryPreference']\n    : 'automatic'\n}\nfunction booleanSettings(value: unknown) {\n  return Object.fromEntries(Object.entries(getRecord(value)).filter(([, enabled]) => typeof enabled === 'boolean')) as Record<string, boolean>\n}\n"""
if "function notificationDeliveryPreference" not in notifications:
    if helper_anchor not in notifications:
        raise SystemExit('notification helper anchor missing')
    notifications = notifications.replace(helper_anchor, helper_code, 1)

old_defaults = "await settingsRef.set({ notifications: { customerEmailEnabled: existing.customerEmailEnabled !== false, storeAlertEnabled: true, adminEmails: defaultAdminEmails, replyToEmail: email(existing.replyToEmail) || resolvedBrand.email || null, mode: text(existing.mode, 40) || 'sedifex_default', customWebhookEnabled: existing.customWebhookEnabled === true, customWebhookUrl: text(existing.customWebhookUrl, 1000) || null, createdAt: now, updatedAt: now } }, { merge: true })"
new_defaults = "await settingsRef.set({ notifications: { customerEmailEnabled: existing.customerEmailEnabled !== false, storeAlertEnabled: true, adminEmails: defaultAdminEmails, replyToEmail: email(existing.replyToEmail) || resolvedBrand.email || null, mode: text(existing.mode, 40) || 'sedifex_default', customWebhookEnabled: existing.customWebhookEnabled === true, customWebhookUrl: text(existing.customWebhookUrl, 1000) || null, deliveryPreference: notificationDeliveryPreference(existing.deliveryPreference), fallbackToSedifex: existing.fallbackToSedifex !== false, automations: booleanSettings(existing.automations), createdAt: now, updatedAt: now } }, { merge: true })"
if old_defaults in notifications:
    notifications = notifications.replace(old_defaults, new_defaults, 1)
elif new_defaults not in notifications:
    raise SystemExit('notification defaults anchor missing')

old_return = "return { customerEmailEnabled: existing.customerEmailEnabled !== false, storeAlertEnabled: true, adminEmails: defaultAdminEmails, replyToEmail: email(existing.replyToEmail) || resolvedBrand.email, mode: existing.mode === 'custom_webhook' ? 'custom_webhook' : 'sedifex_default', customWebhookEnabled: existing.customWebhookEnabled === true, customWebhookUrl: text(existing.customWebhookUrl, 1000) || null }"
new_return = "return { customerEmailEnabled: existing.customerEmailEnabled !== false, storeAlertEnabled: existing.storeAlertEnabled !== false, adminEmails: defaultAdminEmails, replyToEmail: email(existing.replyToEmail) || resolvedBrand.email, mode: existing.mode === 'custom_webhook' ? 'custom_webhook' : 'sedifex_default', customWebhookEnabled: existing.customWebhookEnabled === true, customWebhookUrl: text(existing.customWebhookUrl, 1000) || null, deliveryPreference: notificationDeliveryPreference(existing.deliveryPreference), fallbackToSedifex: existing.fallbackToSedifex !== false, automations: booleanSettings(existing.automations) }"
if old_return in notifications:
    notifications = notifications.replace(old_return, new_return, 1)
elif new_return not in notifications:
    raise SystemExit('notification return anchor missing')

queue_anchor = "  const settings = await ensureNotificationSettings(storeId, brand)\n"
queue_insert = "  const settings = await ensureNotificationSettings(storeId, brand)\n  if (settings.automations[payload.eventType] === false) {\n    return { ok: true, deliveries: 0, reference: text(payload.reference ?? payload.payment?.reference, 220) || `${payload.eventType}-${Date.now()}`, skipped: true, reason: 'automation-disabled' }\n  }\n"
if "reason: 'automation-disabled'" not in notifications:
    if queue_anchor not in notifications:
        raise SystemExit('notification queue anchor missing')
    notifications = notifications.replace(queue_anchor, queue_insert, 1)

# Add store-scoped activity mirror in createDelivery.
outbox_anchor = "  const outboxRef = defaultDb.collection('notification_outbox').doc()\n  const now = admin.firestore.FieldValue.serverTimestamp()\n"
activity_anchor = "  const outboxRef = defaultDb.collection('notification_outbox').doc()\n  const activityRef = defaultDb.collection('stores').doc(args.payload.storeId).collection('notificationActivity').doc(outboxRef.id)\n  const now = admin.firestore.FieldValue.serverTimestamp()\n"
if "collection('notificationActivity')" not in notifications:
    if outbox_anchor not in notifications:
        raise SystemExit('outbox anchor missing')
    notifications = notifications.replace(outbox_anchor, activity_anchor, 1)

transaction_outbox = "    transaction.set(outboxRef, { storeId: args.payload.storeId, eventType: args.payload.eventType, reference, recipientType: args.recipientType, to: args.to, subject: args.subject, html: args.html, text: args.text, brand: args.brand, customer: args.payload.customer ?? null, payment: args.payload.payment ?? null, data: args.payload.data ?? null, status: 'queued', createdAt: now, updatedAt: now })\n"
transaction_both = transaction_outbox + "    transaction.set(activityRef, { storeId: args.payload.storeId, eventType: args.payload.eventType, reference, recipientType: args.recipientType, to: args.to, subject: args.subject, status: 'queued', createdAt: now, updatedAt: now })\n"
if "transaction.set(activityRef" not in notifications:
    if transaction_outbox not in notifications:
        raise SystemExit('transaction outbox anchor missing')
    notifications = notifications.replace(transaction_outbox, transaction_both, 1)

old_delivery_block = re.compile(r"    if \(webhook\.attempted\) await outboxRef\.set\(\{.*?    return \{ created: true, webhook \}\n", re.S)
new_delivery_block = """    if (webhook.attempted) {\n      const deliveryUpdate = {\n        status: webhook.ok ? 'delivery_accepted' : 'delivery_failed',\n        webhookStatus: webhook.status,\n        deliveryChannel: webhook.channel,\n        deliveryStatus: webhook.deliveryStatus,\n        senderName: webhook.senderName || null,\n        senderEmail: webhook.senderEmail || null,\n        replyToEmail: webhook.replyToEmail || null,\n        deliveryReason: webhook.reason || null,\n        sentToWebhookAt: now,\n        sheetSyncStatus,\n        updatedAt: now,\n      }\n      await Promise.all([outboxRef.set(deliveryUpdate, { merge: true }), activityRef.set(deliveryUpdate, { merge: true })])\n    }\n    if (!webhook.attempted) {\n      const deliveryUpdate = {\n        status: 'queued_no_live_sender',\n        deliveryChannel: webhook.channel,\n        deliveryStatus: webhook.deliveryStatus,\n        senderName: webhook.senderName || null,\n        replyToEmail: webhook.replyToEmail || null,\n        deliveryReason: webhook.reason || null,\n        sheetSyncStatus,\n        updatedAt: now,\n      }\n      await Promise.all([outboxRef.set(deliveryUpdate, { merge: true }), activityRef.set(deliveryUpdate, { merge: true })])\n    }\n    return { created: true, webhook }\n"""
if "activityRef.set(deliveryUpdate" not in notifications:
    notifications, count = old_delivery_block.subn(new_delivery_block, notifications, count=1)
    if count != 1:
        raise SystemExit(f'delivery update block replacement failed: {count}')

old_catch = "    await outboxRef.set({ status: 'webhook_error', errorMessage: error instanceof Error ? error.message : 'webhook-error', sheetSyncStatus, updatedAt: now }, { merge: true })\n"
new_catch = "    const deliveryUpdate = { status: 'webhook_error', errorMessage: error instanceof Error ? error.message : 'webhook-error', sheetSyncStatus, updatedAt: now }\n    await Promise.all([outboxRef.set(deliveryUpdate, { merge: true }), activityRef.set(deliveryUpdate, { merge: true })])\n"
if old_catch in notifications:
    notifications = notifications.replace(old_catch, new_catch, 1)
elif new_catch not in notifications:
    raise SystemExit('notification catch anchor missing')
notifications_path.write_text(notifications)

# Sender preference + fallback behavior
email_path = Path('functions/src/emailDelivery.ts')
email_delivery = email_path.read_text()
settings_anchor = "  const customEnabled = notifications.customWebhookEnabled === true\n"
settings_insert = """  const deliveryPreferenceRaw = text(notifications.deliveryPreference, 40)\n  const deliveryPreference = ['automatic', 'sedifex', 'store_email', 'custom_webhook'].includes(deliveryPreferenceRaw)\n    ? deliveryPreferenceRaw as 'automatic' | 'sedifex' | 'store_email' | 'custom_webhook'\n    : 'automatic'\n  const fallbackToSedifex = notifications.fallbackToSedifex !== false\n\n  const customEnabled = notifications.customWebhookEnabled === true\n"""
if "const deliveryPreferenceRaw" not in email_delivery:
    if settings_anchor not in email_delivery:
        raise SystemExit('email settings anchor missing')
    email_delivery = email_delivery.replace(settings_anchor, settings_insert, 1)
return_anchor = "    customUrl,\n    centralUrl: safeUrl(centralUrl),\n    secret,\n"
return_insert = "    customUrl,\n    centralUrl: safeUrl(centralUrl),\n    secret,\n    deliveryPreference,\n    fallbackToSedifex,\n"
if "    deliveryPreference,\n    fallbackToSedifex," not in email_delivery:
    if return_anchor not in email_delivery:
        raise SystemExit('email settings return anchor missing')
    email_delivery = email_delivery.replace(return_anchor, return_insert, 1)

function_pattern = re.compile(r"export async function deliverTransactionalEmail\(\n  input: TransactionalEmailDeliveryInput,\n\): Promise<TransactionalEmailDeliveryResult> \{.*?\n\}", re.S)
new_function = """export async function deliverTransactionalEmail(\n  input: TransactionalEmailDeliveryInput,\n): Promise<TransactionalEmailDeliveryResult> {\n  const settings = await resolveSettings(input.storeId)\n  const preference = settings.deliveryPreference\n  let lastFailure: TransactionalEmailDeliveryResult | null = null\n\n  const shouldTryStoreEmail = preference === 'automatic' || preference === 'store_email'\n  if (shouldTryStoreEmail && settings.appsScript.configured) {\n    const appsScript = await sendAppsScript(input, settings)\n    if (appsScript.ok || appsScript.deliveryStatus === 'duplicate') return appsScript\n    lastFailure = appsScript\n  }\n\n  if (preference === 'store_email' && !settings.fallbackToSedifex) {\n    if (lastFailure) return lastFailure\n    return { attempted: false, ok: true, status: null, channel: 'outbox_only', deliveryStatus: 'outbox', senderName: settings.storeName, senderEmail: '', replyToEmail: settings.replyToEmail, reason: 'store-email-not-configured' }\n  }\n\n  const shouldTryCustom = preference === 'automatic' || preference === 'custom_webhook'\n  if (shouldTryCustom && settings.customUrl) {\n    const custom = await sendWebhook(input, settings, settings.customUrl, 'custom_webhook')\n    if (custom.ok) return custom\n    lastFailure = custom\n  }\n\n  if (preference === 'custom_webhook' && !settings.fallbackToSedifex) {\n    if (lastFailure) return lastFailure\n    return { attempted: false, ok: true, status: null, channel: 'outbox_only', deliveryStatus: 'outbox', senderName: settings.storeName, senderEmail: '', replyToEmail: settings.replyToEmail, reason: 'custom-webhook-not-configured' }\n  }\n\n  const shouldTrySedifex = preference === 'sedifex' || preference === 'automatic' || settings.fallbackToSedifex\n  if (shouldTrySedifex && settings.centralUrl) {\n    const sedifex = await sendWebhook(input, settings, settings.centralUrl, 'sedifex_notification')\n    if (sedifex.ok) return sedifex\n    lastFailure = sedifex\n  }\n\n  if (lastFailure) return lastFailure\n\n  return {\n    attempted: false,\n    ok: true,\n    status: null,\n    channel: 'outbox_only',\n    deliveryStatus: 'outbox',\n    senderName: settings.storeName,\n    senderEmail: '',\n    replyToEmail: settings.replyToEmail,\n    reason: preference === 'sedifex' ? 'sedifex-live-sender-not-configured' : 'no-live-email-sender-configured',\n  }\n}"""
email_delivery, count = function_pattern.subn(new_function, email_delivery, count=1)
if count != 1:
    raise SystemExit(f'email delivery function replacement failed: {count}')
email_path.write_text(email_delivery)

# Security boundary for the new store-scoped activity collection.
rules_path = Path('firestore.rules')
rules = rules_path.read_text()
activity_rule_anchor = "    // Secure public contract links contain bearer URLs and signing audit data.\n"
activity_rule = """    // Transactional email activity contains customer addresses and delivery metadata.\n    // Store members may read it, while browser clients cannot forge delivery history.\n    match /stores/{storeId}/notificationActivity/{activityId} {\n      allow read: if hasStoreAccess(storeId);\n      allow create, update, delete: if false;\n    }\n\n"""
if "match /stores/{storeId}/notificationActivity/{activityId}" not in rules:
    if activity_rule_anchor not in rules:
        raise SystemExit('firestore activity rule anchor missing')
    rules = rules.replace(activity_rule_anchor, activity_rule + activity_rule_anchor, 1)
old_generic = "        && subCollection != 'eventActivity'\n        && subCollection != 'eventContractTemplates';"
new_generic = "        && subCollection != 'eventActivity'\n        && subCollection != 'eventContractTemplates'\n        && subCollection != 'notificationActivity';"
if old_generic in rules:
    rules = rules.replace(old_generic, new_generic, 1)
elif new_generic not in rules:
    raise SystemExit('firestore generic exclusion anchor missing')
rules_path.write_text(rules)

print('Automation Center integration patch applied.')
