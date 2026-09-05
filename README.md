# Sedifex — PWA + Firebase Starter.

This repo is a drop-in starter for **Sedifex** (inventory & POS). It ships as a **website** that is also **installable as a PWA**, with **Firebase** (Auth + Firestore + Functions).

## What’s inside
- `web/` — React + Vite + TypeScript PWA
- `functions/` — Firebase Cloud Functions (Node 20) with a secure **commitSale** transaction
- `firestore.rules` — Multi-tenant security rules scaffold
- `.github/workflows/` — Optional CI for deploying Functions (if you want to use GitHub Actions)

## Product image fields + downstream contract

Sedifex product documents now support first-class image metadata:

- `imageUrl?: string | null` — optional public image URL (`http://` or `https://` only in product forms/import).
- `imageAlt?: string | null` — optional accessibility label; defaults to `name` when `imageUrl` exists and `imageAlt` is missing.
- `category?: string | null` — optional item grouping label used across product listings and integrations.
- `description?: string | null` — optional product summary for richer storefront rendering.

### Production image uploads (same-origin `/api/uploads` on Vercel)

Sedifex now uses a real serverless API route at `web/api/uploads.ts` (deployed by Vercel) so the browser uploads to the **same origin** as the app (for example `https://www.sedifex.com/api/uploads`).

- Upload API endpoint: `POST /api/uploads`
- Request JSON body:
  - `filename`
  - `mimeType`
  - `dataBase64`
- Validation rules:
  - `mimeType` must start with `image/`
  - `dataBase64` must be present and decode to non-empty bytes
  - max decoded size is **5 MB**
- Response JSON:
  - `{ "url": "<public-image-url>" }`

#### Storage backend

Uploads are stored in your configured **Firebase Storage bucket** under the `product-images/` prefix using the existing Firebase Admin credentials already used by Vercel API routes. The API returns a public Google Cloud Storage URL, which can be stored in Firestore and rendered by the Products page.

#### Required environment variables

Set these in your Vercel project:

- `ADMIN_SERVICE_ACCOUNT_JSON` (recommended) or `FIREBASE_SERVICE_ACCOUNT_BASE64` (already required by existing API routes)
- `IMAGE_UPLOAD_BUCKET` (for example: `sedifex-prod.appspot.com`)
- `VITE_UPLOAD_API_URL` (optional; leave unset in production to use the same-origin default `/api/uploads`)
- `VITE_GOOGLE_TAG_ID` (optional; your GA4 Measurement ID, e.g. `G-XXXXXXXXXX`, to enable Google tag loading in `web/index.html`)

> Note: Firebase Functions `.env*` files reserve the `FIREBASE_*` prefix. Use non-reserved names like `IMAGE_UPLOAD_BUCKET` and `ADMIN_SERVICE_ACCOUNT_JSON` for deploy-safe config.

#### Deploy notes

1. Deploy from the repo (or `web/`) to Vercel with `web/` as the build root for the frontend.
2. Ensure `web/vercel.json` (and root `vercel.json`, if used) keeps SPA rewrites from catching `/api/*`.
3. In production, verify:
   - `POST https://www.sedifex.com/api/uploads` returns `201` + `{ "url": "..." }`
   - Uploaded URL is publicly accessible and renders in the product list.
4. Ensure bucket/object access allows public reads for product images (for example, grant `Storage Object Viewer` on the bucket to `allUsers`, or apply an equivalent public-read policy for the `product-images/` path).

> The previous local-only `npm run upload:server` helper has been removed to avoid confusion with production deployment.

### CSV import/export (items)

- Required item headers remain unchanged: `name`, `price`.
- New optional headers:
  - `image_url`
  - `image_alt`
- Backward compatibility is preserved: legacy CSV files without these columns still import successfully.

### Firestore behavior

- Product create/edit persists `imageUrl` and `imageAlt` with existing `storeId` tenant scoping.
- Product edits continue to refresh `updatedAt`.
- Existing products without image fields remain valid and queryable.

### Downstream consumer read contract (Glittering)

- Use callable `listStoreProducts` (Cloud Functions) for tenant-safe reads.
- Authenticated staff/owners can read products for their own `storeId`.
- Return shape per product:
  - `id`
  - `storeId`
  - `name`
  - `category`
  - `description`
  - `price`
  - `stockCount`
  - `itemType`
  - `imageUrl`
  - `imageAlt`
  - `updatedAt`

### Integration quickstart (website sync)

- See [`docs/integration-quickstart.md`](docs/integration-quickstart.md) for a step-by-step guide to connect another website and auto-load products from Sedifex.
- See [`docs/how-to-use-sedifex.md`](docs/how-to-use-sedifex.md) for an end-user tutorial (owners, cashiers, and admins) on daily Sedifex workflows.
- See [`docs/integration-delivery-sequence.md`](docs/integration-delivery-sequence.md) for the recommended rollout order: API keys first, then WordPress plugin MVP, then product webhooks.
- See [`docs/wordpress-plugin/sedifex-sync.php`](docs/wordpress-plugin/sedifex-sync.php) for a WordPress plugin MVP scaffold (settings + shortcode/block + sync health).
- See [`docs/webhooks-signature-verification.md`](docs/webhooks-signature-verification.md) for webhook event and signature verification examples.

### One-time backfill utility

- Run `node functions/scripts/migrateProductImageFields.js` from the repo root (with Firebase admin credentials available) to backfill old records:
  - set `imageUrl = null` when missing
  - set `imageAlt = product.name` when `imageUrl` exists and `imageAlt` is missing
- Run `npm --prefix functions run backfill-public-products -- [storeId]` to copy `products` documents into `publicProducts` for public-catalog reads (optional `storeId` limits the backfill scope).
- Run `npm --prefix functions run backfill-product-normalization -- [--store-id=STORE_ID]` to normalize every `products` document (name/category/image/barcode/default fields) through an admin script instead of waiting for page-open backfills.
- Preview legacy CRM identity repairs with `npm --prefix functions run backfill-customer-identity -- --store-id=STORE_ID`. Review the per-collection summary, then repeat with `--apply`; optional `--page-size=N` and `--max-pages=N` flags keep production runs bounded, and idempotent writes make retries safe.

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
   # If you manually created your default Firestore database and it uses the ID "default",
   # surface it so the client targets the correct instance (falls back to "default" automatically).
   VITE_FB_DATABASE_ID=default
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

### Activity feed notifications (frontend + backend)
- **Frontend (web/):** Notifications rely on the PWA service worker. Run the app over a secure origin (HTTPS in prod, `localhost` is allowed in dev) so the Notification API is available, and make sure `web/public/sw.js`, `manifest.webmanifest`, and the icons directory are deployed by your host. No extra env vars are required beyond the Firebase config above.
- **Backend (Firestore):** Notifications are driven by the `activity` collection. Ensure documents include `storeId`, `type`, `summary`, `detail`, `actor`, and a timestamp at `createdAt` so sorting works. Keep your Firestore rules aligned so store owners can read their activity feed; the client only requests notification permission for members with the `owner` role.
- **Browser permission:** The first time an owner opens the Activity page, they will be prompted for notification permission. Approving it enables alerts for new activity; declining will skip notification attempts until permission is manually changed in the browser.

## Deploy the PWA (Vercel/Netlify/Firebase Hosting)
- Point your host to build from `web/` with build command `npm run build` and output dir `dist`.
- Add the env vars above to your hosting provider.
- Set your domain `app.sedifex.com` to the deployed frontend.

## Google Ads backend deployment checklist (Firebase Functions)

Use this checklist when deploying the Google Ads integration so OAuth, callbacks, and backend syncs work correctly.

### 1) Set required environment variables (Functions runtime config/env)

Minimum backend vars:

- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (recommended: `https://www.sedifex.com/api/google/oauth-callback`)
- `GOOGLE_ADS_REDIRECT_URI` (optional backward-compatible fallback)
- `APP_BASE_URL` (set to `https://www.sedifex.com`)
- `GOOGLE_ADS_SYNC_SECRET` (used by the optional manual sync endpoint)

These are required by OAuth/token exchange and callback redirect logic.

Firebase Functions uses its runtime service account by default, so no extra Admin SDK JSON/base64 secret is required for deployed functions.

### 2) Configure Google OAuth in Google Cloud Console

In your OAuth client:

- Add authorized redirect URI exactly matching:
  - `https://www.sedifex.com/api/google/oauth-callback`
- Ensure Google Ads scope is allowed:
  - `https://www.googleapis.com/auth/adwords`

The backend builds the OAuth URL with that redirect URI and exchanges auth code for tokens. The URI in Google Cloud Console must be an exact string match with `GOOGLE_REDIRECT_URI` (or `GOOGLE_ADS_REDIRECT_URI` when using fallback mode).

### 3) Deploy Firebase Hosting + Cloud Functions

This implementation depends on Hosting/server rewrites that forward these paths:

- `/api/google/oauth-start` → shared OAuth start handler
- `/api/google/oauth-callback` → shared OAuth callback handler
- `/api/google-ads/campaign` → `googleAdsCampaign`
- `/api/google-ads/metrics-sync` → `googleAdsMetricsSync`

Cron is provided by a scheduled Cloud Function:

- `googleAdsMetricsSyncScheduled` (`every 30 minutes`)

### 4) Verify app flow in the UI

In the Ads page:

1. Enter Google account email + customer ID.
2. Click **Connect Google Ads** (starts OAuth via backend).
3. Complete Google consent.
4. Callback should return to `/ads` and show success/failure notice.
5. Confirm billing.
6. Save brief, create campaign, and pause/resume.

Those actions now call backend endpoints instead of client-only writes.

### 5) Ensure Firestore writes succeed

Server writes target:

- `storeSettings/{storeId}.googleAdsAutomation.*`
- `storeSettings/{storeId}.integrations.googleAds.*`
- `googleAdsOAuthStates/{hashedState}`

These are Admin SDK writes, so Firestore client security rules do not block them. Project health, billing status, and index/state health still matter.

### 6) Metrics sync expectations

Metrics sync runs every 30 minutes through:

- `googleAdsMetricsSyncScheduled`

Optional manual sync endpoint:

- `POST /api/google-ads/metrics-sync` with `x-google-ads-sync-secret: <GOOGLE_ADS_SYNC_SECRET>` (or `?secret=...`)

### 7) Quick sanity notes

- Use a single canonical Sedifex domain for OAuth callback-related variables to avoid redirect mismatches. Recommended canonical base: `https://www.sedifex.com`.
- If you still have duplicate `PAYSTACK_STANDARD_PLAN_CODE` entries in runtime config, remove duplicates and keep one source of truth.
- After updating env variables, redeploy and retry Google connect.

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

**One-command Firestore bootstrap**
- From the repo root, you can refresh both collections with one command using the helper script:

  ```bash
  node seed/firestore-seed.js --env dev   # or stage | prod
  ```

- The script will pick the right Firebase project ID for the chosen environment and run `firestore:delete` + `firestore:import` for both [`seed/workspaces.seed.json`](seed/workspaces.seed.json) and [`seed/team-members.seed.json`](seed/team-members.seed.json), with clear console output so you can see exactly which project is being modified.

### Team member access (`teamMembers` collection)
- All login eligibility data lives in the **default** Firestore database. The `teamMembers` collection inside the default DB must contain at least one document matching the user who is attempting to sign in.
- Each team member document should include the member's `uid`, the verified `email`, and the assigned `storeId`. Additional helpful fields include `role`, `name`, `phone`, and any admin-only `notes`.

**Quick seed for local/testing environments**
1. Update [`seed/team-members.seed.json`](seed/team-members.seed.json) with the UID, email, and store ID that you want to allow through login.
2. Import the roster seed into the default database:
   ```bash
   npx firebase firestore:delete teamMembers --project <project-id> --force
   npx firebase firestore:import seed/team-members.seed.json --project <project-id>
   ```
3. If you prefer to seed manually, create a document at `teamMembers/<uid>` (and optionally `teamMembers/<email>`) in the default database containing the same fields as the JSON example. The login callable will reject accounts that lack both documents or that do not specify a `storeId`.

### Troubleshooting: new signups do not create team/store records
If you create a Firebase Auth user and do **not** see corresponding documents in Firestore, walk through the checklist below:

1. **Confirm the Cloud Function is deployed.** In the Firebase console open *Functions* and ensure `onAuthCreate` appears with a green check. If it is missing, redeploy from the repo root:
   ```bash
   cd functions
   npm install
   npm run deploy
   ```
2. **Inspect execution logs.** In the Firebase console → *Functions* → `onAuthCreate` → *Logs*, look for errors such as permission issues (`PERMISSION_DENIED`) or missing indices. Fix any issues surfaced there so the default service account can write to Firestore.
3. **Retry with a fresh user.** After resolving any deployment or permission issues, create a brand-new Auth user. The function only runs the first time the user is created, so deleting and re-creating the user ensures the trigger fires again.

Following these steps should result in new documents at `teamMembers/<uid>` and `stores/<uid>` in the default database immediately after signup.

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
   - For Cloud Functions, set `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, and `APP_BASE_URL` (used for webhook verification and default redirects). For example:
     ```bash
     cd functions
     firebase functions:config:set PAYSTACK_SECRET_KEY="sk_live_xxx" PAYSTACK_PUBLIC_KEY="pk_live_xxx" APP_BASE_URL="https://app.sedifex.com"
     ```

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
