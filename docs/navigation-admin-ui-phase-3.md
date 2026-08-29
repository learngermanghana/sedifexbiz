# Industry Navigation + Custom Navigation — Phase 3 (Admin UI)

## Goal
Give non-technical workspace owners full control of sidebar navigation from **Account → Navigation settings**.

## Scope (4–6 days)

### 1) Account UI entry point
- Add a new **Navigation** subsection under Account (workspace tab).
- Owner-only access; staff sees read-only summary.

### 2) Industry Profile
- Dropdown with: `Shop`, `Travel`, `NGO`, `School`.
- Save to `storeSettings/{storeId}.navigation.industry`.
- Preview label alias effects immediately in UI.

### 3) Enabled Modules
- Toggle list for module nav items (from `NAV_ITEMS`, excluding required system entries such as Account).
- Persist selected ids in `navigation.enabled_modules`.
- Guardrail: keep at least **one primary nav item** enabled.

### 4) Custom Navigation
Each custom item supports:
- **Add item**
- **Type**: `module`, `internal`, `external`
- **Label**, **Icon**, **URL/target**
- **Role visibility**: owner/staff
- **Order** via drag/drop (with keyboard fallback up/down controls)
- **Enable/disable** toggle

Persist in `navigation.custom_nav_items` with explicit `sort_order`.

## Guardrails

### URL validation
- External links must be absolute `http://` or `https://` URLs.
- Internal/module targets must start with `/`.
- Reject unsafe schemes (`javascript:`, `data:`, etc.).

### Duplicate protection
- No duplicate labels (case-insensitive, trimmed).
- No duplicate routes/targets among enabled base + custom items.

### Minimum nav availability
- Block save if all primary items are disabled.
- Show inline error and point to offending controls.

## Suggested implementation tasks

### Day 1
- Create `NavigationSettingsSection` component.
- Wire into `AccountOverview`.
- Load existing navigation preferences.

### Day 2
- Implement industry selector + module toggles.
- Add optimistic local state with Save/Cancel.

### Day 3
- Implement custom item editor (add/edit/remove/enable).
- Add validation and error state model.

### Day 4
- Implement reorder (drag/drop + keyboard fallback).
- Persist `sort_order` consistently.

### Day 5
- Integration tests (happy path + guardrails).
- Accessibility pass (labels, focus order, announcements).

### Day 6 (buffer)
- Polish copy, analytics, rollout flag, docs.

## Data model additions
- Extend custom item payload with:
  - `icon?: string`
  - `is_enabled?: boolean` (default `true`)

## QA checklist
- Owner can change industry and save.
- Owner can disable modules but not all primary modules.
- Owner can add all 3 custom link types.
- Invalid external URL blocks save.
- Duplicate label/route blocks save.
- Drag/drop reorder persists after refresh.
- Staff only sees items allowed by role.

## Rollout
- Guard behind feature flag (`nav_admin_phase3`).
- Enable for internal stores first, then 10%, 50%, 100%.
- Monitor save errors and navigation render failures.
