from pathlib import Path

path = Path('web/tests/event-planning-security-regressions.rules.emulator.test.ts')
text = path.read_text()
marker = "test('only the owning store can change automation notification settings'"
if marker not in text:
    insert = r'''

  test('only the owning store can change automation notification settings', async () => {
    const owner = await createOwner()
    const staff = await createStaff(owner)
    const otherOwner = await createOwner()
    try {
      const ownerSettingsRef = doc(owner.db, 'storeSettings', owner.storeId)
      await setDoc(ownerSettingsRef, {
        notifications: {
          automations: { 'booking.confirmed': false },
          fallbackToSedifex: false,
        },
      }, { merge: true })

      const ownSnapshot = await getDoc(ownerSettingsRef)
      if (!ownSnapshot.exists()) throw new Error('owner must be able to write own store notification settings')

      await expectPermissionDenied(
        setDoc(doc(staff.db, 'storeSettings', owner.storeId), {
          notifications: { automations: { 'booking.confirmed': false } },
        }, { merge: true }),
        'staff must not be able to disable store automation emails',
      )

      await expectPermissionDenied(
        setDoc(doc(otherOwner.db, 'storeSettings', owner.storeId), {
          notifications: { automations: { 'booking.confirmed': false } },
        }, { merge: true }),
        'another store owner must not be able to disable a different store automation',
      )
    } finally {
      await destroyContext(otherOwner)
      await destroyContext(staff)
      await destroyContext(owner)
    }
  })
'''
    closing = text.rfind('\n})')
    if closing < 0:
      raise SystemExit('describe closing anchor missing')
    text = text[:closing] + insert + text[closing:]
    path.write_text(text)
    print('Automation settings security regression test added.')
else:
    print('Automation settings security regression test already present.')
