from pathlib import Path

path = Path('functions/src/customerPortal.ts')
text = path.read_text()

old_scan = """async function scanCollection(ref: FirebaseFirestore.CollectionReference, customerId: string, customer: RecordMap) {\n  const snapshot = await ref.limit(COLLECTION_SCAN_LIMIT).get()\n  return snapshot.docs\n    .map(item => ({ id: item.id, data: item.data() as RecordMap }))\n    .filter(item => matchesCustomer(customerId, customer, item.data))\n}\n"""
new_scan = """async function scanCollection(ref: FirebaseFirestore.CollectionReference, customerId: string, customer: RecordMap) {\n  const directSnapshots = await Promise.all([\n    ref.where('customerId', '==', customerId).limit(200).get(),\n    ref.where('customer_id', '==', customerId).limit(200).get(),\n  ])\n  const direct = new Map<string, { id: string; data: RecordMap }>()\n  directSnapshots.forEach(snapshot => snapshot.docs.forEach(item => direct.set(item.id, { id: item.id, data: item.data() as RecordMap })))\n  if (direct.size) return Array.from(direct.values())\n\n  // Legacy fallback for older rows created before canonical customer IDs were\n  // backfilled. This is deliberately bounded; current booking/invoice/receipt\n  // writers attach customerId and customer_id automatically.\n  const snapshot = await ref.limit(COLLECTION_SCAN_LIMIT).get()\n  return snapshot.docs\n    .map(item => ({ id: item.id, data: item.data() as RecordMap }))\n    .filter(item => matchesCustomer(customerId, customer, item.data))\n}\n"""
if old_scan in text:
    text = text.replace(old_scan, new_scan, 1)
elif new_scan not in text:
    raise SystemExit('scanCollection anchor missing')

old_invoice = """function mapInvoice(id: string, data: RecordMap) {\n  return {\n    id,\n    invoiceNumber: firstText(data, ['invoiceNumber', 'number', 'reference']) || id,\n    status: firstText(data, ['status']) || 'draft',\n    currency: firstText(data, ['currency']) || 'GHS',\n    total: firstNumber(data, ['total', 'grandTotal', 'amount']),\n    amountPaid: firstNumber(data, ['amountPaid', 'paidAmount']),\n    balance: firstNumber(data, ['balance', 'amountOutstanding']),\n    dueDate: dateToIso(data.dueDate) || firstText(data, ['dueDate']),\n    createdAt: dateToIso(data.createdAt),\n    updatedAt: dateToIso(data.updatedAt),\n    publicUrl: firstText(data, ['publicUrl', 'shareUrl', 'documentUrl']),\n  }\n}\n"""
new_invoice = """function mapInvoice(id: string, data: RecordMap) {\n  const status = firstText(data, ['status']) || 'draft'\n  const total = firstNumber(data, ['total', 'grandTotal', 'amount'])\n  const amountPaid = firstNumber(data, ['amountPaid', 'paidAmount'])\n  const directBalance = firstNumber(data, ['balance', 'amountOutstanding'])\n  const balance = directBalance !== null\n    ? Math.max(0, directBalance)\n    : ['paid', 'cancelled', 'canceled', 'void'].includes(status.toLowerCase())\n      ? 0\n      : total !== null && amountPaid !== null\n        ? Math.max(0, total - amountPaid)\n        : null\n  return {\n    id,\n    invoiceNumber: firstText(data, ['invoiceNumber', 'number', 'reference']) || id,\n    status,\n    currency: firstText(data, ['currency']) || 'GHS',\n    total,\n    amountPaid,\n    balance,\n    dueDate: dateToIso(data.dueDate) || firstText(data, ['dueDate']),\n    createdAt: dateToIso(data.createdAt),\n    updatedAt: dateToIso(data.updatedAt),\n    publicUrl: firstText(data, ['publicUrl', 'shareUrl', 'documentUrl']),\n  }\n}\n"""
if old_invoice in text:
    text = text.replace(old_invoice, new_invoice, 1)
elif new_invoice not in text:
    raise SystemExit('mapInvoice anchor missing')

path.write_text(text)
print('Customer portal backend refined.')
