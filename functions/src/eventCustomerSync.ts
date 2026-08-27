import * as functions from 'firebase-functions/v1'
import { admin, defaultDb } from './firestore'
import { upsertStoreCustomerFromEvent } from './customerUpsert'

type RecordMap = Record<string, unknown>

function text(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function record(value: unknown): RecordMap {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordMap : {}
}

function phoneKey(value: unknown) {
  return text(value, 80).replace(/\D/g, '')
}

function clientIdentity(data: RecordMap) {
  return [
    text(data.clientName, 220).toLowerCase(),
    text(data.clientEmail, 220).toLowerCase(),
    phoneKey(data.clientPhone),
  ].join('|')
}

export const syncEventPlanningCustomer = functions.firestore
  .document('stores/{storeId}/events/{eventId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null

    const storeId = text(context.params.storeId, 180)
    const eventId = text(context.params.eventId, 220)
    if (!storeId || !eventId) return null

    const after = change.after.data() as RecordMap
    const before = change.before.exists ? change.before.data() as RecordMap : null
    const integrations = record(after.integrations)
    const beforeIntegrations = before ? record(before.integrations) : {}
    const linkedCustomerId = text(integrations.clientCustomerId, 240)
    const beforeLinkedCustomerId = text(beforeIntegrations.clientCustomerId, 240)
    const identityChanged = !before || clientIdentity(before) !== clientIdentity(after)
    const explicitLinkRemoval = Boolean(before && beforeLinkedCustomerId && !linkedCustomerId && !identityChanged)

    // Respect the organizer explicitly removing the client/customer link. Without
    // this guard the trigger would immediately recreate the same link.
    if (explicitLinkRemoval) return null

    // Event-only edits should not touch an existing client link. This also stops
    // the trigger from looping after it writes integrations.clientCustomerId.
    if (!identityChanged && linkedCustomerId) return null

    const customer = await upsertStoreCustomerFromEvent({
      storeId,
      eventId,
      eventCode: text(after.eventCode, 100),
      eventTitle: text(after.title, 260) || text(after.eventType, 180),
      eventDate: text(after.eventDate, 40),
      customer: {
        name: text(after.clientName, 220),
        email: text(after.clientEmail, 220),
        phone: text(after.clientPhone, 80),
      },
    })

    if (!customer || customer.customerId === linkedCustomerId) return null

    await defaultDb.collection('stores').doc(storeId).collection('events').doc(eventId).update({
      'integrations.clientCustomerId': customer.customerId,
      'integrations.clientCustomerSync': {
        customerId: customer.customerId,
        createdCustomer: customer.created,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'event_planning',
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    console.log('[event-customer-sync] Event client linked', {
      storeId,
      eventId,
      customerId: customer.customerId,
      created: customer.created,
    })
    return null
  })
