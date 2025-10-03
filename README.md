# Sedifex — PWA + Firebase Starter

This repo is a drop-in starter for **Sedifex** (inventory & POS). It ships as a **website** that is also **installable as a PWA**, with **Firebase** (Auth + Firestore + Functions).

## What’s inside
- `web/` — React + Vite + TypeScript PWA
- `functions/` — Cloud Functions (Node 20) for workspace management backed by the Sedifex Data API
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
   VITE_FB_FUNCTIONS_REGION=us-central1
   ```
4) (Optional) Deploy Functions:
   ```bash
   cd functions
   npm i
   # Configure the data API endpoint used by the functions
   export SEDIFEX_API_URL=https://api.sedifex.dev
   export SEDIFEX_API_KEY=dev-service-token
   # Deploy with your preferred tooling (Firebase CLI or Cloud Functions Framework)
   npm run build
   ```

## Deploy the PWA (Vercel/Netlify/Firebase Hosting)
- Point your host to build from `web/` with build command `npm run build` and output dir `dist`.
- Add the env vars above to your hosting provider.
- Set your domain `app.sedifex.com` to the deployed frontend.

## Backend setup notes
- Enable **Authentication → Phone** and **Email/Password** in Firebase Auth (optional).
- Provision the Sedifex Data API and expose it at `SEDIFEX_API_URL`. The Functions expect REST resources for team members and stores, along with a `callable-logs` endpoint for error telemetry.
- Create a second project for production later (e.g., `sedifex-prod`).
- Schedule the `runNightlyDataHygiene` Cloud Function via Cloud Scheduler (daily at 03:00 UTC). It now audits the Data API rather than cleaning Firestore collections.

## Testing
- Run unit and integration tests for the PWA from the `web/` directory with `npm run test`.
- API-backed Cloud Functions tests live in `functions/` and can be executed with `npm test`. They boot the in-memory persistence adapter instead of relying on Firestore emulators.

## Branding
- Name: **Sedifex**
- Tagline: *Sell faster. Count smarter.*
- Primary color: `#4338CA` (indigo 700)

---

Happy shipping! — 2025-09-23
