from pathlib import Path

path = Path('functions/src/customerPortalSelfService.ts')
text = path.read_text()
old = """  let reviewedRequest: PortalRequest | null = null
  let customerId = ''
  let customer: RecordMap = {}
  let bookingAfter: RecordMap = {}

  await defaultDb.runTransaction(async transaction => {
"""
new = """  let customer: RecordMap = {}

  const reviewResult = await defaultDb.runTransaction(async transaction => {
"""
if old not in text:
    raise SystemExit('transaction declaration marker missing')
text = text.replace(old, new, 1)
text = text.replace("    customerId = explicitBookingCustomerId(booking)\n", "    const customerId = explicitBookingCustomerId(booking)\n", 1)
text = text.replace("    reviewedRequest = {\n", "    const reviewedRequest: PortalRequest = {\n", 1)
old_end = """    transaction.set(bookingRef, update, { merge: true })
    bookingAfter = { ...booking, ...update }
  })

  if (!reviewedRequest) throw new functions.https.HttpsError('internal', 'Unable to review this request')
  if (customerId) {
"""
new_end = """    transaction.set(bookingRef, update, { merge: true })
    const bookingAfter = { ...booking, ...update }
    return { reviewedRequest, customerId, bookingAfter }
  })

  const { reviewedRequest, bookingAfter } = reviewResult
  let { customerId } = reviewResult
  if (customerId) {
"""
if old_end not in text:
    raise SystemExit('transaction return marker missing')
text = text.replace(old_end, new_end, 1)
path.write_text(text)
