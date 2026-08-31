# Customer Portal Self-Service

Customer Portal self-service lets a customer act on a booking without giving the public portal direct write access to booking state.

## Customer actions

- **Pay balance:** the public portal sends only the portal token and booking ID. The backend validates the portal, validates booking ownership, calculates the outstanding balance from Firestore, and creates the checkout through the existing Sedifex Quick Pay / Paystack flow.
- **Request a new time:** the customer submits a proposed date/time and optional note. The booking is not changed until an authenticated store user approves the request.
- **Request cancellation:** the customer submits a cancellation request and optional reason. The booking remains active until an authenticated store user approves it.

Only one pending booking-change request is allowed at a time. Completed and cancelled bookings cannot start new self-service changes or payments.

## Store workflow

Pending customer requests are shown on the existing Booking Editor. An authorized store user can approve or reject the request and add an optional decision note.

An approved reschedule writes the existing booking date/time fields. An approved cancellation writes the existing cancellation status fields. That intentionally reuses the booking email automation already responsible for rescheduled/cancelled customer notifications.

A rejected request does not alter the booking. Sedifex sends a direct rejection update when a customer email is available.

## Communication history

Sedifex records customer request submissions, store decisions, and portal payment checkout starts in the customer's CRM message history. Store recipients are also notified when a new reschedule/cancellation request arrives.

## Security boundary

- The customer portal bearer token is revalidated on every self-service callable.
- The booking must belong to the portal's canonical customer.
- Public callables cannot approve requests or directly change booking status/date/time.
- Payment amount, store ID, customer ID, and booking ID are resolved and validated server-side.
- Store approval/rejection requires an authenticated user with access to the store.
- The browser never supplies the authoritative payment balance.
