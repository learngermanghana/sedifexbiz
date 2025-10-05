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

## Branding
- Name: **Sedifex**
- Tagline: *Sell faster. Count smarter.*
- Primary color: `#4338CA` (indigo 700)

---

Happy shipping! — 2025-09-23
