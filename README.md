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

### Workspace access records (Firestore)
- Store workspace metadata in the `workspaces` collection inside your **primary** Firestore database. Each document ID should match the workspace slug used by the app.
- Include fields such as `company`, `contractStart`, `contractEnd`, `paymentStatus`, and `amountPaid` to control access and billing state.
- Dates should be saved as Firestore `Timestamp` values (or ISO-8601 strings if writing via scripts), and currency values should be saved as numbers representing the smallest currency unit (e.g., cents).

**Seeding / maintenance steps**
1. Ensure you have the Firebase CLI installed and are logged in: `npx firebase login`.
2. Create a JSON seed file with workspace documents (see [`seed/workspaces.seed.json`](seed/workspaces.seed.json) for a ready-to-use example you can tweak per environment).
3. Import the seed data into Firestore: `npx firebase firestore:delete workspaces --project <project-id> --force && npx firebase firestore:import seed/workspaces.seed.json --project <project-id>`.
4. For ongoing updates, edit the documents directly in the Firebase console or via your preferred admin tooling.

### Roster database (`teamMembers` collection)
- Sedifex Functions look up login eligibility in a **secondary** Firestore database named `roster`. The `teamMembers` collection inside that database must contain at least one document matching the user who is attempting to sign in.
- Each roster document should include the member's `uid`, the verified `email`, and the assigned `storeId`. Additional helpful fields include `role`, `name`, `phone`, and any admin-only `notes`.
- Use the Firebase console (Database → `+ Add database` → choose `roster`) or the Admin SDK to create the secondary database before importing data.

**Quick seed for local/testing environments**
1. Update [`seed/team-members.seed.json`](seed/team-members.seed.json) with the UID, email, and store ID that you want to allow through login.
2. Import the roster seed into the `roster` database:
   ```bash
   npx firebase firestore:delete teamMembers --project <project-id> --force --database=roster
   npx firebase firestore:import seed/team-members.seed.json --project <project-id> --database=roster
   ```
3. If you prefer to seed manually, create a document at `teamMembers/<uid>` (and optionally `teamMembers/<email>`) in the `roster` database containing the same fields as the JSON example. The login callable will reject accounts that lack both documents or that do not specify a `storeId`.

### Troubleshooting: new signups do not create roster/store records
If you create a Firebase Auth user and do **not** see corresponding documents in Firestore, walk through the checklist below:

1. **Confirm the Cloud Function is deployed.** In the Firebase console open *Functions* and ensure `onAuthCreate` appears with a green check. If it is missing, redeploy from the repo root:
   ```bash
   cd functions
   npm install
   npm run deploy
   ```
2. **Verify the roster database ID.** The function writes roster entries with `getFirestore(admin.app(), 'roster')`. Double-check that your secondary database is named exactly `roster` (all lowercase). Rename or recreate it if necessary.
3. **Inspect execution logs.** In the Firebase console → *Functions* → `onAuthCreate` → *Logs*, look for errors such as permission issues (`PERMISSION_DENIED`) or missing indices. Fix any issues surfaced there; for example, update IAM so the default service account can write to the secondary database.
4. **Retry with a fresh user.** After resolving any deployment or permission issues, create a brand-new Auth user. The function only runs the first time the user is created, so deleting and re-creating the user ensures the trigger fires again.

Following these steps should result in new documents at `roster/teamMembers/<uid>` and `default/stores/<uid>` immediately after signup.

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
