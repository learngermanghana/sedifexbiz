# Signup flow: owners vs. team members

This document summarizes how the current signup experience assigns workspace roles and initializes store access.

## Form inputs

During signup (`web/src/pages/AuthPage.tsx`), users provide the usual account fields plus an **optional** `Store ID`:
- If the `Store ID` field is **blank**, the new user is treated as the workspace **owner**.
- If a `Store ID` is **present**, the new user is treated as a **team member** attempting to join the specified workspace.

No owner/member toggle is rendered; the presence of a Store ID drives role selection.

## Role determination and workspace initialization

1. After creating the Firebase auth user, the signup handler trims the optional `storeId`.
2. It sets `signupRoleForWorkspace` to `'team-member'` when a store ID is present; otherwise `'owner'`.
3. It calls `initializeStore` with the contact payload (name, business, phone, location, first email) and passes the store ID **only when joining as a team member**. The callable validates ownership or membership server-side and returns the resolved `storeId` and role claims.

Relevant code: `AuthPage.handleSubmit` and `initializeStore`.

## Resolving access and persisting the session

After initialization, the app calls `resolveStoreAccess` (optionally scoped to the initialized store) to fetch:
- `storeId`
- `workspaceSlug`
- resolved role (`'owner'` or `'staff'`)

The result is persisted via `persistSession`, so the client session reflects the workspace context immediately after signup.

## Error handling and cleanup

- If any initialization or access resolution step fails, the signup flow surfaces the normalized error and signs the user out via `cleanupFailedSignup`.
- The session is only persisted with workspace data after both initialization and access resolution succeed.

## Outcomes

- **Owners**: Sign up without a store ID. A new workspace is initialized, and their session is associated with the newly created store as `owner`.
- **Team members**: Enter a store ID. Initialization requests membership in that store, then resolves access so the session is scoped to the existing workspace as `staff`.
