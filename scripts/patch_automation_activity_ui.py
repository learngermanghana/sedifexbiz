from pathlib import Path

path = Path('web/src/pages/AutomationCenter.tsx')
text = path.read_text()
old = """      const snapshot = await getDocs(query(\n        collection(db, 'notification_outbox'),\n        where('storeId', '==', activeStoreId),\n        orderBy('createdAt', 'desc'),\n        limit(50),\n      ))\n"""
new = """      const snapshot = await getDocs(query(\n        collection(db, 'stores', activeStoreId, 'notificationActivity'),\n        orderBy('createdAt', 'desc'),\n        limit(50),\n      ))\n"""
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('activity query anchor missing')
text = text.replace("  where,\n", "")
path.write_text(text)
print('Automation activity UI cleanup applied.')
