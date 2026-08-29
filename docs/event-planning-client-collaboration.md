# Event Planning and Client Collaboration Architecture

_Last updated: 29 August 2026_

This document describes the current Sedifex Event Planning architecture and client-collaboration workflow. It is intended for engineers working in the core `sedifex` repository.

The behavior documented here reflects the current implementation after the recent Event Planning, client portal, program revision, and client-task updates.

## 1. Main routes and staff workflow

The Event business preset exposes the Event Planning module and supporting dashboard/report surfaces.

Primary routes:

```txt
/event-planning
/event-planning/:eventId
```

On `/event-planning`, stores can search events and use either the event name or **Open workspace** to open the full event workspace.

The event operations area now puts the operational tabs first:

```txt
Client Portal
Checklist
Run Sheet
Program
<Event-specific Details>
Evaluation
```

The details label adapts to the event type, for example:

```txt
Traditional / White wedding / Engagement -> Wedding Details
Funeral -> Funeral Details
Corporate event -> Corporate Details
Charity / community -> Donations & Details
Naming ceremony -> Ceremony Details
Other -> Event Details
```

`Run Sheet` is the internal event-day staff/vendor schedule. `Program` is the guest/client-facing order of activities. Keep these concepts separate in code and UI.

## 2. Client portal overview

A store can create/share a secure client portal from the event workspace. The public portal is rendered by the Firebase HTTPS function:

```txt
functions/src/eventClientCollaboration.ts
functions/src/eventClientPortalPage.ts
```

The client portal uses four simple client-facing tabs:

```txt
My Event
Program
My Tasks
Updates
```

The selected tab is stored in the URL hash (`#event`, `#program`, `#tasks`, `#updates`) so automatic portal refreshes return the client to the same section.

The portal is intentionally written for non-technical clients. Prefer simple wording such as:

```txt
I have done this
Send to event team
Waiting for confirmation
Want something changed?
```

Avoid exposing internal concepts such as transaction, revision precondition, collaboration state, or verification state in client-facing copy unless necessary.

## 3. Portal security model

Public clients do not receive direct Firestore access.

The secure flow is:

```txt
Store shares portal
-> Sedifex creates a random portal token
-> token hash is stored in eventClientLinks/{tokenHash} for server-side validation
-> stores/{storeId}/events/{eventId}.clientPortal.publicUrl stores the full client URL, including the raw bearer token, so authorized staff can copy/open the active link
-> public client opens eventClientPortal?token=...
-> HTTPS Function validates the active link and event binding
-> allowed reads/writes are performed server-side
```

Relevant top-level validation collection:

```txt
eventClientLinks/{tokenHash}
```

Relevant event metadata:

```txt
stores/{storeId}/events/{eventId}.clientPortal

clientPortal.publicUrl       # full URL containing the active raw bearer token
clientPortal.publicLinkHash  # hash used to bind/validate the active link
clientPortal.status
clientPortal.expiresAt
```

### Bearer-token persistence boundary

The current implementation does **not** persist only the hash. The hash is used for validation, but `clientPortal.publicUrl` also persists the recoverable active bearer token inside the staff-readable event document.

Security consequences:

- Any authorized store user who can read the event document can recover and use the active client portal credential from `clientPortal.publicUrl`.
- Treat `clientPortal.publicUrl` as a secret-bearing value. Do not expose it in public APIs, client-sanitized payloads, analytics, logs, or support output that can reach unauthorized users.
- Firestore access to event documents must remain limited to authorized store members.
- Resharing the portal rotates/replaces the active link and should invalidate the previous credential.
- Hashing the validation key does not make the bearer credential non-recoverable while the full tokenized URL is stored on the event document.

If the implementation is later hardened so the raw token is no longer persisted, the staff **Copy client link / Open client view** experience will also need a replacement design, such as one-time display, explicit link regeneration, or encrypted/secret storage. Do not change the docs to claim hash-only persistence until the runtime behavior actually changes.

Important rules:

- Public clients must not write directly to event Firestore collections.
- The active portal token must match the current event portal metadata.
- Resharing can revoke/replace the previous public link.
- Portal links currently use a long-lived but finite expiry window.
- Internal-only event data must not be exposed just because the client has a valid portal link.

## 4. Live client brief

The `My Event` tab contains the live client brief. The client can edit the approved set of text fields directly and save them to the event.

Current editable fields:

```txt
requirements
 themeColours
 venueRequirements
 catering
 decor
 entertainment
 photography
 transport
 accommodation
 specialInstructions
```

Stored under:

```txt
stores/{storeId}/events/{eventId}.clientBrief
```

Client saves use dotted field updates so staff-controlled package/pricing fields are not overwritten.

The client save also records client update metadata such as the update time and client identity/email when available.

### Privacy rule

`clientBrief.packageItems` and other staff-controlled pricing/scope data must not be overwritten by the public brief save action.

## 5. Program: publish and approval are separate concepts

Creating a program item does not automatically make it visible to the client.

The intended workflow is:

```txt
Draft
-> Publish to client
-> Client can view the published program
-> optional client approval
-> optional client change request
```

Client approval is not required just to publish a program.

On the staff side, publishing offers an optional **Require client approval** choice. It is off by default.

When approval is not required:

```txt
Publish to client
-> client immediately sees program
-> client may still request a change
```

When approval is required:

```txt
Publish to client
-> client sees program
-> client can Approve program OR request a change
```

### Internal compatibility note

The persisted `programApproval.status` still uses the historical values `draft` and `approved`. In the current UX, `approved` is also the protected/published state. Do not assume that `status === 'approved'` always means the client personally approved the program.

Use these fields to distinguish publication from optional client approval:

```txt
programApproval.publishedAt
programApproval.publishedBy
programApproval.requireClientApproval
programApproval.clientApproved
programApproval.clientApprovedBy
programApproval.clientApprovedAt
programApproval.revision
programApproval.fingerprint
```

## 6. Program mutation and revision safety

Program concurrency is handled server-side. Browser state must never be trusted as the source of truth for published/draft transitions.

Key code:

```txt
functions/src/eventProgramCollaboration.ts
functions/src/eventProgramApproval.ts
web/src/utils/eventProgramFingerprint.ts
```

Key callable operations include:

```txt
prepareEventProgramRevision
mutateEventProgram
publishEventProgram
```

### Editing a published program

Any staff add/edit/delete against a currently published program is performed through a server transaction.

The transaction:

```txt
1. Reads current event + program from Firestore.
2. Checks the current server publication state.
3. Archives the published revision if necessary.
4. Moves the event to the next draft revision.
5. Applies the mutation.
```

Archived revisions live under:

```txt
stores/{storeId}/events/{eventId}/programRevisions/revision-{n}
```

The latest published revision remains available to the client while staff prepares the next draft.

### Do not overwrite revision history

Archive creation checks that the destination revision document does not already exist. If it does, the operation fails and the UI should refresh instead of overwriting history.

## 7. Program fingerprint precondition

Revision number alone is not sufficient for safe approval because two staff members can edit the same draft without changing its revision number.

Client/staff approval therefore uses a content fingerprint tied to the exact program items reviewed.

The fingerprint canonicalizes:

```txt
id
 time
 title
 participant
 notes
 sortOrder
```

Important implementation rules:

- Browser and server normalization must be identical.
- Hash the same trimmed stored values on both sides.
- Do not silently truncate one side before hashing while hashing full content on the other.
- Ordering must be locale-independent; do not use environment-dependent `localeCompare` for fingerprint tie-breaking.
- Approval validates both expected revision and expected fingerprint.

If the program content changed after it was reviewed, the approval request must fail and the latest program must be reviewed again.

## 8. Program change requests

Published program items are read-only in the client portal.

Clients can use a simple **Want something changed?** box. Requests are stored under:

```txt
stores/{storeId}/events/{eventId}/programChangeRequests/{requestId}
```

The event also keeps current request metadata for quick staff visibility.

Staff can accept or decline a request. Accepting a request preserves the published revision and opens the next revision for staff changes.

## 9. Shared checklist tasks

Internal planning checklist tasks live under:

```txt
stores/{storeId}/events/{eventId}/tasks/{taskId}
```

A task is visible to the client only when:

```txt
clientVisible === true
```

Unshared checklist items remain internal even when the portal link is valid.

This is important for finance, staffing, vendor negotiation, internal notes, and other sensitive operational tasks.

## 10. Client task completion flow

The `My Tasks` tab is intentionally simpler than the internal task state machine.

Current client UX:

```txt
Task shown
-> client ticks “I have done this”
-> optional note appears
-> client clicks “Send to event team”
-> portal shows “Sent to event team” / “Waiting for confirmation”
-> staff verifies OR returns the task
```

The optional note is saved as the client submission note.

### Compatibility with the older start state

The backend still supports the historical task start transition. The current portal hides that technical step from the client. For a task that is still `todo`, the renderer performs the necessary start transition before submitting completion.

Do not reintroduce a mandatory visible **Start task** step unless the product intentionally changes back to a multi-stage client workflow.

### Client task state model

Relevant task fields include:

```txt
status: todo | in_progress | blocked | done
clientVisible: boolean
clientState: open | submitted | changes_requested | verified
clientSubmissionNote
clientStaffNote
clientStartedAt
clientSubmittedAt
clientVerifiedAt
clientChangesRequestedAt
```

Friendly client labels should map roughly to:

```txt
open -> To do
submitted -> Sent to event team / Waiting for confirmation
changes_requested -> Needs your attention
verified or status=done -> Done
```

## 11. Staff verification and return flow

A client submission is not counted as verified until staff confirms it.

Current staff implementation:

```txt
web/src/components/EventClientCollaborationDock.tsx
```

On `/event-planning/:eventId`, the staff-side Client Portal dock listens to event tasks and client activity in real time.

For a submitted client task, staff can:

```txt
Verify
-> status = done
-> clientState = verified
-> clears staff return note
-> updates clientVerifiedAt
-> records public clientActivity
-> updates event readiness/progress

Return to client
-> status = in_progress
-> clientState = changes_requested
-> saves staff note
-> records clientChangesRequestedAt
-> records public clientActivity
```

The client then sees either **Done** or the return note with a chance to resubmit.

### Current UX limitation

The verification controls currently live in the staff Client Portal dock/floating trigger, not yet directly inside the new top-level `Client Portal` operations tab.

A future UX improvement is to move the “Needs your attention” verification queue into that tab. Do not document that future layout as already shipped until it is implemented.

## 12. Activity and progress

Public task activity is written under:

```txt
stores/{storeId}/events/{eventId}/clientActivity/{activityId}
```

The public portal only exposes activity related to currently client-visible tasks.

The portal progress percentage is based on verified/done tasks, not merely client submissions. The correct label is:

```txt
tasks verified
```

Do not label verified-only progress as “tasks completed” because a submitted item may still be awaiting staff verification.

## 13. Portal draft protection and automatic refresh

The client portal periodically refreshes so staff changes appear without the client manually reloading.

To avoid losing client input, auto-refresh is suppressed while there is an unsent draft, including:

- live brief changes,
- program change request text,
- task notes,
- a checked “I have done this” task that has not been sent yet.

Task/program drafts use `sessionStorage` where appropriate so navigation/refresh behavior does not unexpectedly discard work.

## 14. Important collections and code map

```txt
stores/{storeId}/events/{eventId}
  clientBrief
  clientPortal
  programApproval
  programChangeRequest
  progress / readiness metadata

stores/{storeId}/events/{eventId}/tasks/{taskId}
stores/{storeId}/events/{eventId}/program/{itemId}
stores/{storeId}/events/{eventId}/programRevisions/revision-{n}
stores/{storeId}/events/{eventId}/programChangeRequests/{requestId}
stores/{storeId}/events/{eventId}/clientActivity/{activityId}

eventClientLinks/{tokenHash}
```

Primary code locations:

```txt
web/src/pages/EventPlanning.tsx
web/src/pages/EventWorkspace.tsx
web/src/components/EventOperationsWorkspace.tsx
web/src/components/EventChecklistShareCard.tsx
web/src/components/EventClientCollaborationDock.tsx
web/src/utils/eventProgramFingerprint.ts

functions/src/eventClientCollaboration.ts
functions/src/eventClientPortalPage.ts
functions/src/eventProgramCollaboration.ts
functions/src/eventProgramApproval.ts

functions/test/eventClientCollaboration.test.js
```

## 15. Deployment behavior

The client portal HTML is generated by Firebase Functions. A merge to `main` does not change the live `cloudfunctions.net/eventClientPortal` page until the Functions deployment succeeds.

The repository has a main-branch Firebase Functions deployment workflow for changes under `functions/**` and related Firebase configuration.

The web frontend is deployed separately through Vercel. Because the Vercel project uses `web/` as its root directory, the effective deployment configuration is:

```txt
web/vercel.json
```

The Vercel ignore command is configured to skip non-`main` branch builds so feature branches do not exhaust the deployment quota before production merges.

## 16. Regression checklist for future changes

When changing Event Planning/client collaboration, verify all of the following:

- Client portal never exposes internal-only checklist tasks.
- Live brief save cannot overwrite package/pricing fields.
- Draft program is not shown as the current client-published program.
- Publishing does not require client approval unless staff selected that option.
- Editing/deleting a published program archives it before mutation.
- Revision archives are never overwritten.
- Program approval validates both revision and exact content fingerprint.
- Fingerprint ordering/normalization is identical in browser and server.
- Client task submission works without a visible Start task step.
- A checked-but-unsent task survives the portal refresh guard.
- Submitted tasks do not count as verified until staff verifies them.
- Return-to-client notes are visible to the client.
- Portal progress copy says `tasks verified` when the calculation is verification-based.
- Security documentation correctly states that `clientPortal.publicUrl` currently contains a recoverable active bearer token for authorized staff use.
- Firestore rules continue to deny direct public event writes.
- Production Firebase Functions deployment completes before claiming a `cloudfunctions.net` portal change is live.
