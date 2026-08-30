# Stripe Connect Store Onboarding

This guide explains how Sedifex store owners connect a Stripe account for Europe and global card payments, how Sedifex reviews the connection before activation, and which Firestore and Firebase settings support the flow.

## 1. Overview

Sedifex supports multiple payment providers by region and currency:

- **Paystack for Africa/GHS.** Ghana cedi (`GHS`) and Africa-focused checkout flows continue to use Paystack.
- **Stripe Connect for Europe and global payments.** European and global card payments can use Stripe Connect when the store has completed Stripe onboarding and Sedifex has approved activation.
- **Default Sedifex platform fee: 3%.** Unless an explicit approved override is configured, Sedifex applies a 3% platform fee to Stripe Connect payments.

## 2. Store onboarding

Stores do **not** paste Stripe secret keys into Sedifex. Sedifex owns the platform-level Stripe configuration, and each store connects through Stripe Connect onboarding.

The expected store onboarding flow is:

1. The store owner clicks **Connect Stripe** in Sedifex.
2. Sedifex starts a Stripe Connect onboarding session.
3. Stripe opens in the browser.
4. The store owner can either:
   - log in to an existing Stripe account, or
   - create a new Stripe account during onboarding.
5. After Stripe completes onboarding, Sedifex saves only the Stripe connected account ID, for example `acct_xxxxx`.

Sedifex should never ask a store owner to provide or store their Stripe secret key. The store-specific Stripe value Sedifex keeps is the connected account ID.

## 3. Admin approval

After a store connects Stripe, payments are not automatically activated for that store. The Sedifex team reviews the connected account and store details before enabling live payment activation.

A typical status progression is:

1. Store completes Stripe Connect onboarding.
2. Sedifex records the connected account ID and marks the store as `pending_review`.
3. A Sedifex admin reviews the store and connected Stripe account.
4. The admin sets payment activation to `active`, `disabled`, or `rejected` as appropriate.

This review step helps Sedifex confirm that Stripe has been connected intentionally and that the store is approved to receive Stripe Connect payments through the Sedifex platform.

## 4. Firestore model

Store payment settings should record the provider, approval status, region, platform fee, and connected account ID. Example:

```js
paymentSettings: {
  enabled: true,
  approvalStatus: "pending_review" | "active" | "disabled" | "rejected",
  region: "europe",
  provider: "stripe",
  platformFeePercent: 3,
  feePaidBy: "seller",
  stripeConnectedAccountId: "acct_xxxxx",
  managedBy: "sedifex",
  updatedBy: "sedifex_admin",
  updatedAt: serverTimestamp()
}
```

Field notes:

- `enabled` indicates whether the payment settings object is intended to be usable by checkout logic.
- `approvalStatus` controls whether Sedifex has approved the store for Stripe payment activation.
- `provider` must be `stripe` for Stripe Connect stores.
- `platformFeePercent` defaults to `3` for the standard Sedifex platform fee.
- `feePaidBy` is `seller` when the seller receives the customer total minus Stripe processing fees and the Sedifex platform fee.
- `stripeConnectedAccountId` stores only the Stripe connected account ID, such as `acct_xxxxx`.
- `managedBy`, `updatedBy`, and `updatedAt` identify that Sedifex manages the activation state and when it was last changed.

## 5. Fee example

For a customer checkout of **EUR 100**:

1. The customer pays **EUR 100**.
2. Sedifex applies the default **3% platform fee**.
3. The Sedifex fee is **EUR 3**.
4. Stripe deducts its own Stripe processing fee.
5. The seller receives **EUR 100 minus the Stripe fee minus the Sedifex EUR 3 platform fee**.

In formula form:

```txt
Seller receives = EUR 100 - Stripe processing fee - EUR 3 Sedifex platform fee
```

## 6. Required Firebase params

The Stripe Connect onboarding and payment flow requires these Firebase params:

```txt
STRIPE_SECRET_KEY
STRIPE_CONNECT_CLIENT_ID
STRIPE_CONNECT_REDIRECT_URL
STRIPE_WEBHOOK_SECRET
```

- `STRIPE_SECRET_KEY` is the Sedifex platform Stripe secret key used by backend Stripe functions.
- `STRIPE_CONNECT_CLIENT_ID` identifies the Stripe Connect application used for account onboarding.
- `STRIPE_CONNECT_REDIRECT_URL` is the URL Stripe redirects stores back to after Connect onboarding.
- `STRIPE_WEBHOOK_SECRET` is used to verify Stripe webhook signatures before Sedifex trusts incoming Stripe events.

## 7. Stripe webhook URL

The Stripe webhook URL should point to the deployed `stripeWebhook` Firebase function.

Configure Stripe to send the required payment and checkout events to that deployed function URL. The webhook handler should verify each incoming request with `STRIPE_WEBHOOK_SECRET` before updating Sedifex payment or order records.
