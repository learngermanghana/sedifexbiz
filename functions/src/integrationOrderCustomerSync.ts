import * as functions from 'firebase-functions/v1'
import { upsertStoreCustomerFromCheckout } from './customerUpsert'
import { isPaidIntegrationOrder } from './integrationPaymentStatus'

function clean(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export const syncIntegrationOrderCustomer = functions.firestore
  .document('integrationOrders/{orderId}')
  .onWrite(async (change, context) => {
    const data = change.after.exists ? change.after.data() as Record<string, unknown> : null
    if (!data) return null

    const storeId = clean(data.storeId ?? data.merchantId, 180)
    if (!storeId) return null

    // Checkout creation writes a pending integration order before the customer
    // completes Paystack. Do not turn abandoned/failed checkouts into clients.
    if (!isPaidIntegrationOrder(data)) return null

    const customer = getRecord(data.customer)
    const metadata = getRecord(data.lastPaymentMetadata ?? data.metadata)
    const reference = clean(data.reference ?? data.paymentReference ?? data.payment_reference ?? context.params.orderId, 220)
    const sourceChannel = clean(data.sourceChannel ?? data.source_channel ?? metadata.sourceChannel, 80) || 'integration_checkout'
    const sourceLabel = clean(data.sourceLabel ?? data.source_label ?? metadata.sourceLabel, 120) || 'Sedifex checkout'

    const result = await upsertStoreCustomerFromCheckout({
      storeId,
      customer: {
        name: clean(customer.name ?? data.customerName ?? metadata.customerName, 220),
        email: clean(customer.email ?? data.customerEmail ?? metadata.customerEmail, 220),
        phone: clean(customer.phone ?? data.customerPhone ?? metadata.customerPhone, 80),
      },
      reference,
      sourceChannel,
      sourceLabel,
      paymentMethod: clean(data.paymentMethod ?? data.payment_method ?? metadata.paymentMethod, 80) || 'ONLINE',
      paymentStatus: clean(data.paymentStatus ?? data.payment_status, 80) || 'paid',
      orderStatus: clean(data.orderStatus ?? data.order_status, 80) || 'booking_confirmed',
      amount: numberValue(data.amountPaid ?? data.amount_paid ?? data.confirmedAmount ?? data.amount),
      currency: clean(data.currency, 20) || 'GHS',
      itemName: clean(data.itemName ?? data.productName ?? data.serviceName ?? metadata.itemName, 260),
    })

    if (result?.customerId) {
      functions.logger.info('Auto-saved paid integration order customer', {
        storeId,
        reference,
        customerId: result.customerId,
        sourceChannel,
      })
    }

    return null
  })
