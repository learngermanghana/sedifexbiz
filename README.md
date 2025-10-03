# Sedifex — PWA + Firebase + Postgres Starter

This repo is a drop-in starter for **Sedifex** (inventory & POS). It ships as a **website** that is also **installable as a PWA**, with **Firebase** (Auth + Functions) and a managed **Postgres** database (Neon or Cloud SQL) reached through a lightweight backend service.

## What’s inside
- `web/` — React + Vite + TypeScript PWA
- `functions/` — Firebase Cloud Functions (Node 20) for store onboarding and stock receipts
- `data-service.config.json` — Connection details expected by the backend when talking to Postgres
- `.github/workflows/` — Optional CI for deploying Functions (if you want to use GitHub Actions)

## Quick start (local dev)
1. Install Node 20+.
2. Go to `web/` and install deps:
   ```bash
   cd web
   npm i
   npm run dev
   ```
3. Create a Firebase project (e.g., `sedifex-dev`) and fill these env vars in `web/.env.local`:
   ```env
   VITE_FB_API_KEY=REPLACE_ME
   VITE_FB_AUTH_DOMAIN=sedifex-dev.firebaseapp.com
   VITE_FB_PROJECT_ID=sedifex-dev
   VITE_FB_STORAGE_BUCKET=sedifex-dev.appspot.com
   VITE_FB_APP_ID=REPLACE_ME
   VITE_FB_FUNCTIONS_REGION=us-central1
   VITE_DATA_API_URL=http://localhost:8787 # proxy for the Postgres-backed API
   ```
4. Provision a Postgres database (Neon, Supabase, or Cloud SQL). Copy the connection strings into `functions/.env`:
   ```env
   DATABASE_URL=postgres://USER:PASSWORD@HOST/DB
   DATABASE_POOLER_URL=postgres://USER:PASSWORD@HOST/DB?sslmode=require
   ```
5. (Optional) Deploy Functions and the Postgres-backed API to production:
   ```bash
   cd functions
   npm i
   # Login to Firebase
   npx firebase login
   # Set your project
   npx firebase use sedifex-dev
   # Deploy callable/HTTPS functions
   npm run deploy
   # Deploy the Cloud Run service that fronts Postgres
   npm run deploy:backend
   ```

## Deploy the PWA (Vercel/Netlify/Firebase Hosting)
- Point your host to build from `web/` with build command `npm run build` and output dir `dist`.
- Add the env vars above (Firebase + API endpoint) to your hosting provider.
- Set your domain `app.sedifex.com` to the deployed frontend.

## Data service setup notes
- Provision **Postgres** with a production branch and read replica if possible.
- Keep the `DATABASE_URL` and `DATABASE_POOLER_URL` secrets in Firebase Functions/Cloud Run for production deployments.
- Schedule the `runNightlyDataHygiene` Cloud Function via Cloud Scheduler (daily at 03:00 UTC) so summaries are recomputed and activity logs stay clean.

## Testing
- Run unit and integration tests from the `web/` directory with `npm run test`.

## Maintenance scripts
- To backfill missing team memberships and store documents for legacy Auth accounts, run `npm run migrate-missing-members` from the `functions/` directory. The script requires Firebase Admin credentials (e.g., `GOOGLE_APPLICATION_CREDENTIALS`) and access to the Postgres connection env vars so it can join against membership tables.

### Membership records in Postgres
- Store onboarding now relies on membership rows inside a `memberships` table (schema maintained in Postgres migrations). Create one row per workspace with fields such as `contract_start`, `contract_end`, `payment_status`, `amount_paid`, and `company`.
- Ensure date fields are stored as timestamps (UTC) and normalize payment amounts to numbers so Cloud Functions can process billing logic without additional parsing.

## Branding
- Name: **Sedifex**
- Tagline: *Sell faster. Count smarter.*
- Primary color: `#4338CA` (indigo 700)

---

Happy shipping! — 2025-09-23
