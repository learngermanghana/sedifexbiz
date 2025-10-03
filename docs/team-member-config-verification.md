# Team Member Config Verification

- Confirmed `web/src/config/teamMembers.ts` is tracked with correct casing via `git ls-files web/src/config`.
- Verified `web/src/App.tsx` imports the override constant from `./config/teamMembers`.
- Ran `npm run build` from `web/` to confirm Vite resolves the module (build currently fails due to pre-existing TypeScript errors unrelated to the module resolution).
