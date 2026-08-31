# Reusable Event Checklist Templates

Sedifex Event Planning lets each store save a completed or customized event checklist as a reusable store template and copy it into future events.

## Store workflow

1. Open an event and select **Checklist**.
2. Build or customize the event checklist as usual.
3. Select **Save current as template** and give the template a store-friendly name.
4. On another event, select the saved template and choose either:
   - **Add missing tasks** to merge template tasks without duplicating existing task titles.
   - **Replace current checklist** to start the event checklist fresh from the template.

Deleting a template never changes checklists that were already copied into events.

## Due dates

Templates do not persist an event's absolute calendar dates. Each saved task stores a relative day offset from the source event date. When a template is applied to another event, Sedifex calculates the new due date from that event's date.

Examples:

- 30 days before the source event remains 30 days before the destination event.
- Event-day tasks remain on the destination event date.
- Post-event tasks can retain positive offsets after the event date.
- Tasks without a due date remain without a due date.

## Task state

Templates preserve the reusable planning content:

- title
- category
- default owner
- relative due date
- priority
- notes
- order

Task completion state is intentionally not reused. Every copied task starts as **To do** so progress from one client or event cannot leak into another.

## Storage and security

Templates are stored at:

`stores/{storeId}/events/__templates/checklists/{templateId}`

The `__templates` event document does not need to exist. Firestore permits subcollections beneath a missing parent document. Keeping templates under the existing Event Planning namespace means the current event subcollection security rule continues to require access to the active store.

Each template is an independent blueprint. Applying or editing a template never live-links existing event tasks back to the template.
