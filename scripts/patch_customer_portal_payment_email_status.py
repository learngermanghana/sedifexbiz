from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing anchor: {label}")
    return text.replace(old, new, 1)


backend_path = Path('functions/src/customerPortal.ts')
backend = backend_path.read_text()

receipt_anchor = '''function mapReceipt(id: string, data: RecordMap) {
  return {
    id,
    receiptNumber: firstText(data, ['receiptNumber', 'number', 'reference']) || id,
    reference: firstText(data, ['paymentReference', 'reference', 'transactionReference']),
    currency: firstText(data, ['currency']) || 'GHS',
    amountPaid: firstNumber(data, ['amountPaid', 'amount', 'total']),
    paymentMethod: firstText(data, ['paymentMethod', 'payment.method', 'method']),
    status: firstText(data, ['status', 'paymentStatus']) || 'paid',
    createdAt: dateToIso(data.createdAt ?? data.updatedAt),
    publicUrl: firstText(data, ['publicUrl', 'shareUrl']),
  }
}
'''
receipt_plus_payment = receipt_anchor + '''
function mapBookingPayment(id: string, data: RecordMap) {
  const payment = record(data.payment)
  const status = firstText(data, ['paymentStatus', 'payment.status']) || (payment.confirmed === true ? 'paid' : 'pending')
  const amountReceived = firstNumber(data, ['amountReceived', 'amountPaid', 'paidAmount', 'depositAmount', 'payment.amountReceived', 'payment.amountPaid', 'payment.depositAmount'])
  const total = firstNumber(data, ['totalAmount', 'paymentAmount', 'amount', 'total', 'grandTotal', 'payment.amount'])
  const amountPaid = amountReceived !== null
    ? Math.max(0, amountReceived)
    : payment.confirmed === true || paidLike(status)
      ? total
      : null
  const hasRecordedPayment = payment.confirmed === true || paidLike(status) || (amountPaid !== null && amountPaid > 0)
  if (!hasRecordedPayment) return null

  return {
    id: `booking-payment-${id}`,
    kind: 'payment_confirmation' as const,
    title: firstText(data, ['serviceName', 'booking.serviceName', 'metadata.serviceName', 'itemName']) || 'Booking payment',
    reference: firstText(data, ['paymentReference', 'payment.reference', 'reference', 'bookingId']) || id,
    currency: firstText(data, ['currency', 'payment.currency']) || 'GHS',
    amountPaid,
    paymentMethod: firstText(data, ['paymentMethod', 'payment.method', 'method']),
    status,
    createdAt: dateToIso(data.paymentConfirmedAt ?? data.payment_confirmed_at ?? data.updatedAt ?? data.createdAt),
    publicUrl: '',
  }
}
'''
backend = replace_once(backend, receipt_anchor, receipt_plus_payment, 'mapReceipt')

rows_anchor = '''  const receiptRows = receipts
    .map(item => mapReceipt(item.id, item.data))
    .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))

  const customerDebt = record(customer.debt)
'''
rows_replacement = '''  const receiptRows = receipts
    .map(item => mapReceipt(item.id, item.data))
    .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))
  const receiptReferences = new Set(receiptRows.map(item => item.reference.trim().toLowerCase()).filter(Boolean))
  const bookingPaymentRows = bookings
    .map(item => mapBookingPayment(item.id, item.data))
    .filter((item): item is NonNullable<ReturnType<typeof mapBookingPayment>> => Boolean(item))
    .filter(item => !item.reference || !receiptReferences.has(item.reference.trim().toLowerCase()))
  const paymentRows = [
    ...receiptRows.map(item => ({ ...item, kind: 'receipt' as const, title: item.receiptNumber })),
    ...bookingPaymentRows,
  ].sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))

  const customerDebt = record(customer.debt)
'''
backend = replace_once(backend, rows_anchor, rows_replacement, 'portal payment rows')

summary_anchor = '''      invoices: invoiceRows.length,
      receipts: receiptRows.length,
      outstanding: outstandingCents !== null ? Math.max(0, outstandingCents / 100) : invoiceBalance,
'''
summary_replacement = '''      invoices: invoiceRows.length,
      payments: paymentRows.length,
      receipts: receiptRows.length,
      outstanding: outstandingCents !== null ? Math.max(0, outstandingCents / 100) : invoiceBalance,
'''
backend = replace_once(backend, summary_anchor, summary_replacement, 'summary payments')

return_anchor = '''    bookings: bookingRows,
    invoices: invoiceRows,
    receipts: receiptRows,
  }
}
'''
return_replacement = '''    bookings: bookingRows,
    invoices: invoiceRows,
    payments: paymentRows,
    receipts: receiptRows,
  }
}
'''
backend = replace_once(backend, return_anchor, return_replacement, 'return payments')

email_state_anchor = '''  let deliveries = 0
  let deliveryStatus = 'not-requested'
  const customerEmail = email(customer.email)
  if (sendEmail && customerEmail) {
'''
email_state_replacement = '''  let deliveries = 0
  let deliveryStatus = 'not-requested'
  let deliveryChannel = 'none'
  let deliveryReason = ''
  const customerEmail = email(customer.email)
  if (sendEmail && customerEmail) {
'''
backend = replace_once(backend, email_state_anchor, email_state_replacement, 'manual portal delivery state')

email_result_anchor = '''    deliveries = result.ok && result.channel !== 'outbox_only' ? 1 : 0
    deliveryStatus = result.deliveryStatus
  }

  return {
    ok: true,
    portalUrl: publicUrl,
    expiresAt: expiresAt.toDate().toISOString(),
    deliveries,
    deliveryStatus,
  }
})
'''
email_result_replacement = '''    deliveries = result.ok && result.channel !== 'outbox_only' ? 1 : 0
    deliveryStatus = result.deliveryStatus
    deliveryChannel = result.channel
    deliveryReason = result.reason || ''
  }

  const communicationStatus = !sendEmail
    ? 'link_created_only'
    : !customerEmail
      ? 'needs_customer_email'
      : deliveries > 0
        ? (deliveryStatus === 'queued' ? 'queued' : 'sent')
        : deliveryStatus === 'outbox'
          ? 'queued_no_live_sender'
          : 'failed'
  await customerRef.collection('messages').doc(`sedifex-portal-manual-${hash}`).set({
    storeId,
    customerId,
    customerName: customerDisplayName(customer),
    channel: sendEmail ? 'email' : 'portal_link',
    direction: 'outbound',
    source: 'sedifex_manual_portal_share',
    eventType: 'customer.portal_shared',
    subject: 'Your customer portal',
    body: sendEmail
      ? `Sedifex attempted to share the secure customer portal with ${customerEmail || 'the customer'}. Delivery: ${communicationStatus} via ${deliveryChannel}.`
      : 'Sedifex created a secure customer portal link without sending an email.',
    recipient: customerEmail || null,
    status: communicationStatus,
    deliveryChannel,
    deliveryStatus,
    deliveryReason: deliveryReason || null,
    portalUrl: publicUrl,
    createdAt: now,
    updatedAt: now,
  }, { merge: true })

  return {
    ok: true,
    portalUrl: publicUrl,
    expiresAt: expiresAt.toDate().toISOString(),
    deliveries,
    deliveryStatus,
    deliveryChannel,
    deliveryReason,
  }
})
'''
backend = replace_once(backend, email_result_anchor, email_result_replacement, 'manual portal communication log')
backend_path.write_text(backend)


ui_path = Path('web/src/pages/PublicCustomerPortal.tsx')
ui = ui_path.read_text()

payment_type_anchor = '''type ReceiptRow = {
  id: string
  receiptNumber: string
  reference: string
  currency: string
  amountPaid: number | null
  paymentMethod: string
  status: string
  createdAt: string | null
  publicUrl: string
}
'''
payment_type_replacement = payment_type_anchor + '''
type PaymentRow = {
  id: string
  kind: 'receipt' | 'payment_confirmation'
  title: string
  reference: string
  currency: string
  amountPaid: number | null
  paymentMethod: string
  status: string
  createdAt: string | null
  publicUrl: string
}
'''
ui = replace_once(ui, payment_type_anchor, payment_type_replacement, 'PaymentRow type')

portal_data_anchor = '''  summary: { upcomingBookings: number; invoices: number; receipts: number; outstanding: number; currency: string }
  bookings: BookingRow[]
  invoices: InvoiceRow[]
  receipts: ReceiptRow[]
'''
portal_data_replacement = '''  summary: { upcomingBookings: number; invoices: number; payments?: number; receipts: number; outstanding: number; currency: string }
  bookings: BookingRow[]
  invoices: InvoiceRow[]
  payments?: PaymentRow[]
  receipts: ReceiptRow[]
'''
ui = replace_once(ui, portal_data_anchor, portal_data_replacement, 'PortalData payments')

portal_rows_anchor = '''  const brandColor = safeBrandColor(data.brand.brandColor)
  const contactHref = data.brand.phone ? `tel:${data.brand.phone}` : data.brand.email ? `mailto:${data.brand.email}` : ''

  return (
'''
portal_rows_replacement = '''  const brandColor = safeBrandColor(data.brand.brandColor)
  const contactHref = data.brand.phone ? `tel:${data.brand.phone}` : data.brand.email ? `mailto:${data.brand.email}` : ''
  const paymentRows: PaymentRow[] = data.payments ?? data.receipts.map(receipt => ({
    id: receipt.id,
    kind: 'receipt' as const,
    title: receipt.receiptNumber,
    reference: receipt.reference,
    currency: receipt.currency,
    amountPaid: receipt.amountPaid,
    paymentMethod: receipt.paymentMethod,
    status: receipt.status,
    createdAt: receipt.createdAt,
    publicUrl: receipt.publicUrl,
  }))

  return (
'''
ui = replace_once(ui, portal_rows_anchor, portal_rows_replacement, 'paymentRows fallback')

summary_ui_anchor = '''        <article><span>Invoices</span><strong>{data.summary.invoices}</strong></article>
        <article><span>Receipts</span><strong>{data.summary.receipts}</strong></article>
        <article><span>Outstanding</span><strong>{formatMoney(data.summary.outstanding, data.summary.currency)}</strong></article>
'''
summary_ui_replacement = '''        <article><span>Invoices</span><strong>{data.summary.invoices}</strong></article>
        <article><span>Payments</span><strong>{data.summary.payments ?? paymentRows.length}</strong></article>
        <article><span>Outstanding</span><strong>{formatMoney(data.summary.outstanding, data.summary.currency)}</strong></article>
'''
ui = replace_once(ui, summary_ui_anchor, summary_ui_replacement, 'portal summary payments')

payments_ui_anchor = '''        {activeSection === 'payments' ? (
          data.receipts.length ? <div className="customer-portal__records">{data.receipts.map(receipt => (
            <article className="customer-portal__record" key={receipt.id}>
              <div className="customer-portal__record-head"><div><small>Receipt</small><h3>{receipt.receiptNumber}</h3></div><span>{statusLabel(receipt.status)}</span></div>
              <dl>
                <div><dt>Amount</dt><dd>{formatMoney(receipt.amountPaid, receipt.currency)}</dd></div>
                <div><dt>Method</dt><dd>{receipt.paymentMethod || '—'}</dd></div>
                <div><dt>Date</dt><dd>{formatDate(receipt.createdAt)}</dd></div>
                {receipt.reference ? <div><dt>Reference</dt><dd>{receipt.reference}</dd></div> : null}
              </dl>
              {receipt.publicUrl ? <a className="customer-portal__document-link" href={receipt.publicUrl} target="_blank" rel="noreferrer">View receipt</a> : null}
            </article>
          ))}</div> : <div className="customer-portal__empty">No payment receipts are linked to this customer yet.</div>
        ) : null}
'''
payments_ui_replacement = '''        {activeSection === 'payments' ? (
          paymentRows.length ? <div className="customer-portal__records">{paymentRows.map(payment => (
            <article className="customer-portal__record" key={`${payment.kind}-${payment.id}`}>
              <div className="customer-portal__record-head"><div><small>{payment.kind === 'receipt' ? 'Receipt' : 'Payment confirmation'}</small><h3>{payment.title}</h3></div><span>{statusLabel(payment.status)}</span></div>
              <dl>
                <div><dt>Amount</dt><dd>{formatMoney(payment.amountPaid, payment.currency)}</dd></div>
                <div><dt>Method</dt><dd>{payment.paymentMethod || '—'}</dd></div>
                <div><dt>Date</dt><dd>{formatDate(payment.createdAt)}</dd></div>
                {payment.reference ? <div><dt>Reference</dt><dd>{payment.reference}</dd></div> : null}
              </dl>
              {payment.kind === 'receipt' && payment.publicUrl ? <a className="customer-portal__document-link" href={payment.publicUrl} target="_blank" rel="noreferrer">View receipt</a> : null}
            </article>
          ))}</div> : <div className="customer-portal__empty">No payments or receipts are linked to this customer yet.</div>
        ) : null}
'''
ui = replace_once(ui, payments_ui_anchor, payments_ui_replacement, 'payments tab')
ui_path.write_text(ui)


share_path = Path('web/src/components/CustomerPortalShareCard.tsx')
share = share_path.read_text()

response_type_anchor = '''        { ok: boolean; portalUrl: string; expiresAt: string; deliveries: number; deliveryStatus: string }
'''
response_type_replacement = '''        { ok: boolean; portalUrl: string; expiresAt: string; deliveries: number; deliveryStatus: string; deliveryChannel?: string; deliveryReason?: string }
'''
share = replace_once(share, response_type_anchor, response_type_replacement, 'share response type')

message_anchor = '''      if (sendEmail && customerEmail) {
        setMessage(response.data.deliveries > 0
          ? `Portal created and emailed to ${customerEmail}.`
          : 'Portal created, but email delivery was not confirmed. Copy the link and send it manually.')
      } else {
'''
message_replacement = '''      if (sendEmail && customerEmail) {
        if (response.data.deliveries > 0) {
          const via = response.data.deliveryChannel && response.data.deliveryChannel !== 'none'
            ? ` via ${response.data.deliveryChannel.replace(/_/g, ' ')}`
            : ''
          setMessage(`Portal created and email accepted for ${customerEmail}${via}.`)
        } else if (response.data.deliveryStatus === 'outbox') {
          setMessage('Portal created, but no live email sender is configured. Copy the link and send it manually.')
        } else {
          const reason = response.data.deliveryReason ? ` (${response.data.deliveryReason})` : ''
          setMessage(`Portal created, but email delivery failed${reason}. Copy the link and send it manually.`)
        }
      } else {
'''
share = replace_once(share, message_anchor, message_replacement, 'share delivery message')
share_path.write_text(share)
