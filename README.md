# Sedifex — PWA + Firebase Starter

This repo is a drop-in starter for **Sedifex** (inventory & POS). It ships as a **website** that is also **installable as a PWA**, with **Firebase** (Auth + Firestore + Functions).

## What’s inside
- `web/` — React + Vite + TypeScript PWA
- `functions/` — Firebase Cloud Functions (Node 20) with a secure **commitSale** transaction
- `firestore.rules` — Multi-tenant security rules scaffold
- `.github/workflows/` — Optional CI for deploying Functions (if you want to use GitHub Actions)

## Quick start (local dev)
1) Install Node 20+.
2) Go to `web/` and install deps:
   ```bash
   cd web
   npm i
   npm run dev
   ```
3) Create a Firebase project (e.g., `sedifex-dev`) and fill these env vars in `web/.env.local`:
   ```env
   VITE_FB_API_KEY=REPLACE_ME
   VITE_FB_AUTH_DOMAIN=sedifex-dev.firebaseapp.com
   VITE_FB_PROJECT_ID=sedifex-dev
   VITE_FB_STORAGE_BUCKET=sedifex-dev.appspot.com
   VITE_FB_APP_ID=REPLACE_ME
   ```
4) (Optional) Deploy Functions:
   ```bash
   cd functions
   npm i
   # Login to Firebase
   npx firebase login
   # Set your project
   npx firebase use sedifex-dev
   # Deploy
   npm run deploy
   ```

## Deploy the PWA (Vercel/Netlify/Firebase Hosting)
- Point your host to build from `web/` with build command `npm run build` and output dir `dist`.
- Add the env vars above to your hosting provider.
- Set your domain `app.sedifex.com` to the deployed frontend.

## Firebase setup notes
- Enable **Authentication → Phone** and **Email/Password** (optional).
- Enable **Firestore** and publish `firestore.rules`.
- Create a second project for production later (e.g., `sedifex-prod`).
- Enable **Firebase App Check** with the reCAPTCHA v3 provider, make sure `https://sedifexbiz.vercel.app` is listed as an
  allowed domain on the site key, and surface that key via `VITE_FB_APP_CHECK_SITE_KEY` (or `VITE_RECAPTCHA_SITE_KEY`) in your
  deployment environment.

### Workspace access records (Firestore)
- Store workspace metadata in the `workspaces` collection inside your **primary** Firestore database. Each document ID should match the workspace slug used by the app.
- Include fields such as `company`, `contractStart`, `contractEnd`, `paymentStatus`, and `amountPaid` to control access and billing state.
- Dates should be saved as Firestore `Timestamp` values (or ISO-8601 strings if writing via scripts), and currency values should be saved as numbers representing the smallest currency unit (e.g., cents).

**Seeding / maintenance steps**
1. Ensure you have the Firebase CLI installed and are logged in: `npx firebase login`.
2. Create a JSON seed file with workspace documents (see [`seed/workspaces.seed.json`](seed/workspaces.seed.json) for a ready-to-use example you can tweak per environment).
3. Import the seed data into Firestore: `npx firebase firestore:delete workspaces --project <project-id> --force && npx firebase firestore:import seed/workspaces.seed.json --project <project-id>`.
4. For ongoing updates, edit the documents directly in the Firebase console or via your preferred admin tooling.

### Team members (`teamMembers` collection)
- Sedifex Functions look up login eligibility in the `teamMembers` collection of the default Firestore database. Ensure there is at least one document matching the user who is attempting to sign in.
- Each team member document should include the member's `uid`, the verified `email`, and the assigned `storeId`. Additional helpful fields include `role`, `name`, `phone`, and any admin-only `notes`.

**Quick seed for local/testing environments**
1. Update [`seed/team-members.seed.json`](seed/team-members.seed.json) with the UID, email, and store ID that you want to allow through login.
2. Import the roster seed into the default database:
   ```bash
   npx firebase firestore:delete teamMembers --project <project-id> --force
   npx firebase firestore:import seed/team-members.seed.json --project <project-id>
   ```
3. If you prefer to seed manually, create a document at `teamMembers/<uid>` (and optionally `teamMembers/<email>`) containing the same fields as the JSON example. The login callable will reject accounts that lack both documents or that do not specify a `storeId`.

### Troubleshooting: new signups do not create roster/store records
If you create a Firebase Auth user and do **not** see corresponding documents in Firestore, walk through the checklist below:

1. **Confirm the Cloud Function is deployed.** In the Firebase console open *Functions* and ensure `onAuthCreate` appears with a green check. If it is missing, redeploy from the repo root:
   ```bash
   cd functions
   npm install
   npm run deploy
   ```
2. **Verify the `teamMembers` collection exists.** The function writes roster entries to `teamMembers` in the default database. Confirm the collection exists and that security rules allow writes from the Functions service account.
3. **Inspect execution logs.** In the Firebase console → *Functions* → `onAuthCreate` → *Logs*, look for errors such as permission issues (`PERMISSION_DENIED`) or missing indices. Fix any issues surfaced there; for example, update IAM so the default service account can write to the collection.
4. **Retry with a fresh user.** After resolving any deployment or permission issues, create a brand-new Auth user. The function only runs the first time the user is created, so deleting and re-creating the user ensures the trigger fires again.

Following these steps should result in new documents at `teamMembers/<uid>` and `stores/<uid>` immediately after signup.

## Branding
- Name: **Sedifex**
- Tagline: *Sell faster. Count smarter.*
- Primary color: `#4338CA` (indigo 700)

---

Happy shipping! — 2025-09-23

## Integrating Paystack payments

Follow the flow below to connect Paystack as the card/mobile processor for Sedifex. The checklist assumes you already followed the Firebase setup steps above and that your stores are created by the `onAuthCreate` trigger.

1. **Create Paystack credentials**
   - Sign in to your Paystack dashboard and create a **Live** and **Test** secret key pair.
   - Store the keys in your deployment environment (e.g., Vercel, Firebase Functions config) rather than hard-coding them in the repo. The frontend only needs the public key; keep the secret key scoped to Cloud Functions.

2. **Publish provider metadata to Firestore**
   - Open the `stores/<storeId>` document (or update your seeding script) and set `paymentProvider` to `paystack`.
   - Keep billing status fields (`paymentStatus`, `amountPaid`, contract dates) up to date so the `resolveStoreAccess` callable can block suspended workspaces while still returning provider info for paid or trial accounts.

3. **Expose the Paystack public key to the PWA**
   - Add `VITE_PAYSTACK_PUBLIC_KEY=<pk_test_or_live_value>` to `web/.env.local` for local development and to your hosting provider for production.
   - Update any environment loader (for example `web/src/config/env.ts`) to read the new variable and export it alongside the Firebase config.

4. **Invoke Paystack during checkout**
   - Inside the Sell screen, intercept non-cash tenders before calling `commitSale`. Load Paystack’s inline widget or SDK with the amount, customer email/phone, and receive the transaction reference.
   - On success, enrich the existing `payment` payload with the Paystack response: e.g. `{ method: 'card', amountPaid, changeDue, provider: 'paystack', providerRef: response.reference, status: response.status }`.
   - Persist the payload as-is—`commitSale` already stores the `payment` object verbatim, so downstream reporting can access the Paystack reference without schema changes.

5. **Handle offline and retries**
   - Reuse the existing offline queue: if a sale is queued because the network is down, add the Paystack reference and mark the local payment status so the cashier can reconcile it when connectivity returns.
   - Create a reconciliation job (CLI script or scheduled Cloud Function) that pulls unsettled Paystack transactions and compares them to Firestore `sales` records, updating statuses or flagging discrepancies for review.

6. **Secure credentials and webhooks**
   - Store the Paystack secret key via `firebase functions:config:set paystack.secret="sk_live_..."` (or your preferred secret manager) and read it in the Cloud Function that confirms transactions.
   - If you enable Paystack webhooks, deploy a HTTPS Cloud Function that validates the signature with the secret key and updates the matching `sales/<id>` document.
   - Update `firestore.rules` and callable permissions so only privileged roles can change payment-related fields.

7. **Test the full flow**
   - Run end-to-end tests against Paystack’s **Test** mode to validate successful, declined, and timed-out transactions.
   - Confirm that `resolveStoreAccess` still returns billing metadata for new signups and that the UI gracefully handles both paid and trial workspaces with Paystack enabled.

Documenting these steps keeps the integration consistent across environments and makes it easy to onboard additional stores with Paystack support.

### Automated payment reconciliation workflow

Finance teams can lean on the persisted `payment` payload from the `commitSale` callable to continuously compare Paystack settlements against Sedifex sales records. The outline below extends the guidance above and keeps the workflow fully auditable:

1. **Source of truth**
   - Treat Paystack as the authority for cash settlement while Firestore’s `sales` collection remains the record of issued receipts.
   - Because `commitSale` stores the payment object verbatim, every sale already includes Paystack metadata such as `provider`, `providerRef`, `status`, `amountPaid`, and `changeDue`.

2. **Daily extraction job**
   - Schedule a Cloud Function (or Cloud Scheduler + HTTPS endpoint) to run at least daily.
   - Use Paystack’s Transaction API to list charges from the previous reconciliation window. Filter by `status = success` (or any state your finance policy requires) and capture the Paystack reference, amount, currency, and processed timestamp.

3. **Firestore comparison**
   - Query Firestore for `sales` documents whose `payment.provider` is `paystack` and whose `createdAt` falls within the same window.
   - Create an in-memory map keyed by the Paystack `providerRef`. For each Paystack transaction:
     - If a matching sale is found but `payment.status` is not `success`, update the sale with a `payment.status = 'settled'` flag and append a `reconciliationLogs` array entry noting the timestamp and actor (e.g. the scheduler).
     - If no matching sale exists, write a `financeAlerts` document (or send Slack/email) detailing the orphaned transaction so the team can investigate.

4. **Mismatch handling**
   - For each sale that lacks a matching Paystack transaction, set a `payment.reconciliationStatus = 'mismatch'` field and optionally freeze fulfillment (e.g. hold inventory release) until the issue is resolved.
   - Surface mismatches in a dedicated Firestore collection or BigQuery export that the finance dashboard can subscribe to. Include the sale ID, cashier, register, and captured Paystack values to speed up resolution.

5. **Audit and reporting**
   - Persist every automated change in the sale document’s `reconciliationLogs` array (e.g. `{ actor: 'scheduler', action: 'marked-settled', processedAt: <timestamp> }`). This creates a tamper-evident history tied to the original payment payload.
   - Export the daily reconciliation results to BigQuery or CSV so finance can attach summaries to period-close packets.

6. **Exception queue**
   - When a human updates a mismatched sale, require them to submit a short note (stored alongside the log entry) explaining what changed and why.
   - Close the loop by clearing the `reconciliationStatus` field once the Paystack reference appears or the transaction is confirmed void.

Following this workflow ensures Paystack settlement data and Sedifex sales stay aligned without manual spreadsheet checks, while still giving finance teams a structured queue for anomalies.
