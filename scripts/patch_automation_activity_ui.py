from pathlib import Path

path = Path('web/src/pages/AutomationCenter.tsx')
text = path.read_text()
old = """      const snapshot = await getDocs(query(\n        collection(db, 'notification_outbox'),\n        where('storeId', '==', activeStoreId),\n        orderBy('createdAt', 'desc'),\n        limit(50),\n      ))\n"""
new = """      const snapshot = await getDocs(query(\n        collection(db, 'stores', activeStoreId, 'notificationActivity'),\n        orderBy('createdAt', 'desc'),\n        limit(50),\n      ))\n"""
if old not in text:
    if new in text:
        print('Activity query already updated.')
    else:
        raise SystemExit('activity query anchor missing')
else:
    text = text.replace(old, new, 1)
    path.write_text(text)
    print('Activity query updated.')
