from pathlib import Path

path = Path('functions/src/customerPortal.ts')
text = path.read_text()
old = """  const amountReceived = firstNumber(data, ['amountReceived', 'amountPaid', 'paidAmount', 'depositAmount', 'payment.amountReceived', 'payment.amountPaid', 'payment.depositAmount'])
  const total = firstNumber(data, ['totalAmount', 'paymentAmount', 'amount', 'total', 'grandTotal', 'payment.amount'])
  const amountPaid = amountReceived !== null
    ? Math.max(0, amountReceived)
    : payment.confirmed === true || paidLike(status)
      ? total
      : null
"""
new = """  const explicitReceived = firstNumber(data, ['amountReceived', 'amountPaid', 'paidAmount', 'payment.amountReceived', 'payment.amountPaid'])
  const depositAmount = firstNumber(data, ['depositAmount', 'payment.depositAmount'])
  const total = firstNumber(data, ['totalAmount', 'paymentAmount', 'amount', 'total', 'grandTotal', 'payment.amount'])
  const paid = payment.confirmed === true || paidLike(status)
  const amountPaid = explicitReceived !== null
    ? Math.max(0, explicitReceived)
    : paid
      ? (depositAmount !== null && depositAmount > 0 ? Math.max(0, depositAmount) : total)
      : depositAmount !== null && depositAmount > 0
        ? Math.max(0, depositAmount)
        : null
"""
if old not in text:
    raise SystemExit('target block not found')
path.write_text(text.replace(old, new, 1))
