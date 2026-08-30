from pathlib import Path

path = Path('web/src/pages/AutomationCenter.tsx')
text = path.read_text()
text = text.replace("  setDoc,\n", "  setDoc,\n  updateDoc,\n")
old = """      await setDoc(doc(db, 'storeSettings', storeId), {\n        notifications: {\n          customerEmailEnabled,\n          adminEmails: Array.from(new Set(recipients)),\n          replyToEmail: replyToEmail.trim().toLowerCase() || null,\n          deliveryPreference,\n          fallbackToSedifex,\n          automations,\n          updatedAt: serverTimestamp(),\n        },\n      }, { merge: true })\n"""
new = """      const settingsRef = doc(db, 'storeSettings', storeId)\n      await setDoc(settingsRef, {}, { merge: true })\n      await updateDoc(settingsRef, {\n        'notifications.customerEmailEnabled': customerEmailEnabled,\n        'notifications.adminEmails': Array.from(new Set(recipients)),\n        'notifications.replyToEmail': replyToEmail.trim().toLowerCase() || null,\n        'notifications.deliveryPreference': deliveryPreference,\n        'notifications.fallbackToSedifex': fallbackToSedifex,\n        'notifications.automations': automations,\n        'notifications.updatedAt': serverTimestamp(),\n      })\n"""
if old not in text:
    if new not in text:
        raise SystemExit('save settings anchor missing')
else:
    text = text.replace(old, new, 1)
path.write_text(text)
print('Automation settings save updated.')
